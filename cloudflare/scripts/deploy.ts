import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DeploymentAuthError } from "./deployment-auth.ts";
import { cfEnvironment, loadEnvironment, type ProductionEnvironment } from "./environment.ts";
import { preflight } from "./preflight.ts";

export const BUILD_CONFIG = ".cloudflare/output/v0/workers/default/worker.config.json";

export function inspectBuild(config: Record<string, unknown>, values: ProductionEnvironment): void {
  assert.equal(config.name, values.ASSETS_WORKER_NAME, "Build uses intended Worker identity");
  assert.deepEqual(
    config.domains,
    [values.ASSETS_HOSTNAME],
    "Build uses only the intended Custom Domain",
  );
  assert.equal(config.workersDev, false, "Build disables workers.dev");
  assert.equal(config.previewUrls, false, "Build disables preview URLs");
  assert.deepEqual(
    config.observability,
    { enabled: false, logs: { enabled: false, invocationLogs: false }, traces: { enabled: false } },
    "Build disables observability",
  );
  assert.equal(config.logpush, false, "Build disables Logpush");
  assert.deepEqual(Object.keys(config.env ?? {}), [], "Build has no bindings");
}

async function deploy(path: string, dryRun: boolean): Promise<void> {
  const values = await preflight(await loadEnvironment(path), !dryRun);
  const environment = cfEnvironment(values);
  execFileSync("pnpm", ["exec", "cf", "build"], {
    env: environment,
    stdio: "pipe",
    timeout: 180_000,
  });
  inspectBuild(JSON.parse(await readFile(BUILD_CONFIG, "utf8")), values);
  const args = ["exec", "cf", "deploy", "--prebuilt"];
  if (dryRun) args.push("--dry-run");
  execFileSync("pnpm", args, { env: environment, stdio: "pipe", timeout: 180_000 });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "env-file": { type: "string", default: ".env.production" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  try {
    await deploy(values["env-file"], values["dry-run"]);
    console.log(
      values["dry-run"]
        ? "Build/configuration checks passed. Nothing uploaded."
        : "Worker and Custom Domain deployed.",
    );
  } catch (error) {
    console.error(
      error instanceof DeploymentAuthError
        ? error.message
        : "Deployment failed; no success is claimed. Check preflight and Cloudflare deployment status. CLI diagnostics were not printed.",
    );
    process.exitCode = 1;
  }
}
