import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { checkCostCap, workersPlan } from "../scripts/preflight.ts";
import { fixture } from "./fixture.ts";

const values = { ...fixture, CLOUDFLARE_API_TOKEN: "test-only" };
const zone = { id: "zone", name: "example.com", status: "active", account: { id: "a".repeat(32) } };

function mockApi(t: TestContext, routes: Record<string, unknown>): string[] {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-only");
    assert.equal(options.method ?? "GET", "GET", "Preflight only reads");
    const path = new URL(input).pathname.replace("/client/v4", "");
    seen.push(path);
    assert(Object.hasOwn(routes, path), `Unexpected API request: ${path}`);
    return Response.json({ success: true, result: routes[path] });
  });
  return seen;
}

const account = `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}`;
const bucket = `${account}/r2/buckets/${values.ASSETS_R2_BUCKET}`;
const healthy = {
  [`${account}/r2/buckets`]: { buckets: [{ name: values.ASSETS_R2_BUCKET }] },
  [bucket]: { storage_class: "Standard" },
  [`${bucket}/domains/managed`]: { enabled: false },
  [`${bucket}/domains/custom`]: { domains: [] },
  [`${bucket}/sippy`]: { enabled: false },
  "/zones": [zone],
  "/zones/zone/cache/cache_reserve": { value: "off" },
  [`${account}/logpush/jobs`]: [],
  "/zones/zone/logpush/jobs": [],
};

test("reports Workers Free without a Workers subscription", async (t) => {
  mockApi(t, {
    [`${account}/subscriptions`]: [{ rate_plan: { id: "free", public_name: "Free" } }],
  });
  assert.equal(await workersPlan(values), "free");
});

test("reports Workers Paid with a Workers subscription", async (t) => {
  mockApi(t, {
    [`${account}/subscriptions`]: [
      { rate_plan: { id: "workers_paid", public_name: "Workers Paid" } },
    ],
  });
  assert.equal(await workersPlan(values), "paid");
});

test("passes the cost cap checks on a compliant account", async (t) => {
  const seen = mockApi(t, healthy);
  await assert.doesNotReject(checkCostCap(values));
  assert.equal(seen.length, Object.keys(healthy).length);
});

for (const [name, path, result, message] of [
  [
    "another bucket",
    `${account}/r2/buckets`,
    { buckets: [{ name: "x" }, { name: values.ASSETS_R2_BUCKET }] },
    /other than/,
  ],
  ["Infrequent Access", bucket, { storage_class: "InfrequentAccess" }, /Standard/],
  ["r2.dev access", `${bucket}/domains/managed`, { enabled: true }, /r2\.dev/],
  [
    "a custom domain",
    `${bucket}/domains/custom`,
    { domains: [{ domain: "x.example.com" }] },
    /custom domain/,
  ],
  ["Sippy", `${bucket}/sippy`, { enabled: true }, /Sippy/],
  ["Cache Reserve", "/zones/zone/cache/cache_reserve", { value: "on" }, /Cache Reserve/],
  ["Logpush to R2", `${account}/logpush/jobs`, [{ destination_conf: "r2://logs" }], /Logpush/],
] as const) {
  test(`refuses ${name}`, async (t) => {
    mockApi(t, { ...healthy, [path]: result });
    await assert.rejects(checkCostCap(values), message);
  });
}
