import { type AssetReader, createHandler } from "@kanthorlabs/assets-core";

const noAssets: AssetReader = { read: async () => null };

export default {
  fetch: createHandler({ assets: noAssets }),
} satisfies ExportedHandler;
