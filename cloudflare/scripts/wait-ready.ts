import { setTimeout } from "node:timers/promises";
import { baseUrl, send } from "./client.ts";

export const READINESS_PATH = "/f/not-a-uuid/ready.pdf";

export async function waitReady(base: string, attempts = 24, delayMs = 5000): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await send(base, READINESS_PATH);
      await response.body?.cancel();
      if (
        response.status === 400 &&
        response.headers.get("Cache-Control") === "no-store" &&
        response.headers.get("X-Content-Type-Options") === "nosniff"
      )
        return true;
    } catch {}
    if (attempt < attempts) await setTimeout(delayMs);
  }
  return false;
}

if (import.meta.main) {
  try {
    if (!(await waitReady(baseUrl(process.env.ASSETS_BASE_URL))))
      throw new Error("Readiness attempts exhausted");
    console.log("The Worker answers on the configured origin.");
  } catch {
    console.error("Readiness failed within the bounded retry window.");
    process.exitCode = 1;
  }
}
