import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectBuild } from "../scripts/deploy.ts";
import { fixture } from "./fixture.ts";

const build = {
  name: fixture.ASSETS_WORKER_NAME,
  domains: [fixture.ASSETS_HOSTNAME],
  workersDev: false,
  previewUrls: false,
  observability: {
    enabled: false,
    logs: { enabled: false, invocationLogs: false },
    traces: { enabled: false },
  },
  logpush: false,
};

test("accepts the intended build", () => {
  assert.doesNotThrow(() => inspectBuild(build, fixture));
});

test("refuses a build with workers.dev or preview URLs enabled", () => {
  assert.throws(() => inspectBuild({ ...build, workersDev: true }, fixture), /workers\.dev/);
  assert.throws(() => inspectBuild({ ...build, previewUrls: true }, fixture), /preview URLs/);
});

test("refuses a build with an unexpected binding", () => {
  assert.throws(
    () => inspectBuild({ ...build, env: { EXTRA: { type: "text" } } }, fixture),
    /no bindings/,
  );
});
