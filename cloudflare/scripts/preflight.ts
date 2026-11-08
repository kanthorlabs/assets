import { parseArgs } from "node:util";
import { checkDomain, checkWorker, cloudflareApi, findZone } from "./cloudflare-api.ts";
import { authenticateDeployment, DeploymentAuthError } from "./deployment-auth.ts";
import { deploymentSettings, loadEnvironment, type ProductionEnvironment } from "./environment.ts";

export async function preflight(
  values: ProductionEnvironment,
  remote: boolean,
): Promise<ProductionEnvironment> {
  deploymentSettings(values);
  if (!remote) return values;
  const authenticated = authenticateDeployment(values);
  await checkDomain(authenticated);
  await checkWorker(authenticated);
  return authenticated;
}

interface Subscription {
  rate_plan?: { id?: string; public_name?: string };
}
interface LogpushJob {
  destination_conf: string;
}

export async function workersPlan(values: ProductionEnvironment): Promise<"free" | "paid"> {
  const subscriptions = await cloudflareApi<Subscription[]>(
    values,
    `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}/subscriptions`,
  );
  const paid = subscriptions.some((subscription) =>
    /worker/i.test(`${subscription.rate_plan?.id} ${subscription.rate_plan?.public_name}`),
  );
  return paid ? "paid" : "free";
}

export async function checkCostCap(values: ProductionEnvironment): Promise<void> {
  const account = `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}`;
  const bucket = `${account}/r2/buckets/${values.ASSETS_R2_BUCKET}`;
  const { buckets } = await cloudflareApi<{ buckets: { name: string }[] }>(
    values,
    `${account}/r2/buckets`,
  );
  if (buckets.length !== 1 || buckets[0]?.name !== values.ASSETS_R2_BUCKET)
    throw new Error("The account has R2 buckets other than ASSETS_R2_BUCKET");
  const details = await cloudflareApi<{ storage_class?: string }>(values, bucket);
  if (details.storage_class !== "Standard")
    throw new Error("The bucket default storage class is not Standard");
  const managed = await cloudflareApi<{ enabled: boolean }>(values, `${bucket}/domains/managed`);
  if (managed.enabled) throw new Error("The bucket has r2.dev access enabled");
  const custom = await cloudflareApi<{ domains: unknown[] }>(values, `${bucket}/domains/custom`);
  if (custom.domains.length > 0) throw new Error("The bucket has a custom domain");
  const sippy = await cloudflareApi<{ enabled: boolean }>(values, `${bucket}/sippy`);
  if (sippy.enabled) throw new Error("The bucket has Sippy enabled");
  const zone = await findZone(values);
  const cacheReserve = await cloudflareApi<{ value: string }>(
    values,
    `/zones/${zone.id}/cache/cache_reserve`,
  );
  if (cacheReserve.value !== "off") throw new Error("The zone has Cache Reserve enabled");
  const jobs = [
    ...(await cloudflareApi<LogpushJob[]>(values, `${account}/logpush/jobs`)),
    ...(await cloudflareApi<LogpushJob[]>(values, `/zones/${zone.id}/logpush/jobs`)),
  ];
  if (jobs.some((job) => job.destination_conf.startsWith("r2://")))
    throw new Error("A Logpush job writes to R2");
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "env-file": { type: "string", default: ".env.production" },
      remote: { type: "boolean", default: false },
      account: { type: "boolean", default: false },
    },
  });
  try {
    const environment = await preflight(await loadEnvironment(values["env-file"]), values.remote);
    if (values.account) {
      const authenticated = authenticateDeployment(environment);
      const plan = await workersPlan(authenticated);
      console.log(
        plan === "free"
          ? "Workers Free: no Workers Paid subscription found."
          : "WARNING: Workers Paid subscription found. The hard cost cap does not apply.",
      );
      await checkCostCap(authenticated);
      console.log("Cost cap checks passed.");
    }
    console.log(
      `Production preflight passed (${values.remote ? "configuration and Cloudflare ownership" : "configuration only"}).`,
    );
  } catch (error) {
    console.error(
      error instanceof DeploymentAuthError
        ? error.message
        : `Production preflight failed: ${error instanceof Error && error.constructor === Error ? error.message : "check configuration and credentials"}. No deployment was performed.`,
    );
    process.exitCode = 1;
  }
}
