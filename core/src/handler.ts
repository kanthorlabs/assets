import { errorResponse } from "./errors.ts";
import type { AssetReader } from "./ports.ts";

export function createHandler(_deps: { assets: AssetReader }): (req: Request) => Promise<Response> {
  return async () => errorResponse(404);
}
