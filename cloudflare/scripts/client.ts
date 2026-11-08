import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export function baseUrl(value: string | undefined): string {
  if (!value) throw new Error("Missing ASSETS_BASE_URL");
  const url = new URL(value);
  if (url.origin !== value) throw new Error("ASSETS_BASE_URL must be an origin without a path");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    throw new Error("ASSETS_BASE_URL must use HTTPS, or HTTP on a loopback host");
  return value;
}

export function send(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}

export function sendRawPath(
  base: string,
  path: string,
): Promise<{ status: number; headers: Headers }> {
  const url = new URL(base);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: url.hostname,
        port: url.port,
        path,
        method: "GET",
        headers: { "Accept-Encoding": "identity" },
        timeout: 30_000,
      },
      (incoming) => {
        incoming.resume();
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        resolve({ status: incoming.statusCode ?? 0, headers });
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("Request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}
