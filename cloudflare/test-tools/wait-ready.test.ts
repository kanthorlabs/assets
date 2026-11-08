import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { baseUrl } from "../scripts/client.ts";
import { READINESS_PATH, waitReady } from "../scripts/wait-ready.ts";

async function withServer(
  status: number,
  run: (base: string, paths: string[]) => Promise<void>,
): Promise<void> {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end("Bad Request");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, paths);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("accepts HTTPS origins and HTTP only on loopback hosts", () => {
  assert.equal(baseUrl("https://assets.example.com"), "https://assets.example.com");
  assert.equal(baseUrl("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
  assert.throws(() => baseUrl(undefined), /Missing ASSETS_BASE_URL/);
  assert.throws(() => baseUrl("http://assets.example.com"), /HTTPS/);
  assert.throws(() => baseUrl("https://assets.example.com/a"), /origin/);
});

test("is ready when the malformed forward id returns the Worker 400", async () => {
  await withServer(400, async (base, paths) => {
    assert.equal(await waitReady(base, 3, 1), true);
    assert.deepEqual(paths, [READINESS_PATH]);
  });
});

test("gives up after the bounded attempts on any other answer", async () => {
  await withServer(404, async (base, paths) => {
    assert.equal(await waitReady(base, 2, 1), false);
    assert.equal(paths.length, 2);
  });
});
