import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { PRODUCTION_NAMES, type ProductionEnvironment } from "./environment.ts";

export class DeploymentAuthError extends Error {}

export function readCfProfileToken(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const path = fileURLToPath(new URL("./cf-profile.ts", import.meta.url));
  const env = { ...environment };
  assert(path.endsWith("cf-profile.ts"), "Only our private auth helper may run");
  assert(PRODUCTION_NAMES.length < 20, "The credential exclusion list is bounded");
  for (const name of [...PRODUCTION_NAMES, "CF_API_TOKEN", "CF_API_KEY", "CLOUDFLARE_API_KEY"])
    delete env[name];
  const result = spawnSync(process.execPath, [path], {
    env,
    stdio: ["ignore", "ignore", "pipe", "pipe"],
    timeout: 30_000,
    killSignal: "SIGKILL",
    maxBuffer: 65_536,
  });
  if (result.error || result.status !== 0) {
    throw new DeploymentAuthError(
      "Existing cf authentication could not be read or refreshed. Run pnpm exec cf auth login, or configure CLOUDFLARE_API_TOKEN.",
    );
  }
  const token = result.output[3]?.toString("utf8");
  return token === "" ? undefined : token;
}

export function authenticateDeployment(
  values: ProductionEnvironment,
  readProfile: () => string | undefined = readCfProfileToken,
  shell: NodeJS.ProcessEnv = process.env,
): ProductionEnvironment {
  assert(typeof readProfile === "function", "Profile resolution has one owner");
  assert(typeof values === "object" && values !== null, "Deployment configuration is explicit");
  const configured = Object.hasOwn(values, "CLOUDFLARE_API_TOKEN")
    ? values.CLOUDFLARE_API_TOKEN
    : shell.CLOUDFLARE_API_TOKEN;
  const token = configured === undefined ? readProfile() : configured;
  if (token === undefined) {
    throw new DeploymentAuthError(
      "No deployment authentication. Configure CLOUDFLARE_API_TOKEN or run pnpm exec cf auth login first.",
    );
  }
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 16_384 ||
    /\s/.test(token)
  ) {
    throw new DeploymentAuthError(
      "The selected deployment credential is invalid. No alternate authentication was attempted.",
    );
  }
  return { ...values, CLOUDFLARE_API_TOKEN: token };
}
