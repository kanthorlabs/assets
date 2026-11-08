const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SEGMENTS = 8;
const MAX_BYTES = 1000;

export function isValidAssetPath(path: string): boolean {
  if (path.length === 0 || new TextEncoder().encode(path).length > MAX_BYTES) return false;
  const segments = path.split("/");
  return segments.length <= MAX_SEGMENTS && segments.every((segment) => SEGMENT.test(segment));
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidForwardPath(path: string): boolean {
  const segments = path.split("/");
  return segments.length === 2 && UUID_V4.test(segments[0]) && SEGMENT.test(segments[1]);
}
