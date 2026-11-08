import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURE_FILES, writeFixtures } from "../scripts/fixtures.ts";

const README = new URL("../../README.md", import.meta.url).pathname;
const FIXTURES = new URL("../e2e-fixtures/", import.meta.url).pathname;

test("committed E2E fixtures match the generator output for README.md", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "assets-fixtures-"));
  try {
    await writeFixtures(README, outDir);
    for (const file of FIXTURE_FILES) {
      const generated = await readFile(join(outDir, file));
      const committed = await readFile(join(FIXTURES, file));
      assert(generated.equals(committed), `${file} is stale: run pnpm run fixtures`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
