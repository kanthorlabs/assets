export type Route = { mode: "asset"; path: string };

const ASSET_PREFIX = "/a/";

export function route(pathname: string): Route | null {
  if (!pathname.startsWith(ASSET_PREFIX) || pathname.endsWith("/")) return null;
  return { mode: "asset", path: pathname.slice(ASSET_PREFIX.length) };
}
