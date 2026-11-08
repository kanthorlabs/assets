import { vi } from "vitest";
import type { AssetObject, ByteRange } from "../src/index.ts";

export type FakeObject = { data: string; etag: string };

function servedRange(range: ByteRange, size: number): ByteRange | undefined {
  if (range.offset < 0) {
    const offset = Math.max(0, size + range.offset);
    return { offset, length: size - offset };
  }
  if (range.offset >= size) return undefined;
  return { offset: range.offset, length: Math.min(range.length, size - range.offset) };
}

export function fakeAssets(objects: Record<string, FakeObject>) {
  const cancelled: string[] = [];
  const read = vi.fn(
    async (key: string, method: "GET" | "HEAD", range?: ByteRange): Promise<AssetObject | null> => {
      const object = objects[key];
      if (!object) return null;
      const bytes = new TextEncoder().encode(object.data);
      if (method === "HEAD") return { body: null, size: bytes.length, etag: object.etag };
      const served = range && servedRange(range, bytes.length);
      const chunk = served ? bytes.subarray(served.offset, served.offset + served.length) : bytes;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
        cancel() {
          cancelled.push(key);
        },
      });
      return { body, size: bytes.length, etag: object.etag, range: served };
    },
  );
  return { assets: { read }, read, cancelled };
}

export const noInfo = { home: "", clientIp: () => null };
