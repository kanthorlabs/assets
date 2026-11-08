import { env } from "cloudflare:workers";
import { StorageUnavailable } from "@kanthorlabs/assets-core";
import { beforeAll, describe, expect, it } from "vitest";
import { r2Reader } from "../src/r2-reader.ts";
import { countedBucket, failingBucket } from "./buckets.ts";

const KEY = "a/reader/digits.bin";
let httpEtag = "";

beforeAll(async () => {
  const object = await env.ASSETS_BUCKET.put(KEY, "0123456789");
  httpEtag = object?.httpEtag ?? "";
});

async function text(body: ReadableStream | null): Promise<string> {
  return new Response(body).text();
}

describe("r2Reader", () => {
  it("reads the whole object on GET with the R2 httpEtag", async () => {
    const object = await r2Reader(env.ASSETS_BUCKET).read(KEY, "GET");
    expect(object?.size).toBe(10);
    expect(object?.etag).toBe(httpEtag);
    expect(object?.range).toBeUndefined();
    expect(await text(object?.body ?? null)).toBe("0123456789");
  });

  it("reads metadata without a body on HEAD", async () => {
    const object = await r2Reader(env.ASSETS_BUCKET).read(KEY, "HEAD");
    expect(object).toEqual({ body: null, size: 10, etag: httpEtag });
  });

  it.each([
    ["a-b", { offset: 2, length: 3 }, { offset: 2, length: 3 }, "234"],
    [
      "a- open end",
      { offset: 2, length: Number.POSITIVE_INFINITY },
      { offset: 2, length: 8 },
      "23456789",
    ],
    ["-n suffix", { offset: -3, length: 3 }, { offset: 7, length: 3 }, "789"],
    ["suffix past the size", { offset: -30, length: 30 }, { offset: 0, length: 10 }, "0123456789"],
    ["end past the size", { offset: 8, length: 20 }, { offset: 8, length: 2 }, "89"],
  ])("serves the %s range as concrete numbers", async (_name, requested, served, bytes) => {
    const object = await r2Reader(env.ASSETS_BUCKET).read(KEY, "GET", requested);
    expect(object?.range).toEqual(served);
    expect(await text(object?.body ?? null)).toBe(bytes);
  });

  it.each([
    ["at", 10],
    ["past", 12],
  ])(
    "returns a cancellable object without a range for a start %s the size",
    async (_name, offset) => {
      const object = await r2Reader(env.ASSETS_BUCKET).read(KEY, "GET", { offset, length: 5 });
      expect(object?.size).toBe(10);
      expect(object?.range).toBeUndefined();
      await expect(object?.body?.cancel()).resolves.toBeUndefined();
    },
  );

  it("returns null for a missing object", async () => {
    const reader = r2Reader(env.ASSETS_BUCKET);
    expect(await reader.read("a/reader/missing.bin", "GET")).toBeNull();
    expect(await reader.read("a/reader/missing.bin", "HEAD")).toBeNull();
  });

  it("maps a storage failure to StorageUnavailable", async () => {
    const reader = r2Reader(failingBucket());
    await expect(reader.read(KEY, "GET")).rejects.toBeInstanceOf(StorageUnavailable);
    await expect(reader.read(KEY, "HEAD")).rejects.toBeInstanceOf(StorageUnavailable);
  });

  it.each([
    ["GET", undefined, ["get"]],
    ["GET", { offset: 2, length: 3 }, ["get"]],
    ["GET", { offset: 12, length: 5 }, ["get"]],
    ["HEAD", undefined, ["head"]],
  ] as const)("makes exactly one R2 call for %s with range %o", async (method, range, expected) => {
    const { bucket, calls } = countedBucket(env.ASSETS_BUCKET);
    const object = await r2Reader(bucket).read(KEY, method, range);
    await object?.body?.cancel();
    expect(calls).toEqual(expected);
  });
});
