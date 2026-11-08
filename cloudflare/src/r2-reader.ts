import {
  type AssetObject,
  type AssetReader,
  type ByteRange,
  StorageUnavailable,
} from "@kanthorlabs/assets-core";

export function r2Reader(bucket: R2Bucket): AssetReader {
  return {
    async read(key, method, range) {
      if (method === "HEAD") return metadata(await call(() => bucket.head(key)));
      let object: R2ObjectBody | null;
      try {
        object = await bucket.get(key, rangeOption(range));
      } catch (error) {
        if (range && isRangeNotSatisfiable(error)) return unsatisfiable(bucket, key, range);
        throw new StorageUnavailable();
      }
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

function metadata(object: R2Object | null): AssetObject | null {
  return object && { body: null, size: object.size, etag: object.httpEtag };
}

function isRangeNotSatisfiable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("10039");
}

async function unsatisfiable(
  bucket: R2Bucket,
  key: string,
  range: ByteRange,
): Promise<AssetObject | null> {
  const object = await call(() => bucket.head(key));
  if (object && range.offset < object.size) throw new StorageUnavailable();
  return metadata(object);
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
