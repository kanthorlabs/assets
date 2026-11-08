import { describe, expect, it } from "vitest";
import { createHandler, StorageUnavailable } from "../src/index.ts";
import { fakeAssets, noInfo } from "./fake-assets.ts";

const BASE = "https://assets.test";
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
const OBJECTS = {
  "a/index.html": { data: "<h1>hi</h1>", etag: '"e1"' },
  "a/img/Logo.SVG": { data: "<svg/>", etag: '"e2"' },
  "a/doc.pdf": { data: "%PDF-1.7", etag: '"e3"' },
  "a/app.js": { data: "export {}", etag: '"e4"' },
  "a/video.mp4": { data: "0123456789", etag: '"e5"' },
};

function setup() {
  const fake = fakeAssets(OBJECTS);
  return { ...fake, handle: createHandler({ ...noInfo, assets: fake.assets }) };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

function expectErrorHeaders(response: Response) {
  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

describe("routing and validation", () => {
  it.each([
    ["ip with trailing slash", "/ip/"],
    ["unknown prefix", "/x"],
    ["prefix without slash", "/a"],
    ["empty asset path", "/a/"],
    ["trailing slash", "/a/img/"],
    ["unknown extension", "/a/tool.exe"],
    ["no extension", "/a/README"],
    ["encoded parent normalized away", "/a/%2e%2e/index.html"],
  ])("returns 404 without a read for %s", async (_name, path) => {
    const { handle, read } = setup();
    const response = await handle(request(path));
    expect(response.status).toBe(404);
    expectErrorHeaders(response);
    expect(await response.text()).toBe("Not Found");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["parent segment normalized into the forward prefix", "/a/../f/x.pdf"],
    ["encoded slash", "/a/x%2Fy.html"],
    ["encoded parent inside a segment", "/a/img/..%2f..%2fsecret.html"],
    ["encoded dot prefix", "/a/%2ehidden.html"],
    ["double slash", "/a//index.html"],
    ["dotfile", "/a/.env.html"],
    ["encoded space", "/a/a%20b.html"],
    ["encoded null", "/a/x%00.html"],
    ["nine segments", "/a/a/b/c/d/e/f/g/h/i.css"],
    ["overlong path", `/a/${"x".repeat(996)}.html`],
  ])("returns 400 without a read for %s", async (_name, path) => {
    const { handle, read } = setup();
    const response = await handle(request(path));
    expect(response.status).toBe(400);
    expectErrorHeaders(response);
    expect(await response.text()).toBe("Bad Request");
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a backslash path only under the asset prefix", async () => {
    const { handle, read } = setup();
    const response = await handle(request("/a/img\\Logo.SVG"));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith("a/img/Logo.SVG", "GET", undefined);
  });

  it("returns 404 after one read for a missing asset", async () => {
    const { handle, read } = setup();
    const response = await handle(request("/a/missing.html"));
    expect(response.status).toBe(404);
    expectErrorHeaders(response);
    expect(read).toHaveBeenCalledExactlyOnceWith("a/missing.html", "GET", undefined);
  });

  it("ignores the query string", async () => {
    const { handle, read } = setup();
    const response = await handle(request("/a/index.html?v=1&path=../f/x.pdf"));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith("a/index.html", "GET", undefined);
  });
});

describe("methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "returns 405 with Allow for %s",
    async (method) => {
      const { handle, read } = setup();
      const response = await handle(request("/a/index.html", { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
      expectErrorHeaders(response);
      expect(await response.text()).toBe("Method Not Allowed");
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("returns the GET status and headers for HEAD without a body", async () => {
    const { handle, read } = setup();
    const get = await handle(request("/a/video.mp4"));
    const head = await handle(request("/a/video.mp4", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(head.body).toBeNull();
    expect(read).toHaveBeenLastCalledWith("a/video.mp4", "HEAD", undefined);
  });

  it("ignores Range on HEAD", async () => {
    const { handle, read } = setup();
    const head = await handle(
      request("/a/video.mp4", { method: "HEAD", headers: { Range: "bytes=0-1" } }),
    );
    expect(head.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith("a/video.mp4", "HEAD", undefined);
  });

  it.each([
    ["/x", 404],
    ["/a/x%2Fy.html", 400],
    ["/a/missing.html", 404],
  ])("returns the error status for HEAD %s without a body", async (path, status) => {
    const { handle } = setup();
    const response = await handle(request(path, { method: "HEAD" }));
    expect(response.status).toBe(status);
    expectErrorHeaders(response);
    expect(response.body).toBeNull();
  });
});

describe("asset 200", () => {
  it("serves the object with the asset headers", async () => {
    const { handle, read } = setup();
    const response = await handle(request("/a/index.html"));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "access-control-allow-origin": "*",
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=300",
      "content-length": "11",
      "content-security-policy": SANDBOX,
      "content-type": "text/html; charset=utf-8",
      etag: '"e1"',
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(await response.text()).toBe("<h1>hi</h1>");
    expect(read).toHaveBeenCalledExactlyOnceWith("a/index.html", "GET", undefined);
  });

  it.each([
    ["/a/index.html", "text/html; charset=utf-8", SANDBOX],
    ["/a/img/Logo.SVG", "image/svg+xml; charset=utf-8", SANDBOX],
    ["/a/doc.pdf", "application/pdf", null],
    ["/a/app.js", "text/javascript; charset=utf-8", null],
    ["/a/video.mp4", "video/mp4", null],
  ])("sets Content-Type and CSP for %s", async (path, contentType, csp) => {
    const { handle } = setup();
    const response = await handle(request(path));
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("If-None-Match", () => {
  it.each(['"e1"', 'W/"e1"', '"zz", W/"e1"', "*"])("returns 304 for %s", async (value) => {
    const { handle, read, cancelled } = setup();
    const response = await handle(
      request("/a/index.html", { headers: { "If-None-Match": value } }),
    );
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get("ETag")).toBe('"e1"');
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(cancelled).toEqual(["a/index.html"]);
    expect(read).toHaveBeenCalledOnce();
  });

  it("matches a weak stored ETag", async () => {
    const fake = fakeAssets({ "a/site.css": { data: "a{}", etag: 'W/"c1"' } });
    const handle = createHandler({ ...noInfo, assets: fake.assets });
    const response = await handle(request("/a/site.css", { headers: { "If-None-Match": '"c1"' } }));
    expect(response.status).toBe(304);
  });

  it("returns 200 when no tag matches", async () => {
    const { handle, cancelled } = setup();
    const response = await handle(
      request("/a/index.html", { headers: { "If-None-Match": '"zz"' } }),
    );
    expect(response.status).toBe(200);
    expect(cancelled).toEqual([]);
  });
});

describe("Range", () => {
  it.each([
    ["bytes=2-5", { offset: 2, length: 4 }, "bytes 2-5/10", "2345"],
    ["bytes=7-", { offset: 7, length: Number.POSITIVE_INFINITY }, "bytes 7-9/10", "789"],
    ["bytes=-3", { offset: -3, length: 3 }, "bytes 7-9/10", "789"],
    ["bytes=8-100", { offset: 8, length: 93 }, "bytes 8-9/10", "89"],
    ["bytes=0-0", { offset: 0, length: 1 }, "bytes 0-0/10", "0"],
  ])("returns 206 for %s", async (value, requested, contentRange, body) => {
    const { handle, read } = setup();
    const response = await handle(request("/a/video.mp4", { headers: { Range: value } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe(body);
    expect(read).toHaveBeenCalledExactlyOnceWith("a/video.mp4", "GET", requested);
  });

  it.each(["bytes=10-", "bytes=20-30"])("returns 416 for %s", async (value) => {
    const { handle, read, cancelled } = setup();
    const response = await handle(request("/a/video.mp4", { headers: { Range: value } }));
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expectErrorHeaders(response);
    expect(await response.text()).toBe("Range Not Satisfiable");
    expect(cancelled).toEqual(["a/video.mp4"]);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["multi-range", { Range: "bytes=0-1,3-4" }],
    ["reversed range", { Range: "bytes=5-2" }],
    ["unknown unit", { Range: "items=0-1" }],
    ["empty range", { Range: "bytes=-" }],
    ["zero suffix", { Range: "bytes=-0" }],
    ["non-numeric", { Range: "bytes=abc" }],
    ["unsafe integer", { Range: "bytes=99999999999999999999-" }],
    ["mismatched If-Range", { Range: "bytes=0-1", "If-Range": '"old"' }],
    ["weak If-Range", { Range: "bytes=0-1", "If-Range": 'W/"e5"' }],
  ])("returns 200 with the full body for %s", async (_name, headers) => {
    const { handle, read } = setup();
    const response = await handle(request("/a/video.mp4", { headers }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(await response.text()).toBe("0123456789");
    expect(read).toHaveBeenCalledExactlyOnceWith("a/video.mp4", "GET", undefined);
  });
});

describe("storage errors", () => {
  it.each([
    ["StorageUnavailable", new StorageUnavailable("r2 secret detail"), 503, "Service Unavailable"],
    ["any other error", new Error("internal secret detail"), 500, "Internal Server Error"],
  ])("maps %s without leaked text", async (_name, error, status, body) => {
    const handle = createHandler({
      ...noInfo,
      assets: {
        read: async () => {
          throw error;
        },
      },
    });
    const response = await handle(request("/a/index.html"));
    expect(response.status).toBe(status);
    expectErrorHeaders(response);
    expect(await response.text()).toBe(body);
  });
});
