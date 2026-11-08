import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { baseUrl, send, sendRawPath } from "./client.ts";

const FIXTURES = new URL("../e2e-fixtures/", import.meta.url).pathname;
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";

interface Fixture {
  path: string;
  bytes: Buffer;
}

async function loadFixtures(): Promise<{ asset: Fixture; text: Fixture; forward: Fixture }> {
  const manifest = JSON.parse(await readFile(`${FIXTURES}manifest.json`, "utf8")) as Record<
    "asset" | "text" | "forward",
    { key: string; file: string }
  >;
  const load = async ({ key, file }: { key: string; file: string }) => ({
    path: `/${key}`,
    bytes: await readFile(`${FIXTURES}${file}`),
  });
  return {
    asset: await load(manifest.asset),
    text: await load(manifest.text),
    forward: await load(manifest.forward),
  };
}

function expectWorkerError(headers: Headers, label: string): void {
  assert.equal(headers.get("Cache-Control"), "no-store", `${label}: no-store`);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff", `${label}: nosniff`);
  assert.equal(headers.get("Content-Type"), "text/plain; charset=utf-8", `${label}: text/plain`);
}

async function expectStatus(
  base: string,
  path: string,
  status: number,
  init?: RequestInit,
): Promise<Response> {
  const response = await send(base, path, init);
  await response.body?.cancel();
  assert.equal(response.status, status, `${init?.method ?? "GET"} ${path}: status ${status}`);
  return response;
}

async function expectError(base: string, path: string, status: number): Promise<void> {
  expectWorkerError((await expectStatus(base, path, status)).headers, path);
}

async function expectMethodRefused(base: string, path: string): Promise<void> {
  for (const method of ["POST", "OPTIONS"]) {
    const response = await send(base, path, { method });
    await response.body?.cancel();
    if (response.status === 403) continue;
    assert.equal(response.status, 405, `${method} ${path}: 405 or zone block`);
    assert.equal(response.headers.get("Allow"), "GET, HEAD", `${method} ${path}: Allow`);
    expectWorkerError(response.headers, `${method} ${path}`);
  }
}

async function expectBody(response: Response, bytes: Buffer, label: string): Promise<void> {
  assert(Buffer.from(await response.arrayBuffer()).equals(bytes), `${label}: exact bytes`);
}

async function expectRange(base: string, fixture: Fixture, checkLength = true): Promise<void> {
  const response = await send(base, fixture.path, { headers: { Range: "bytes=0-99" } });
  assert.equal(response.status, 206, `${fixture.path}: range 206`);
  assert.equal(
    response.headers.get("Content-Range"),
    `bytes 0-99/${fixture.bytes.length}`,
    `${fixture.path}: Content-Range`,
  );
  if (checkLength) {
    assert.equal(response.headers.get("Content-Length"), "100", `${fixture.path}: range length`);
  }
  await expectBody(response, fixture.bytes.subarray(0, 100), `${fixture.path} range`);
}

async function expectHead(
  base: string,
  fixture: Fixture,
  get: Headers,
  names = ["Content-Type", "Content-Length", "ETag", "Cache-Control"],
): Promise<void> {
  const head = await send(base, fixture.path, { method: "HEAD" });
  assert.equal(head.status, 200, `HEAD ${fixture.path}: 200`);
  for (const name of names) {
    assert.equal(head.headers.get(name), get.get(name), `HEAD ${fixture.path}: ${name}`);
  }
  assert.equal((await head.arrayBuffer()).byteLength, 0, `HEAD ${fixture.path}: no body`);
}

async function expectTraversalRefused(base: string, prefix: string): Promise<void> {
  const { status, headers } = await sendRawPath(base, `${prefix}/../e2e/missing.html`);
  assert(status === 400 || status === 404, `${prefix} raw traversal: 400 or 404`);
  expectWorkerError(headers, `${prefix} raw traversal`);
}

async function assetMode(base: string, fixture: Fixture): Promise<void> {
  const response = await send(base, fixture.path);
  assert.equal(response.status, 200, `${fixture.path}: 200`);
  const headers = response.headers;
  assert.equal(headers.get("Content-Type"), "text/html; charset=utf-8", "asset Content-Type");
  assert.equal(headers.get("Cache-Control"), "public, max-age=300", "asset Cache-Control");
  assert.equal(headers.get("Access-Control-Allow-Origin"), "*", "asset CORS");
  assert.equal(headers.get("Content-Security-Policy"), SANDBOX, "asset CSP sandbox");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff", "asset nosniff");
  assert.equal(headers.get("Accept-Ranges"), "bytes", "asset Accept-Ranges");
  await expectBody(response, fixture.bytes, fixture.path);
  await expectHead(base, fixture, headers, ["Content-Type", "Cache-Control"]);
  await expectRange(base, fixture, false);
  await expectError(base, `/a/e2e/missing-${randomUUID()}.html`, 404);
  await expectError(base, "/a/e2e/fixture.unknown", 404);
  await expectError(base, "/a/e2e/.hidden.html", 400);
  await expectError(base, "/a/e2e%2Ffixture.html", 400);
  await expectError(base, "/a/e2e%5Cfixture.html", 400);
  await expectTraversalRefused(base, "/a/e2e");
  await expectMethodRefused(base, fixture.path);
}

async function textAssetMode(base: string, fixture: Fixture): Promise<void> {
  const response = await send(base, fixture.path);
  assert.equal(response.status, 200, `${fixture.path}: 200`);
  const headers = response.headers;
  assert.equal(headers.get("Content-Type"), "text/plain; charset=utf-8", "text Content-Type");
  assert.equal(headers.get("Content-Length"), String(fixture.bytes.length), "text length");
  assert.equal(headers.get("Cache-Control"), "public, max-age=300", "text Cache-Control");
  assert.equal(headers.get("Access-Control-Allow-Origin"), "*", "text CORS");
  assert.equal(headers.get("Content-Security-Policy"), null, "text has no sandbox");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff", "text nosniff");
  await expectBody(response, fixture.bytes, fixture.path);
  const etag = headers.get("ETag");
  assert(etag, "text ETag");
  await expectHead(base, fixture, headers);
  const notModified = await expectStatus(base, fixture.path, 304, {
    headers: { "If-None-Match": etag },
  });
  assert.equal(notModified.headers.get("ETag"), etag, "text 304 ETag");
  assert.equal(notModified.headers.get("Access-Control-Allow-Origin"), "*", "text 304 CORS");
  await expectRange(base, fixture);
}

async function forwardMode(base: string, fixture: Fixture): Promise<void> {
  const basename = fixture.path.split("/").at(-1) ?? "";
  const response = await send(base, fixture.path);
  assert.equal(response.status, 200, "forward 200");
  const headers = response.headers;
  assert.equal(headers.get("Content-Type"), "application/pdf", "forward Content-Type");
  assert.equal(
    headers.get("Content-Disposition"),
    `inline; filename*=UTF-8''${basename}`,
    "forward inline Content-Disposition",
  );
  assert.equal(headers.get("Content-Length"), String(fixture.bytes.length), "forward length");
  assert.equal(headers.get("Cache-Control"), "no-store", "forward no-store");
  assert.equal(headers.get("Content-Security-Policy"), null, "forward PDF has no sandbox");
  assert.equal(headers.get("Access-Control-Allow-Origin"), null, "forward has no CORS");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff", "forward nosniff");
  await expectBody(response, fixture.bytes, "forward");
  await expectHead(base, fixture, headers);
  await expectRange(base, fixture);
  await expectError(base, `/f/${randomUUID()}/${basename}`, 404);
  await expectError(base, `/f/not-a-uuid/${basename}`, 400);
  await expectError(base, `/f/${randomUUID().toUpperCase()}/${basename}`, 400);
  await expectError(base, `/f/${randomUUID()}/extra/${basename}`, 400);
  await expectError(base, `/f/${randomUUID()}/.${basename}`, 400);
}

if (import.meta.main) {
  try {
    const base = baseUrl(process.env.ASSETS_BASE_URL);
    const fixtures = await loadFixtures();
    await assetMode(base, fixtures.asset);
    await textAssetMode(base, fixtures.text);
    await forwardMode(base, fixtures.forward);
    console.log("Live E2E passed for asset and forward modes.");
  } catch (error) {
    console.error(
      `Live E2E failed: ${error instanceof assert.AssertionError ? error.message : "request error"}`,
    );
    process.exitCode = 1;
  }
}
