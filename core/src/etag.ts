function opaqueTag(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

export function weakMatch(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const target = opaqueTag(etag);
  return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaqueTag(tag) === target);
}
