import { parseArgs } from "node:util";
import {
  CloudflareApiError,
  checkDomain,
  checkWorker,
  cloudflareApi,
  findZone,
} from "./cloudflare-api.ts";
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

function refused(error: unknown, code: number): boolean {
  return error instanceof CloudflareApiError && error.status === 403 && error.codes.includes(code);
}

async function unlessRefused<T>(request: Promise<T>, code: number): Promise<T | undefined> {
  try {
    return await request;
  } catch (error) {
    if (refused(error, code)) return undefined;
    throw error;
  }
}

async function bucketExposure(
  values: ProductionEnvironment,
  bucket: string,
): Promise<string | undefined> {
  const managed = await cloudflareApi<{ enabled: boolean }>(values, `${bucket}/domains/managed`);
  if (managed.enabled) return "r2.dev access enabled";
  const custom = await cloudflareApi<{ domains: unknown[] }>(values, `${bucket}/domains/custom`);
  if (custom.domains.length > 0) return "a custom domain";
  return undefined;
}

export async function checkCostCap(values: ProductionEnvironment): Promise<string[]> {
  const notes: string[] = [];
  const account = `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}`;
  const bucket = `${account}/r2/buckets/${values.ASSETS_R2_BUCKET}`;
  const { buckets } = await cloudflareApi<{ buckets: { name: string }[] }>(
    values,
    `${account}/r2/buckets`,
  );
  const details = await cloudflareApi<{ storage_class?: string }>(values, bucket);
  if (details.storage_class !== "Standard")
    throw new Error("The bucket default storage class is not Standard");
  const exposure = await bucketExposure(values, bucket);
  if (exposure) throw new Error(`The bucket has ${exposure}`);
  const sippy = await cloudflareApi<{ enabled: boolean }>(values, `${bucket}/sippy`);
  if (sippy.enabled) throw new Error("The bucket has Sippy enabled");
  const others = buckets
    .map((item) => item.name)
    .filter((name) => name !== values.ASSETS_R2_BUCKET);
  for (const name of others) {
    const otherExposure = await bucketExposure(values, `${account}/r2/buckets/${name}`);
    if (otherExposure) throw new Error(`The bucket ${name} has ${otherExposure}`);
  }
  if (others.length > 0) notes.push(`Other private R2 buckets: ${others.join(", ")}.`);
  const zone = await findZone(values);
  const cacheReserve = await unlessRefused(
    cloudflareApi<{ value: string }>(values, `/zones/${zone.id}/cache/cache_reserve`),
    1135,
  );
  if (cacheReserve && cacheReserve.value !== "off")
    throw new Error("The zone has Cache Reserve enabled");
  const accountJobs = await unlessRefused(
    cloudflareApi<LogpushJob[]>(values, `${account}/logpush/jobs`),
    10000,
  );
  const zoneJobs = await unlessRefused(
    cloudflareApi<LogpushJob[]>(values, `/zones/${zone.id}/logpush/jobs`),
    10000,
  );
  if (!accountJobs || !zoneJobs) notes.push("Logpush not available on this plan.");
  const jobs = [...(accountJobs ?? []), ...(zoneJobs ?? [])];
  if (jobs.some((job) => job.destination_conf.startsWith("r2://")))
    throw new Error("A Logpush job writes to R2");
  return notes;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: ".env.production" },
      remote: { type: "boolean", default: false },
      account: { type: "boolean", default: false },
    },
  });
  try {
    const environment = await preflight(await loadEnvironment(values.config), values.remote);
    if (values.account) {
      const authenticated = authenticateDeployment(environment);
      const plan = await workersPlan(authenticated);
      console.log(
        plan === "free"
          ? "Workers Free: no Workers Paid subscription found."
          : "WARNING: Workers Paid subscription found. The hard cost cap does not apply.",
      );
      for (const note of await checkCostCap(authenticated)) console.log(note);
      console.log("Cost cap checks passed.");
    }
    console.log(
      `Production preflight passed (${values.remote ? "configuration and Cloudflare ownership" : "configuration only"}).`,
    );
  } catch (error) {
    console.error(
      error instanceof DeploymentAuthError
        ? error.message
        : `Production preflight failed: ${error instanceof Error && (error.constructor === Error || error instanceof CloudflareApiError) ? error.message : "check configuration and credentials"}. No deployment was performed.`,
    );
    process.exitCode = 1;
  }
}
