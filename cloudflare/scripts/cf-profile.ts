import assert from "node:assert/strict";
import { fstatSync, writeFileSync } from "node:fs";
import { type AuthContext, createCfAuth, createCfProfileStore } from "@cloudflare/workers-auth/cf";

function refusedDiagnostic(): never {
  throw new Error(
    "cf authentication reported a warning or error; reauthenticate with cf auth login.",
  );
}

const logger: AuthContext["logger"] = {
  debug: () => undefined,
  info: () => undefined,
  log: () => undefined,
  warn: refusedDiagnostic,
  error: refusedDiagnostic,
};

async function profileToken(): Promise<string | undefined> {
  const channel = fstatSync(3);
  assert(channel.isSocket() || channel.isFIFO(), "A private parent/child pipe is required");
  assert(!process.stdout.isTTY, "The auth helper must not run interactively");
  const auth = createCfAuth({
    logger,
    userAgent: "assets-deployment",
    prompt: async () => {
      throw new Error("Interactive login is not allowed during deployment");
    },
    select: async () => {
      throw new Error("Interactive account selection is not allowed during deployment");
    },
    isNoDefaultValueProvidedError: () => false,
  });
  const profile = createCfProfileStore({ logger }).resolve({ cwd: process.cwd() });
  auth.setProfile(profile);
  return auth.getOAuthTokenFromLocalState();
}

if (import.meta.main) {
  try {
    const token = await profileToken();
    if (token !== undefined) writeFileSync(3, token);
  } catch {
    process.exitCode = 1;
  }
}
