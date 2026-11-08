import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { deploymentSettings, loadEnvironment, PRODUCTION_NAMES } from "./environment.ts";

const { values } = parseArgs({
  options: { "env-file": { type: "string", default: ".env.production" }, repo: { type: "string" } },
});
try {
  if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
    throw new Error("An explicit GitHub owner/repository is required");
  const environment = await loadEnvironment(values["env-file"]);
  deploymentSettings(environment);
  assert(PRODUCTION_NAMES.length < 20, "Secret synchronization is allowlisted and bounded");
  for (const name of PRODUCTION_NAMES) {
    const value = environment[name];
    if (value === undefined) continue;
    execFileSync("gh", ["secret", "set", name, "--repo", values.repo], {
      input: value,
      stdio: "pipe",
      timeout: 30_000,
    });
  }
  console.log("Synchronized deploy settings to GitHub secrets. No secret values were printed.");
} catch {
  console.error(
    "GitHub secret synchronization failed. Check the environment file, explicit repository, and GitHub access.",
  );
  process.exitCode = 1;
}
