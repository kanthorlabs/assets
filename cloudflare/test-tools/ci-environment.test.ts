import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadEnvironment } from "../scripts/environment.ts";
import { fixture } from "./fixture.ts";

const script = new URL("../scripts/ci-environment.ts", import.meta.url).pathname;

async function inDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "assets-ci-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function materialize(directory: string, env: Record<string, string | undefined>): void {
  execFileSync(process.execPath, [script], {
    cwd: directory,
    env: { PATH: process.env.PATH, ...env },
    timeout: 10_000,
    stdio: "pipe",
  });
}

test("writes an owner-only JSON environment with exact secret values", async () => {
  await inDirectory(async (directory) => {
    materialize(directory, { ...fixture, CLOUDFLARE_API_TOKEN: "exact\n\"'\\token" });
    const path = join(directory, ".env.production");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const values = await loadEnvironment(path);
    assert.deepEqual({ ...values }, { CLOUDFLARE_API_TOKEN: "exact\n\"'\\token", ...fixture });
  });
});

test("omits an absent or empty API token", async () => {
  await inDirectory(async (directory) => {
    for (const token of [undefined, ""]) {
      materialize(directory, { ...fixture, CLOUDFLARE_API_TOKEN: token });
      const path = join(directory, ".env.production");
      assert(!Object.hasOwn(JSON.parse(await readFile(path, "utf8")), "CLOUDFLARE_API_TOKEN"));
      await rm(path);
    }
  });
});

test("fails on a missing deploy setting and writes no file", async () => {
  await inDirectory(async (directory) => {
    assert.throws(
      () => materialize(directory, { ...fixture, ASSETS_R2_BUCKET: undefined }),
      /Missing GitHub Actions secret: ASSETS_R2_BUCKET/,
    );
    await assert.rejects(stat(join(directory, ".env.production")), { code: "ENOENT" });
  });
});

test("refuses to overwrite an existing environment file", async () => {
  await inDirectory(async (directory) => {
    const path = join(directory, ".env.production");
    await writeFile(path, "existing", { mode: 0o600 });
    assert.throws(() => materialize(directory, fixture), /EEXIST/);
    assert.equal(await readFile(path, "utf8"), "existing");
  });
});
