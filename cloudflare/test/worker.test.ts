import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { countedBucket, failingBucket } from "./buckets.ts";

const BASE = "https://assets.test";
const PAGE = "<!doctype html><h1>hello</h1>";
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
let pageEtag = "";

beforeAll(async () => {
  const page = await env.ASSETS_BUCKET.put("a/hello.html", PAGE);
  pageEtag = page?.httpEtag ?? "";
  await env.ASSETS_BUCKET.put("a/media/clip.mp4", "0123456789");
});

function fetchWorker(path: string, init: RequestInit = {}, bucket = env.ASSETS_BUCKET) {
  const request = new Request(`${BASE}${path}`, init) as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  return worker.fetch(request, { ...env, ASSETS_BUCKET: bucket });
}

function expectErrorHeaders(response: Response) {
  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("worker asset mode on R2", () => {
  it("serves a seeded page with 200 and the asset headers", async () => {
    const response = await fetchWorker("/a/hello.html");
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-length": String(PAGE.length),
      "content-security-policy": SANDBOX,
      etag: pageEtag,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    expect(await response.text()).toBe(PAGE);
  });

  it("answers HEAD with the GET Content-Length and no body", async () => {
    const get = await fetchWorker("/a/media/clip.mp4");
    const head = await fetchWorker("/a/media/clip.mp4", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe(get.headers.get("Content-Length"));
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(head.headers.get("ETag")).toBe(get.headers.get("ETag"));
    expect(await head.text()).toBe("");
    await get.body?.cancel();
  });

  it.each([
    ["bytes=2-4", "bytes 2-4/10", "234"],
    ["bytes=6-", "bytes 6-9/10", "6789"],
    ["bytes=-3", "bytes 7-9/10", "789"],
  ])("serves %s as 206 with the exact R2 bytes", async (range, contentRange, bytes) => {
    const response = await fetchWorker("/a/media/clip.mp4", { headers: { Range: range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(await response.text()).toBe(bytes);
  });

  it.each(["bytes=10-", "bytes=12-20"])("answers %s with 416", async (range) => {
    const response = await fetchWorker("/a/media/clip.mp4", { headers: { Range: range } });
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expectErrorHeaders(response);
  });

  it("answers 304 to the returned ETag in weak form", async () => {
    const response = await fetchWorker("/a/hello.html", {
      headers: { "If-None-Match": `W/${pageEtag}` },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(pageEtag);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe("");
  });

  it("answers 404 for a missing object", async () => {
    const response = await fetchWorker("/a/missing.html");
    expect(response.status).toBe(404);
    expectErrorHeaders(response);
    expect(await response.text()).toBe("Not Found");
  });

  it.each(["GET", "HEAD"])("answers %s with 503 when storage fails", async (method) => {
    const response = await fetchWorker("/a/hello.html", { method }, failingBucket());
    expect(response.status).toBe(503);
    expectErrorHeaders(response);
  });
});

describe("worker R2 call count", () => {
  it.each([
    ["GET 200", "/a/hello.html", {}, ["get"]],
    ["HEAD 200", "/a/hello.html", { method: "HEAD" }, ["head"]],
    ["GET 206", "/a/media/clip.mp4", { headers: { Range: "bytes=0-3" } }, ["get"]],
    ["GET 416", "/a/media/clip.mp4", { headers: { Range: "bytes=10-" } }, ["get"]],
    ["GET 304", "/a/hello.html", { headers: { "If-None-Match": "*" } }, ["get"]],
    ["GET 404 missing", "/a/missing.html", {}, ["get"]],
    ["HEAD 404 missing", "/a/missing.html", { method: "HEAD" }, ["head"]],
    ["400 traversal", "/a/..%2Fsecret.html", {}, []],
    ["400 dotfile", "/a/.env.json", {}, []],
    ["404 unknown extension", "/a/tool.exe", {}, []],
    ["404 unknown prefix", "/x/hello.html", {}, []],
    ["405 method", "/a/hello.html", { method: "POST" }, []],
  ] as const)("%s makes the expected R2 calls", async (_name, path, init, expected) => {
    const { bucket, calls } = countedBucket(env.ASSETS_BUCKET);
    const response = await fetchWorker(path, init, bucket);
    await response.body?.cancel();
    expect(calls).toEqual(expected);
  });
});
