import { bindings, defineConfig, defineWorker } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: defineWorker({
    name: process.env.ASSETS_WORKER_NAME ?? "assets-local",
    entrypoint,
    compatibilityDate: "2026-08-22",
    workersDev: false,
    previewUrls: false,
    domains: process.env.ASSETS_HOSTNAME ? [process.env.ASSETS_HOSTNAME] : [],
    observability: {
      enabled: false,
      logs: { enabled: false, invocationLogs: false },
      traces: { enabled: false },
    },
    logpush: false,
    env: {
      ASSETS_BUCKET: bindings.r2({ name: process.env.ASSETS_R2_BUCKET ?? "assets-local" }),
    },
  }),
});
