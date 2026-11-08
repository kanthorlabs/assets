export type Route = { mode: "asset" | "forward"; path: string };

const ASSET_PREFIX = "/a/";
const FORWARD_PREFIX = "/f/";

export function route(pathname: string): Route | null {
  if (pathname.endsWith("/")) return null;
  if (pathname.startsWith(ASSET_PREFIX)) {
    return { mode: "asset", path: pathname.slice(ASSET_PREFIX.length) };
  }
  if (pathname.startsWith(FORWARD_PREFIX)) {
    return { mode: "forward", path: pathname.slice(FORWARD_PREFIX.length) };
  }
  return null;
}
