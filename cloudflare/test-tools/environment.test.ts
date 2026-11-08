import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deploymentSettings, loadEnvironment } from "../scripts/environment.ts";
import { fixture } from "./fixture.ts";

async function withFile(content: string, mode: number, run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "assets-env-test-"));
  try {
    const path = join(directory, ".env.production");
    await writeFile(path, content, { mode });
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const dotenv = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([name, value]) => `${name}="${value}"`)
    .join("\n");

test("reads an owner-only dotenv file with valid settings", async () => {
  await withFile(dotenv(fixture), 0o600, async (path) => {
    const values = await loadEnvironment(path);
    assert.deepEqual({ ...values }, fixture);
    assert.doesNotThrow(() => deploymentSettings(values));
  });
});

test("refuses a group- or world-readable file", async () => {
  await withFile(dotenv(fixture), 0o644, async (path) => {
    await assert.rejects(loadEnvironment(path), /chmod 600/);
  });
});

test("refuses an unknown setting name", async () => {
  await withFile(dotenv({ ...fixture, MASTER_KEY: "x" }), 0o600, async (path) => {
    await assert.rejects(loadEnvironment(path), /Unknown environment setting: MASTER_KEY/);
  });
});

test("refuses an invalid hostname, base URL or bucket", () => {
  assert.throws(
    () => deploymentSettings({ ...fixture, ASSETS_HOSTNAME: "Assets_Example" }),
    /Invalid ASSETS_HOSTNAME/,
  );
  assert.throws(
    () => deploymentSettings({ ...fixture, ASSETS_BASE_URL: "http://assets.example.com" }),
    /ASSETS_BASE_URL/,
  );
  assert.throws(
    () => deploymentSettings({ ...fixture, ASSETS_R2_BUCKET: "Bad_Bucket" }),
    /Invalid ASSETS_R2_BUCKET/,
  );
});
