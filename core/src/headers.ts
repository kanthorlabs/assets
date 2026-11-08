import { contentTypeFor } from "./content-type.ts";
import type { AssetObject } from "./ports.ts";
import { contentRange } from "./range.ts";

export const ASSET_MAX_AGE_SECONDS = 300;

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const SANDBOX_POLICY =
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
const SANDBOXED_TYPES = new Set(["text/html", "image/svg+xml"]);
const DOWNLOAD_TYPE = "application/octet-stream";

const ASSET_CACHE = {
  "Cache-Control": `public, max-age=${ASSET_MAX_AGE_SECONDS}`,
  "Access-Control-Allow-Origin": "*",
};
const FORWARD_CACHE = { "Cache-Control": "no-store" };
const HOME_CACHE = { "Cache-Control": `public, max-age=${ASSET_MAX_AGE_SECONDS}` };
const IP_CACHE = { "Cache-Control": "no-store", Vary: "Accept" };

export function homeHeaders(contentLength: number): Headers {
  return textHeaders(HOME_CACHE, "text/plain; charset=utf-8", contentLength);
}

export function ipHeaders(contentType: string, contentLength: number): Headers {
  return textHeaders(IP_CACHE, contentType, contentLength);
}

function textHeaders(
  cache: Record<string, string>,
  contentType: string,
  contentLength: number,
): Headers {
  return new Headers({
    ...SECURITY_HEADERS,
    ...cache,
    "Content-Type": contentType,
    "Content-Length": String(contentLength),
  });
}

export function notModifiedHeaders(etag: string): Headers {
  return new Headers({ ...SECURITY_HEADERS, ETag: etag, ...ASSET_CACHE });
}

export function forwardNotModifiedHeaders(etag: string): Headers {
  return new Headers({ ...SECURITY_HEADERS, ETag: etag, ...FORWARD_CACHE });
}

export function assetHeaders(contentType: string, object: AssetObject): Headers {
  return objectHeaders(notModifiedHeaders(object.etag), contentType, object);
}

export function forwardHeaders(basename: string, object: AssetObject): Headers {
  const contentType = contentTypeFor(basename);
  const headers = objectHeaders(
    forwardNotModifiedHeaders(object.etag),
    contentType ?? DOWNLOAD_TYPE,
    object,
  );
  const disposition = contentType ? "inline" : "attachment";
  headers.set(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(basename)}`,
  );
  return headers;
}

function objectHeaders(headers: Headers, contentType: string, object: AssetObject): Headers {
  headers.set("Content-Type", contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(object.range?.length ?? object.size));
  if (object.range) headers.set("Content-Range", contentRange(object.range, object.size));
  if (SANDBOXED_TYPES.has(contentType.split(";")[0])) {
    headers.set("Content-Security-Policy", SANDBOX_POLICY);
  }
  return headers;
}
