import { contentTypeFor } from "./content-type.ts";
import { errorResponse } from "./errors.ts";
import { weakMatch } from "./etag.ts";
import { assetHeaders, notModifiedHeaders } from "./headers.ts";
import { type AssetReader, StorageUnavailable } from "./ports.ts";
import { parseRange } from "./range.ts";
import { route } from "./route.ts";
import { isValidAssetPath } from "./validate.ts";

type Method = "GET" | "HEAD";

export function createHandler(deps: { assets: AssetReader }): (req: Request) => Promise<Response> {
  return async (req) => {
    const response = await serve(deps.assets, req).catch(failure);
    return req.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  };
}

function failure(error: unknown): Response {
  return errorResponse(error instanceof StorageUnavailable ? 503 : 500);
}

async function serve(assets: AssetReader, req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return errorResponse(405, { Allow: "GET, HEAD" });
  }
  const target = route(new URL(req.url).pathname);
  if (!target) return errorResponse(404);
  return serveAsset(assets, req, req.method, target.path);
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
  const range =
    method === "GET" && !req.headers.has("If-Range")
      ? parseRange(req.headers.get("Range"))
      : undefined;
  const object = await assets.read(`a/${path}`, method, range);
  if (!object) return errorResponse(404);
  if (range && range.offset >= object.size) {
    await object.body?.cancel();
    return errorResponse(416, { "Content-Range": `bytes */${object.size}` });
  }
  if (weakMatch(req.headers.get("If-None-Match"), object.etag)) {
    await object.body?.cancel();
    return new Response(null, { status: 304, headers: notModifiedHeaders(object.etag) });
  }
  return new Response(method === "HEAD" ? null : object.body, {
    status: object.range ? 206 : 200,
    headers: assetHeaders(contentType, object),
  });
}
