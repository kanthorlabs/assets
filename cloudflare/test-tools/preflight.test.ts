import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { checkCostCap, workersPlan } from "../scripts/preflight.ts";
import { fixture } from "./fixture.ts";

const values = { ...fixture, CLOUDFLARE_API_TOKEN: "test-only" };
const zone = { id: "zone", name: "example.com", status: "active", account: { id: "a".repeat(32) } };

class Refusal {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number) {
    this.status = status;
    this.code = code;
  }
}

function mockApi(t: TestContext, routes: Record<string, unknown>): string[] {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-only");
    assert.equal(options.method ?? "GET", "GET", "Preflight only reads");
    const path = new URL(input).pathname.replace("/client/v4", "");
    seen.push(path);
    assert(Object.hasOwn(routes, path), `Unexpected API request: ${path}`);
    const route = routes[path];
    if (route instanceof Refusal)
      return Response.json(
        { success: false, errors: [{ code: route.code, message: "refused" }] },
        { status: route.status },
      );
    return Response.json({ success: true, result: route });
  });
  return seen;
}

const account = `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}`;
const bucket = `${account}/r2/buckets/${values.ASSETS_R2_BUCKET}`;
const other = `${account}/r2/buckets/other`;
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
  assert.deepEqual(await checkCostCap(values), []);
  assert.equal(seen.length, Object.keys(healthy).length);
});

const shared = {
  ...healthy,
  [`${account}/r2/buckets`]: { buckets: [{ name: "other" }, { name: values.ASSETS_R2_BUCKET }] },
  [`${other}/domains/managed`]: { enabled: false },
  [`${other}/domains/custom`]: { domains: [] },
};

test("passes with other private buckets and lists them", async (t) => {
  mockApi(t, shared);
  assert.deepEqual(await checkCostCap(values), ["Other private R2 buckets: other."]);
});

test("passes when the plan has no Cache Reserve", async (t) => {
  mockApi(t, { ...healthy, "/zones/zone/cache/cache_reserve": new Refusal(403, 1135) });
  assert.deepEqual(await checkCostCap(values), []);
});

test("refuses another Cache Reserve refusal", async (t) => {
  mockApi(t, { ...healthy, "/zones/zone/cache/cache_reserve": new Refusal(403, 10000) });
  await assert.rejects(checkCostCap(values), /HTTP 403/);
});

test("reports Logpush as not available when the plan refuses it", async (t) => {
  mockApi(t, {
    ...healthy,
    [`${account}/logpush/jobs`]: new Refusal(403, 10000),
    "/zones/zone/logpush/jobs": new Refusal(403, 10000),
  });
  assert.deepEqual(await checkCostCap(values), ["Logpush not available on this plan."]);
});

test("refuses Logpush to R2 when the other Logpush endpoint is refused", async (t) => {
  mockApi(t, {
    ...healthy,
    [`${account}/logpush/jobs`]: new Refusal(403, 10000),
    "/zones/zone/logpush/jobs": [{ destination_conf: "r2://logs" }],
  });
  await assert.rejects(checkCostCap(values), /Logpush/);
});

test("refuses another Logpush refusal", async (t) => {
  mockApi(t, { ...healthy, [`${account}/logpush/jobs`]: new Refusal(500, 10000) });
  await assert.rejects(checkCostCap(values), /HTTP 500/);
});

for (const [name, path, result] of [
  ["r2.dev access", `${other}/domains/managed`, { enabled: true }],
  ["a custom domain", `${other}/domains/custom`, { domains: [{ domain: "x.example.com" }] }],
] as const) {
  test(`refuses another bucket with ${name}`, async (t) => {
    mockApi(t, { ...shared, [path]: result });
    await assert.rejects(checkCostCap(values), new RegExp(`The bucket other has ${name}`));
  });
}

for (const [name, path, result, message] of [
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
