import { createHandler } from "@kanthorlabs/assets-core";
import home from "../../README.md?raw";
import { r2Reader } from "./r2-reader.ts";

export default {
  fetch: (request, env) =>
    createHandler({
      assets: r2Reader(env.ASSETS_BUCKET),
      home,
      clientIp: (req) => req.headers.get("CF-Connecting-IP"),
    })(request),
} satisfies ExportedHandler<Env>;
