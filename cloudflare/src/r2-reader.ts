import { type AssetReader, type ByteRange, StorageUnavailable } from "@kanthorlabs/assets-core";

export function r2Reader(bucket: R2Bucket): AssetReader {
  return {
    async read(key, method, range) {
      if (method === "HEAD") {
        const object = await call(() => bucket.head(key));
        return object && { body: null, size: object.size, etag: object.httpEtag };
      }
      const object = await call(() => bucket.get(key, rangeOption(range)));
      if (!object) return null;
      const result = { body: object.body, size: object.size, etag: object.httpEtag };
      const served = range && servedRange(range, object);
      return served ? { ...result, range: served } : result;
    },
  };
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new StorageUnavailable();
  }
}

function rangeOption(range: ByteRange | undefined): R2GetOptions {
  return range ? { range: new Headers({ Range: rangeHeader(range) }) } : {};
}

function rangeHeader(range: ByteRange): string {
  if (range.offset < 0) return `bytes=-${range.length}`;
  if (range.length === Number.POSITIVE_INFINITY) return `bytes=${range.offset}-`;
  return `bytes=${range.offset}-${range.offset + range.length - 1}`;
}

type R2RangeFields = { offset?: number; length?: number; suffix?: number };

function servedRange(requested: ByteRange, object: R2Object): ByteRange | undefined {
  const size = object.size;
  const range: R2RangeFields | undefined = object.range;
  if (requested.offset >= size || !range) return undefined;
  const offset =
    range.suffix !== undefined ? Math.max(0, size - range.suffix) : (range.offset ?? 0);
  const end =
    range.suffix !== undefined || range.length === undefined
      ? size
      : Math.min(size, offset + range.length);
  return end > offset ? { offset, length: end - offset } : undefined;
}
