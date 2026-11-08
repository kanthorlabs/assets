import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: { compatibilityDate: "2026-08-22" },
    }),
  ],
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
