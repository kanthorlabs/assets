import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/index.ts";

describe("skeleton handler", () => {
  const read = vi.fn(async () => null);
  const handle = createHandler({ assets: { read } });

  it.each([
    ["GET", "https://assets.test/"],
    ["GET", "https://assets.test/a/x.html"],
    ["HEAD", "https://assets.test/f/x/y.pdf"],
    ["POST", "https://assets.test/x?q=1"],
  ])("returns the plain-text 404 for %s %s", async (method, url) => {
    const response = await handle(new Request(url, { method }));
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("Not Found");
    expect(read).not.toHaveBeenCalled();
  });
});
