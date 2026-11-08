import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import readme from "../../README.md?raw";
import worker from "../src/index.ts";
import { countedBucket, failingBucket, unsatisfiableRangeBucket } from "./buckets.ts";

const BASE = "https://assets.test";
const PAGE = "<!doctype html><h1>hello</h1>";
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
const ID = "7d444840-9dc0-41dc-9b52-0b2a3f3b1e4a";
const REPORT = `/f/${ID}/report.pdf`;
const DEMO = `/f/${ID}/demo.mp4`;
const CLIENT_IP = "198.51.100.23";
let pageEtag = "";
let reportEtag = "";

beforeAll(async () => {
  const page = await env.ASSETS_BUCKET.put("a/hello.html", PAGE);
  pageEtag = page?.httpEtag ?? "";
  await env.ASSETS_BUCKET.put("a/media/clip.mp4", "0123456789");
  const report = await env.ASSETS_BUCKET.put(`f/${ID}/report.pdf`, "%PDF-1.7");
  reportEtag = report?.httpEtag ?? "";
  await env.ASSETS_BUCKET.put(`f/${ID}/demo.mp4`, "0123456789");
  await env.ASSETS_BUCKET.put(`f/${ID}/bundle.zip`, "PK");
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

  it.each(["bytes=10-", "bytes=999999999999-"])(
    "answers %s with 416 when R2 rejects the range with 10039",
    async (range) => {
      const bucket = unsatisfiableRangeBucket(env.ASSETS_BUCKET);
      const response = await fetchWorker(
        "/a/media/clip.mp4",
        { headers: { Range: range } },
        bucket,
      );
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
      expectErrorHeaders(response);
    },
  );

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

describe("worker forward mode on R2", () => {
  it("serves a seeded PDF inline with no-store", async () => {
    const response = await fetchWorker(REPORT);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": "inline; filename*=UTF-8''report.pdf",
      "content-length": "8",
      etag: reportEtag,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(await response.text()).toBe("%PDF-1.7");
  });

  it("serves an unknown extension as an octet-stream attachment", async () => {
    const response = await fetchWorker(`/f/${ID}/bundle.zip`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''bundle.zip",
    );
    expect(await response.text()).toBe("PK");
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const get = await fetchWorker(DEMO);
    const head = await fetchWorker(DEMO, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(await head.text()).toBe("");
    await get.body?.cancel();
  });

  it.each([
    ["bytes=2-4", "bytes 2-4/10", "234"],
    ["bytes=6-", "bytes 6-9/10", "6789"],
    ["bytes=-3", "bytes 7-9/10", "789"],
  ])("serves %s as 206 with the exact R2 bytes", async (range, contentRange, bytes) => {
    const response = await fetchWorker(DEMO, { headers: { Range: range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe(bytes);
  });

  it("answers a range past the end with 416", async () => {
    const response = await fetchWorker(DEMO, { headers: { Range: "bytes=10-" } });
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expectErrorHeaders(response);
  });

  it("answers 304 to the returned ETag in weak form without CORS", async () => {
    const response = await fetchWorker(REPORT, { headers: { "If-None-Match": `W/${reportEtag}` } });
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(reportEtag);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("answers 404 for a random id", async () => {
    const response = await fetchWorker(`/f/${crypto.randomUUID()}/report.pdf`);
    expect(response.status).toBe(404);
    expectErrorHeaders(response);
  });

  it("answers 400 for a malformed id", async () => {
    const response = await fetchWorker("/f/not-a-uuid/report.pdf");
    expect(response.status).toBe(400);
    expectErrorHeaders(response);
  });

  it("answers 404 at once after the object is deleted", async () => {
    const path = `/f/${crypto.randomUUID()}/revoked.pdf`;
    await env.ASSETS_BUCKET.put(path.slice(1), "%PDF-1.7");
    const before = await fetchWorker(path);
    expect(before.status).toBe(200);
    await before.body?.cancel();
    await env.ASSETS_BUCKET.delete(path.slice(1));
    const after = await fetchWorker(path);
    expect(after.status).toBe(404);
    expectErrorHeaders(after);
  });

  it.each(["GET", "HEAD"])("answers %s with 503 when storage fails", async (method) => {
    const response = await fetchWorker(REPORT, { method }, failingBucket());
    expect(response.status).toBe(503);
    expectErrorHeaders(response);
  });
});

describe("worker home and ip", () => {
  it("serves the bundled README at /", async () => {
    const response = await fetchWorker("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Content-Length")).toBe(
      String(new TextEncoder().encode(readme).byteLength),
    );
    const body = await response.text();
    expect(body.startsWith("# Assets\n")).toBe(true);
    expect(body).toBe(readme);
  });

  it("serves the CF-Connecting-IP value at /ip", async () => {
    const response = await fetchWorker("/ip", { headers: { "CF-Connecting-IP": CLIENT_IP } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(await response.text()).toBe(CLIENT_IP);
  });

  it("serves the CF-Connecting-IP value as JSON at /ip", async () => {
    const response = await fetchWorker("/ip", {
      headers: { "CF-Connecting-IP": CLIENT_IP, Accept: "application/json" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ip: CLIENT_IP });
  });

  it("answers 500 at /ip without CF-Connecting-IP", async () => {
    const response = await fetchWorker("/ip");
    expect(response.status).toBe(500);
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
    ["forward GET 200", REPORT, {}, ["get"]],
    ["forward HEAD 200", REPORT, { method: "HEAD" }, ["head"]],
    ["forward GET 206", DEMO, { headers: { Range: "bytes=0-3" } }, ["get"]],
    ["forward GET 416", DEMO, { headers: { Range: "bytes=10-" } }, ["get"]],
    ["forward GET 304", REPORT, { headers: { "If-None-Match": "*" } }, ["get"]],
    ["forward GET 404 missing", `/f/${ID}/missing.pdf`, {}, ["get"]],
    ["forward HEAD 404 missing", `/f/${ID}/missing.pdf`, { method: "HEAD" }, ["head"]],
    ["forward 400 uppercase id", `/f/${ID.toUpperCase()}/report.pdf`, {}, []],
    ["forward 400 one segment", "/f/report.pdf", {}, []],
    ["forward 400 dotfile", `/f/${ID}/.env`, {}, []],
    ["forward 404 trailing slash", `/f/${ID}/`, {}, []],
    ["forward 405 method", REPORT, { method: "OPTIONS" }, []],
    ["GET home", "/", {}, []],
    ["HEAD home", "/", { method: "HEAD" }, []],
    ["GET ip", "/ip", { headers: { "CF-Connecting-IP": CLIENT_IP } }, []],
    ["HEAD ip", "/ip", { method: "HEAD", headers: { "CF-Connecting-IP": CLIENT_IP } }, []],
  ] as const)("%s makes the expected R2 calls", async (_name, path, init, expected) => {
    const { bucket, calls } = countedBucket(env.ASSETS_BUCKET);
    const response = await fetchWorker(path, init, bucket);
    await response.body?.cancel();
    expect(calls).toEqual(expected);
  });

  it.each([
    ["GET 416", "/a/media/clip.mp4"],
    ["forward GET 416", DEMO],
  ])("%s on a 10039 rejection makes a get and a head", async (_name, path) => {
    const { bucket, calls } = countedBucket(unsatisfiableRangeBucket(env.ASSETS_BUCKET));
    const response = await fetchWorker(path, { headers: { Range: "bytes=10-" } }, bucket);
    expect(response.status).toBe(416);
    expect(calls).toEqual(["get", "head"]);
  });
});
