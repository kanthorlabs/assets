import assert from "node:assert/strict";
import type { ProductionEnvironment } from "./environment.ts";

interface ApiEnvelope<T> {
  success: boolean;
  result: T;
  result_info?: { total_pages?: number };
}

export async function cloudflareApi<T>(values: ProductionEnvironment, path: string): Promise<T> {
  assert(path.startsWith("/") && !path.startsWith("//"), "Cloudflare API path is relative");
  assert(!path.includes("://"), "Cloudflare host cannot be overridden");
  if (!values.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error("Resolve deployment authentication before accessing the Cloudflare API");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${values.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Cloudflare preflight refused with HTTP ${response.status}`);
  }
  const body = (await response.json()) as ApiEnvelope<T>;
  if (body.success !== true) throw new Error("Cloudflare API operation failed");
  if ((body.result_info?.total_pages ?? 1) > 1)
    throw new Error("Preflight result exceeds one page; narrow the deployment scope");
  return body.result;
}

interface Zone {
  id: string;
  name: string;
  status: string;
  account: { id: string };
}
interface Domain {
  hostname: string;
  service: string;
  environment: string;
  zone_id: string;
}
interface DnsRecord {
  name: string;
  type: string;
}

export async function findZone(values: ProductionEnvironment): Promise<Zone> {
  const hostname = values.ASSETS_HOSTNAME;
  const labels = hostname.split(".");
  assert(
    labels.length >= 3 && labels.length <= 127,
    "Deployment must use a subdomain, not an apex",
  );
  const zones = await cloudflareApi<Zone[]>(
    values,
    `/zones?account.id=${values.CLOUDFLARE_ACCOUNT_ID}&status=active&per_page=50`,
  );
  const zone = zones
    .filter((item) => hostname.endsWith(`.${item.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone || zone.account.id !== values.CLOUDFLARE_ACCOUNT_ID)
    throw new Error("Custom Domain must belong to an active zone in the selected account");
  return zone;
}

async function workerDomains(values: ProductionEnvironment): Promise<Domain[]> {
  return cloudflareApi<Domain[]>(
    values,
    `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}/workers/domains`,
  );
}

export async function checkDomain(values: ProductionEnvironment): Promise<void> {
  const hostname = values.ASSETS_HOSTNAME;
  const zone = await findZone(values);
  const existing = (await workerDomains(values)).find((domain) => domain.hostname === hostname);
  if (
    existing &&
    (existing.service !== values.ASSETS_WORKER_NAME ||
      existing.environment !== "production" ||
      existing.zone_id !== zone.id)
  )
    throw new Error("Custom Domain belongs to another deployment; refusing takeover");
  const records = await cloudflareApi<DnsRecord[]>(
    values,
    `/zones/${zone.id}/dns_records?name=${hostname}&per_page=100`,
  );
  if (!existing && records.length > 0)
    throw new Error("Custom Domain already has DNS records; refusing overwrite");
}

export async function checkWorker(values: ProductionEnvironment): Promise<void> {
  const scripts = await cloudflareApi<{ id: string }[]>(
    values,
    `/accounts/${values.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`,
  );
  if (!scripts.some((script) => script.id === values.ASSETS_WORKER_NAME)) return;
  const owned = (await workerDomains(values)).some(
    (domain) =>
      domain.hostname === values.ASSETS_HOSTNAME && domain.service === values.ASSETS_WORKER_NAME,
  );
  if (!owned)
    throw new Error(
      "Existing Worker does not serve the assets Custom Domain; refusing replacement",
    );
}
