import { createHandler } from "@kanthorlabs/assets-core";
import { r2Reader } from "./r2-reader.ts";

export default {
  fetch: (request, env) => createHandler({ assets: r2Reader(env.ASSETS_BUCKET) })(request),
} satisfies ExportedHandler<Env>;
