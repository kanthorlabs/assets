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

export function notModifiedHeaders(etag: string): Headers {
  return new Headers({
    ...SECURITY_HEADERS,
    ETag: etag,
    "Cache-Control": `public, max-age=${ASSET_MAX_AGE_SECONDS}`,
    "Access-Control-Allow-Origin": "*",
  });
}

export function assetHeaders(contentType: string, object: AssetObject): Headers {
  const headers = notModifiedHeaders(object.etag);
  headers.set("Content-Type", contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(object.range?.length ?? object.size));
  if (object.range) headers.set("Content-Range", contentRange(object.range, object.size));
  if (SANDBOXED_TYPES.has(contentType.split(";")[0])) {
    headers.set("Content-Security-Policy", SANDBOX_POLICY);
  }
  return headers;
}
