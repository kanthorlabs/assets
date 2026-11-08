import { SECURITY_HEADERS } from "./headers.ts";

const REASONS = {
  400: "Bad Request",
  404: "Not Found",
  405: "Method Not Allowed",
  416: "Range Not Satisfiable",
  500: "Internal Server Error",
  503: "Service Unavailable",
} as const;

export function errorResponse(status: keyof typeof REASONS, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(REASONS[status], { status, headers });
}
