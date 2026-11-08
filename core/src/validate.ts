const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SEGMENTS = 8;
const MAX_BYTES = 1000;

export function isValidAssetPath(path: string): boolean {
  if (path.length === 0 || new TextEncoder().encode(path).length > MAX_BYTES) return false;
  const segments = path.split("/");
  return segments.length <= MAX_SEGMENTS && segments.every((segment) => SEGMENT.test(segment));
}
