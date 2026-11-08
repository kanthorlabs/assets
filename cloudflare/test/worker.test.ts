import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

describe("worker entry", () => {
  it("returns the core 404 with the error headers", async () => {
    const response = await worker.fetch(new Request("https://assets.test/a/x.html"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("Not Found");
  });
});
