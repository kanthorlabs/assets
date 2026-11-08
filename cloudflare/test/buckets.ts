export function countedBucket(bucket: R2Bucket): { bucket: R2Bucket; calls: string[] } {
  const calls: string[] = [];
  const counted = new Proxy(bucket, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return value.apply(target, args);
      };
    },
  });
  return { bucket: counted, calls };
}

export function failingBucket(): R2Bucket {
  const fail = () => Promise.reject(new Error("injected storage failure"));
  return { get: fail, head: fail } as unknown as R2Bucket;
}

export function unsatisfiableRangeBucket(bucket: R2Bucket): R2Bucket {
  const reject = () =>
    Promise.reject(new Error("get: The requested range is not satisfiable (10039)"));
  return new Proxy(bucket, {
    get(target, property) {
      if (property === "get") return reject;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
