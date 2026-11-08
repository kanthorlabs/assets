import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PRODUCTION_NAMES } from "./environment.ts";

const environment: Record<string, string> = Object.create(null);
assert(PRODUCTION_NAMES.length < 20, "CI environment creation is allowlisted");
for (const name of PRODUCTION_NAMES) {
  const value = process.env[name];
  if (name === "CLOUDFLARE_API_TOKEN" && (value === undefined || value === "")) continue;
  if (!value) throw new Error(`Missing GitHub Actions secret: ${name}`);
  environment[name] = value;
}
await writeFile(".env.production", JSON.stringify(environment), { mode: 0o600, flag: "wx" });
console.log("Created owner-only deployment environment from GitHub Actions secrets.");
