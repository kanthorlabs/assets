import { describe, expect, it } from "vitest";
import { createHandler } from "../src/index.ts";
import { fakeAssets } from "./fake-assets.ts";

const BASE = "https://assets.test";
const HOME = "# Assets\n\nDiátaxis\n";
const IP = "203.0.113.7";

function setup(ip: string | null = IP) {
  const fake = fakeAssets({});
  const handle = createHandler({ assets: fake.assets, home: HOME, clientIp: () => ip });
  return { ...fake, handle };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

describe("home", () => {
  it("serves the home text with 200 and the home headers", async () => {
    const { handle, read } = setup();
    const response = await handle(request("/?v=1"));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "public, max-age=300",
      "content-length": String(new TextEncoder().encode(HOME).byteLength),
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(await response.text()).toBe(HOME);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const { handle, read } = setup();
    const get = await handle(request("/"));
    const head = await handle(request("/", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.body).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("ip", () => {
  it.each([
    ["missing Accept", undefined],
    ["*/*", "*/*"],
    ["text/html", "text/html"],
    ["application/jsonx", "application/jsonx"],
  ])("serves plain text for %s", async (_name, accept) => {
    const { handle, read } = setup();
    const headers: HeadersInit = accept === undefined ? {} : { Accept: accept };
    const response = await handle(request("/ip?x=1", { headers }));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-store",
      "content-length": String(IP.length),
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      vary: "Accept",
      "x-content-type-options": "nosniff",
    });
    expect(await response.text()).toBe(IP);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    "application/json",
    "application/json;q=0.9",
    "text/html, application/json",
    "text/html;q=0.8, Application/JSON ; charset=utf-8",
  ])("serves JSON for Accept %s", async (accept) => {
    const { handle, read } = setup();
    const response = await handle(request("/ip", { headers: { Accept: accept } }));
    const body = JSON.stringify({ ip: IP });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ip: IP });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const { handle } = setup();
    const get = await handle(request("/ip"));
    const head = await handle(request("/ip", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(head.body).toBeNull();
  });

  it("returns 500 without a read when no client IP is available", async () => {
    const { handle, read } = setup(null);
    const response = await handle(request("/ip"));
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("Internal Server Error");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("home and ip errors", () => {
  it.each(["/", "/ip"])("returns 405 with Allow for POST %s", async (path) => {
    const { handle, read } = setup();
    const response = await handle(request(path, { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["/ip/", "/IP", "/ip.json"])("returns 404 without a read for %s", async (path) => {
    const { handle, read } = setup();
    const response = await handle(request(path));
    expect(response.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});
