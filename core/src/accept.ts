const JSON_TYPE = "application/json";

export function acceptsJson(accept: string | null): boolean {
  if (accept === null) return false;
  return accept.split(",").some((range) => range.split(";")[0].trim().toLowerCase() === JSON_TYPE);
}
