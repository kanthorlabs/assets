import type { ByteRange } from "./ports.ts";

const RANGE = /^bytes=(\d*)-(\d*)$/i;

export function parseRange(header: string | null): ByteRange | undefined {
  const match = header === null ? null : RANGE.exec(header.trim());
  if (!match) return undefined;
  const [, first, last] = match;
  if (first === "") {
    const suffix = Number(last);
    return last !== "" && Number.isSafeInteger(suffix) && suffix > 0
      ? { offset: -suffix, length: suffix }
      : undefined;
  }
  const offset = Number(first);
  if (!Number.isSafeInteger(offset)) return undefined;
  if (last === "") return { offset, length: Number.POSITIVE_INFINITY };
  const end = Number(last);
  return Number.isSafeInteger(end) && end >= offset
    ? { offset, length: end - offset + 1 }
    : undefined;
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
}
