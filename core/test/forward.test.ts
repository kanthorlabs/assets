import { describe, expect, it } from "vitest";
import { createHandler, StorageUnavailable } from "../src/index.ts";
import { fakeAssets } from "./fake-assets.ts";

const BASE = "https://assets.test";
const ID = "7d444840-9dc0-41dc-9b52-0b2a3f3b1e4a";
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
const OBJECTS = {
  [`f/${ID}/report.pdf`]: { data: "%PDF-1.7", etag: '"f1"' },
  [`f/${ID}/demo.mp4`]: { data: "0123456789", etag: '"f2"' },
  [`f/${ID}/photo.PNG`]: { data: "png", etag: '"f3"' },
  [`f/${ID}/song.mp3`]: { data: "mp3", etag: '"f4"' },
  [`f/${ID}/page.html`]: { data: "<h1>x</h1>", etag: '"f5"' },
  [`f/${ID}/icon.svg`]: { data: "<svg/>", etag: '"f6"' },
  [`f/${ID}/bundle.zip`]: { data: "PK", etag: '"f7"' },
  [`f/${ID}/README`]: { data: "readme", etag: '"f8"' },
};

function setup() {
  const fake = fakeAssets(OBJECTS);
  return { ...fake, handle: createHandler({ assets: fake.assets }) };
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

describe("forward routing and validation", () => {
  it.each([
    ["one segment", "/f/report.pdf"],
    ["id without basename", `/f/${ID}`],
    ["three segments", `/f/${ID}/x/report.pdf`],
    ["uppercase id", `/f/${ID.toUpperCase()}/report.pdf`],
    ["UUIDv1", "/f/7d444840-9dc0-11dc-9b52-0b2a3f3b1e4a/report.pdf"],
    ["empty id", "/f//report.pdf"],
    ["dotfile basename", `/f/${ID}/.env`],
    ["encoded slash", `/f/${ID}%2Freport.pdf`],
    ["encoded parent inside the basename", `/f/${ID}/%2e%2e%2freport.pdf`],
    ["encoded space", `/f/${ID}/a%20b.pdf`],
    ["parent normalized into one segment", `/f/${ID}/../report.pdf`],
  ])("returns 400 without a read for %s", async (_name, path) => {
    const { handle, read } = setup();
    const response = await handle(request(path));
    expect(response.status).toBe(400);
    expectErrorHeaders(response);
    expect(await response.text()).toBe("Bad Request");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["empty forward path", "/f/"],
    ["prefix without slash", "/f"],
    ["trailing slash", `/f/${ID}/`],
    ["encoded parent normalized away", `/f/${ID}/%2e%2e`],
  ])("returns 404 without a read for %s", async (_name, path) => {
    const { handle, read } = setup();
    const response = await handle(request(path));
    expect(response.status).toBe(404);
    expectErrorHeaders(response);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"] as const)(
    "returns 404 after one %s read for a missing object",
    async (method) => {
      const { handle, read } = setup();
      const response = await handle(request(`/f/${ID}/missing.pdf`, { method }));
      expect(response.status).toBe(404);
      expectErrorHeaders(response);
      expect(read).toHaveBeenCalledExactlyOnceWith(`f/${ID}/missing.pdf`, method, undefined);
    },
  );

  it("ignores the query string", async () => {
    const { handle, read } = setup();
    const response = await handle(request(`/f/${ID}/report.pdf?download=1&x=../a/y`));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith(`f/${ID}/report.pdf`, "GET", undefined);
  });

  it.each(["POST", "OPTIONS"])("returns 405 with Allow for %s", async (method) => {
    const { handle, read } = setup();
    const response = await handle(request(`/f/${ID}/report.pdf`, { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("forward 200", () => {
  it("serves a PDF inline with the forward headers", async () => {
    const { handle, read } = setup();
    const response = await handle(request(`/f/${ID}/report.pdf`));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-disposition": "inline; filename*=UTF-8''report.pdf",
      "content-length": "8",
      "content-type": "application/pdf",
      etag: '"f1"',
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(await response.text()).toBe("%PDF-1.7");
    expect(read).toHaveBeenCalledExactlyOnceWith(`f/${ID}/report.pdf`, "GET", undefined);
  });

  it.each([
    ["report.pdf", "application/pdf", "inline", null],
    ["demo.mp4", "video/mp4", "inline", null],
    ["photo.PNG", "image/png", "inline", null],
    ["song.mp3", "audio/mpeg", "inline", null],
    ["page.html", "text/html; charset=utf-8", "inline", SANDBOX],
    ["icon.svg", "image/svg+xml; charset=utf-8", "inline", SANDBOX],
    ["bundle.zip", "application/octet-stream", "attachment", null],
    ["README", "application/octet-stream", "attachment", null],
  ])("serves %s as %s %s", async (basename, contentType, disposition, csp) => {
    const { handle } = setup();
    const response = await handle(request(`/f/${ID}/${basename}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Content-Disposition")).toBe(
      `${disposition}; filename*=UTF-8''${basename}`,
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns the GET status and headers for HEAD without a body", async () => {
    const { handle, read } = setup();
    const get = await handle(request(`/f/${ID}/demo.mp4`));
    const head = await handle(
      request(`/f/${ID}/demo.mp4`, { method: "HEAD", headers: { Range: "bytes=0-1" } }),
    );
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(head.body).toBeNull();
    expect(read).toHaveBeenLastCalledWith(`f/${ID}/demo.mp4`, "HEAD", undefined);
  });
});

describe("forward conditional and range", () => {
  it.each(['"f2"', 'W/"f2"', '"zz", W/"f2"', "*"])("returns 304 for %s", async (value) => {
    const { handle, read, cancelled } = setup();
    const response = await handle(
      request(`/f/${ID}/demo.mp4`, { headers: { "If-None-Match": value } }),
    );
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-store",
      etag: '"f2"',
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(cancelled).toEqual([`f/${ID}/demo.mp4`]);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["bytes=2-5", { offset: 2, length: 4 }, "bytes 2-5/10", "2345"],
    ["bytes=7-", { offset: 7, length: Number.POSITIVE_INFINITY }, "bytes 7-9/10", "789"],
    ["bytes=-3", { offset: -3, length: 3 }, "bytes 7-9/10", "789"],
  ])("returns 206 for %s", async (value, requested, contentRange, body) => {
    const { handle, read } = setup();
    const response = await handle(request(`/f/${ID}/demo.mp4`, { headers: { Range: value } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(response.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''demo.mp4");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.text()).toBe(body);
    expect(read).toHaveBeenCalledExactlyOnceWith(`f/${ID}/demo.mp4`, "GET", requested);
  });

  it.each(["bytes=10-", "bytes=20-30"])("returns 416 for %s", async (value) => {
    const { handle, read, cancelled } = setup();
    const response = await handle(request(`/f/${ID}/demo.mp4`, { headers: { Range: value } }));
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
    expectErrorHeaders(response);
    expect(cancelled).toEqual([`f/${ID}/demo.mp4`]);
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    ["multi-range", { Range: "bytes=0-1,3-4" }],
    ["malformed range", { Range: "bytes=abc" }],
    ["If-Range present", { Range: "bytes=0-1", "If-Range": '"f2"' }],
  ])("returns 200 with the full body for %s", async (_name, headers) => {
    const { handle, read } = setup();
    const response = await handle(request(`/f/${ID}/demo.mp4`, { headers }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Range")).toBeNull();
    expect(await response.text()).toBe("0123456789");
    expect(read).toHaveBeenCalledExactlyOnceWith(`f/${ID}/demo.mp4`, "GET", undefined);
  });
});

describe("forward storage errors", () => {
  it.each([
    ["StorageUnavailable", new StorageUnavailable("r2 secret detail"), 503, "Service Unavailable"],
    ["any other error", new Error("internal secret detail"), 500, "Internal Server Error"],
  ])("maps %s without leaked text", async (_name, error, status, body) => {
    const handle = createHandler({
      assets: {
        read: async () => {
          throw error;
        },
      },
    });
    const response = await handle(request(`/f/${ID}/report.pdf`));
    expect(response.status).toBe(status);
    expectErrorHeaders(response);
    expect(await response.text()).toBe(body);
  });
});
