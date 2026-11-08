import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { parseEnv } from "node:util";

export type ProductionEnvironment = Record<string, string>;
export const CONFIG_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "ASSETS_WORKER_NAME",
  "ASSETS_HOSTNAME",
  "ASSETS_BASE_URL",
  "ASSETS_R2_BUCKET",
] as const;
export const PRODUCTION_NAMES = ["CLOUDFLARE_API_TOKEN", ...CONFIG_NAMES] as const;

export async function loadEnvironment(path: string): Promise<ProductionEnvironment> {
  assert(path.length > 0, "An explicit environment file is required");
  const info = await stat(path);
  assert(
    info.isFile() && info.size > 0 && info.size < 65_536,
    "Environment file must be a bounded nonempty regular file",
  );
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error("Environment file requires owner-only permissions (chmod 600)");
  const text = await readFile(path, "utf8");
  const decoded: unknown = text.trimStart().startsWith("{") ? JSON.parse(text) : parseEnv(text);
  assert(
    decoded !== null && typeof decoded === "object" && !Array.isArray(decoded),
    "Environment is a name/value object",
  );
  const values: ProductionEnvironment = Object.create(null);
  for (const [name, value] of Object.entries(decoded)) {
    if (!(PRODUCTION_NAMES as readonly string[]).includes(name))
      throw new Error(`Unknown environment setting: ${name}`);
    assert(typeof value === "string", "Environment values are text");
    values[name] = value;
  }
  return values;
}

export function deploymentSettings(values: ProductionEnvironment): void {
  for (const name of CONFIG_NAMES) {
    if (!values[name]?.trim()) throw new Error(`Missing production setting: ${name}`);
  }
  if (!/^[a-f0-9]{32}$/.test(values.CLOUDFLARE_ACCOUNT_ID))
    throw new Error("Invalid CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(values.ASSETS_WORKER_NAME))
    throw new Error("Invalid ASSETS_WORKER_NAME");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(values.ASSETS_HOSTNAME))
    throw new Error("Invalid ASSETS_HOSTNAME");
  if (values.ASSETS_BASE_URL !== `https://${values.ASSETS_HOSTNAME}`)
    throw new Error("ASSETS_BASE_URL must be the exact HTTPS Custom Domain origin");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(values.ASSETS_R2_BUCKET))
    throw new Error("Invalid ASSETS_R2_BUCKET");
}

export function cfEnvironment(values: ProductionEnvironment): NodeJS.ProcessEnv {
  const result = { ...process.env };
  for (const name of PRODUCTION_NAMES) delete result[name];
  for (const name of PRODUCTION_NAMES) {
    if (Object.hasOwn(values, name)) result[name] = values[name];
  }
  result.CF_SEND_METRICS = "false";
  result.WRANGLER_SEND_METRICS = "false";
  return result;
}
