export type ByteRange = { offset: number; length: number };

export interface AssetReader {
  read(key: string, method: "GET" | "HEAD", range?: ByteRange): Promise<AssetObject | null>;
}

export interface AssetObject {
  body: ReadableStream | null;
  size: number;
  etag: string;
  range?: ByteRange;
}

export class StorageUnavailable extends Error {}
