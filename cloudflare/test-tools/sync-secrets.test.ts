import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "./fixture.ts";

const script = new URL("../scripts/sync-secrets.ts", import.meta.url).pathname;
const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
printf '%s\\n' "$(cat)" >> "$GH_LOG"
`;

async function withFakeGh(
  values: Record<string, string>,
  run: (sync: (args: string[]) => void, log: () => Promise<string>) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "assets-sync-test-"));
  try {
    await writeFile(join(directory, "gh"), FAKE_GH, { mode: 0o700 });
    await writeFile(join(directory, ".env.production"), JSON.stringify(values), { mode: 0o600 });
    const logPath = join(directory, "gh.log");
    const sync = (args: string[]) =>
      execFileSync(process.execPath, [script, ...args], {
        cwd: directory,
        env: { PATH: `${directory}:${process.env.PATH}`, GH_LOG: logPath },
        timeout: 10_000,
        stdio: "pipe",
      });
    await run(sync, () => readFile(logPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("sets each deploy setting through stdin and never in arguments", async () => {
  const values = { CLOUDFLARE_API_TOKEN: "token-value", ...fixture };
  await withFakeGh(values, async (sync, log) => {
    sync(["--repo", "kanthorlabs/assets"]);
    const lines = (await log()).trimEnd().split("\n");
    const calls = Object.entries(values).flatMap(([name, value]) => [
      `secret set ${name} --repo kanthorlabs/assets`,
      value,
    ]);
    assert.deepEqual(lines, calls);
  });
});

test("skips an absent API token", async () => {
  await withFakeGh(fixture, async (sync, log) => {
    sync(["--repo", "kanthorlabs/assets"]);
    assert(!(await log()).includes("CLOUDFLARE_API_TOKEN"));
  });
});

test("refuses a missing repository or invalid settings without calling gh", async () => {
  await withFakeGh({ ...fixture, ASSETS_BASE_URL: "http://x" }, async (sync, log) => {
    assert.throws(() => sync([]), /explicit repository/);
    assert.throws(() => sync(["--repo", "kanthorlabs/assets"]), /explicit repository/);
    await assert.rejects(log(), { code: "ENOENT" });
  });
});
