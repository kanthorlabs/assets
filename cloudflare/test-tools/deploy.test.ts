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
  env: { ASSETS_BUCKET: { type: "r2", name: fixture.ASSETS_R2_BUCKET } },
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
    () => inspectBuild({ ...build, env: { ...build.env, EXTRA: { type: "text" } } }, fixture),
    /only the ASSETS_BUCKET R2 binding/,
  );
});

test("refuses a build without the R2 binding or with another bucket", () => {
  assert.throws(() => inspectBuild({ ...build, env: undefined }, fixture), /ASSETS_BUCKET/);
  assert.throws(
    () =>
      inspectBuild({ ...build, env: { ASSETS_BUCKET: { type: "r2", name: "other" } } }, fixture),
    /ASSETS_BUCKET/,
  );
  assert.throws(
    () =>
      inspectBuild(
        {
          ...build,
          env: {
            ASSETS_BUCKET: { type: "r2", name: fixture.ASSETS_R2_BUCKET, jurisdiction: "eu" },
          },
        },
        fixture,
      ),
    /ASSETS_BUCKET/,
  );
});
