import { acceptsJson } from "./accept.ts";
import { contentTypeFor } from "./content-type.ts";
import { errorResponse } from "./errors.ts";
import { weakMatch } from "./etag.ts";
import {
  assetHeaders,
  forwardHeaders,
  forwardNotModifiedHeaders,
  homeHeaders,
  ipHeaders,
  notModifiedHeaders,
} from "./headers.ts";
import { type AssetObject, type AssetReader, StorageUnavailable } from "./ports.ts";
import { parseRange } from "./range.ts";
import { route } from "./route.ts";
import { isValidAssetPath, isValidForwardPath } from "./validate.ts";

type Method = "GET" | "HEAD";

type HeaderPolicy = {
  object: (object: AssetObject) => Headers;
  notModified: (etag: string) => Headers;
};

export type HandlerDeps = {
  assets: AssetReader;
  home: string;
  clientIp: (req: Request) => string | null;
};

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const response = await serve(deps, req).catch(failure);
    return req.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  };
}

function failure(error: unknown): Response {
  return errorResponse(error instanceof StorageUnavailable ? 503 : 500);
}

async function serve(deps: HandlerDeps, req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return errorResponse(405, { Allow: "GET, HEAD" });
  }
  const target = route(new URL(req.url).pathname);
  if (!target) return errorResponse(404);
  switch (target.mode) {
    case "home":
      return new Response(deps.home, { status: 200, headers: homeHeaders(byteLength(deps.home)) });
    case "ip":
      return serveIp(deps.clientIp(req), req);
    case "asset":
      return serveAsset(deps.assets, req, req.method, target.path);
    case "forward":
      return serveForward(deps.assets, req, req.method, target.path);
  }
}

function serveIp(ip: string | null, req: Request): Response {
  if (!ip) return errorResponse(500);
  const json = acceptsJson(req.headers.get("Accept"));
  const body = json ? JSON.stringify({ ip }) : ip;
  const contentType = json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
  return new Response(body, { status: 200, headers: ipHeaders(contentType, byteLength(body)) });
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

async function serveAsset(
  assets: AssetReader,
  req: Request,
  method: Method,
  path: string,
): Promise<Response> {
  if (!isValidAssetPath(path)) return errorResponse(400);
  const contentType = contentTypeFor(path.slice(path.lastIndexOf("/") + 1));
  if (!contentType) return errorResponse(404);
  return serveObject(assets, req, method, `a/${path}`, {
    object: (object) => assetHeaders(contentType, object),
    notModified: notModifiedHeaders,
  });
}

async function serveForward(
  assets: AssetReader,
  req: Request,
  method: Method,
  path: string,
): Promise<Response> {
  if (!isValidForwardPath(path)) return errorResponse(400);
  const basename = path.slice(path.indexOf("/") + 1);
  return serveObject(assets, req, method, `f/${path}`, {
    object: (object) => forwardHeaders(basename, object),
    notModified: forwardNotModifiedHeaders,
  });
}

async function serveObject(
  assets: AssetReader,
  req: Request,
  method: Method,
  key: string,
  headers: HeaderPolicy,
): Promise<Response> {
  const range =
    method === "GET" && !req.headers.has("If-Range")
      ? parseRange(req.headers.get("Range"))
      : undefined;
  const object = await assets.read(key, method, range);
  if (!object) return errorResponse(404);
  if (range && range.offset >= object.size) {
    await object.body?.cancel();
    return errorResponse(416, { "Content-Range": `bytes */${object.size}` });
  }
  if (weakMatch(req.headers.get("If-None-Match"), object.etag)) {
    await object.body?.cancel();
    return new Response(null, { status: 304, headers: headers.notModified(object.etag) });
  }
  return new Response(method === "HEAD" ? null : object.body, {
    status: object.range ? 206 : 200,
    headers: headers.object(object),
  });
}
