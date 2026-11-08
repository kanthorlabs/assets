# Cloudflare configuration

The deployer owns the configuration. No account id, Worker name, hostname or bucket name is in the code. Follow [Deploy to Cloudflare](../how-to/deploy.md) for the procedure.

## Environment file

| File | Purpose |
| --- | --- |
| `cloudflare/.env.example` | Template with placeholder values. It is in git. |
| `cloudflare/.env.production` | Private operator configuration. It is the default path of every operator command. Git ignores it. CI writes a temporary copy and removes it at the end of the job. |

Select another file with `--config PATH`. The file must exist.

The file must obey these rules:

- It is a nonempty regular file smaller than 65,536 bytes.
- It has owner-only permissions (`chmod 600`) on systems other than Windows.
- It is dotenv text, or a JSON object of string values.
- It contains only the names in [Settings](#settings). An unknown name stops the command.

## Settings

| Name | Required | Rule |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | 32 lowercase hexadecimal characters. |
| `CLOUDFLARE_API_TOKEN` | For token authentication | The deploy token. See [Authentication](#authentication). It never becomes a Worker binding. |
| `ASSETS_WORKER_NAME` | Yes | 1 to 63 characters: lowercase letters, digits and `-`. A letter or digit at each end. |
| `ASSETS_HOSTNAME` | Yes | Lowercase subdomain in an active zone of the account. An apex domain is refused. |
| `ASSETS_BASE_URL` | Yes | Exactly `https://` plus `ASSETS_HOSTNAME`, with no path and no `/` at the end. |
| `ASSETS_R2_BUCKET` | Yes | Name of the private R2 bucket. 3 to 63 characters: lowercase letters, digits and `-`. It must exist before the deploy. |

The commands `scripts/wait-ready.ts` and `pnpm run test:e2e` do not read the environment file. They read `ASSETS_BASE_URL` from the process environment. There, the value must be an origin with no path: HTTPS, or HTTP on `localhost` or `127.0.0.1`.

## Authentication

The deploy and `preflight --remote` commands select one credential in this order:

1. `CLOUDFLARE_API_TOKEN` in the environment file.
2. `CLOUDFLARE_API_TOKEN` in the shell, if the file does not contain it.
3. The current `cf` OAuth profile. Run `pnpm exec cf auth login` to create it.

If no credential exists, the command stops before a remote call. A token that is empty, contains white space, or is longer than 16,384 characters stops the command. A refused token never falls back to OAuth. The OAuth profile is for local use only. Do not use a broad OAuth profile for production deploys.

`preflight --account` uses the same order. Its read-only token comes from the shell, so the selected file must not contain `CLOUDFLARE_API_TOKEN`. See [Credentials](../how-to/credentials.md) for the token permissions.

## Worker settings

`cloudflare/cloudflare.config.ts` declares the Worker:

| Setting | Value |
| --- | --- |
| `name` | `ASSETS_WORKER_NAME`. Local fallback: `assets-local`. |
| `entrypoint` | `./src/index.ts` |
| `compatibilityDate` | `2026-08-22`. The test pool uses the same date. No `nodejs_compat` flag. |
| `workersDev` | `false` |
| `previewUrls` | `false` |
| `domains` | `[ASSETS_HOSTNAME]`. Local fallback: no domain. |
| `observability` | Disabled, with logs, invocation logs and traces disabled. |
| `logpush` | `false` |
| `env.ASSETS_BUCKET` | `bindings.r2({ name: ASSETS_R2_BUCKET })`. Local fallback bucket: `assets-local`. |

`pnpm run deploy` builds the Worker and reads `.cloudflare/output/v0/workers/default/worker.config.json`. It stops the deploy unless each of these is true:

- `name` is `ASSETS_WORKER_NAME`.
- `domains` is exactly `[ASSETS_HOSTNAME]`.
- `workersDev`, `previewUrls` and `logpush` are `false`.
- Observability, logs, invocation logs and traces are disabled.
- `env` is exactly `{ ASSETS_BUCKET: { type: "r2", name: ASSETS_R2_BUCKET } }`.

## Ownership checks

Before an upload, `pnpm run deploy` runs the remote preflight. It stops the deploy in these cases:

- `ASSETS_HOSTNAME` is not a subdomain of an active zone in the account.
- A Custom Domain for `ASSETS_HOSTNAME` belongs to another Worker or environment.
- `ASSETS_HOSTNAME` has no Custom Domain, but has DNS records.
- A Worker named `ASSETS_WORKER_NAME` exists, but `ASSETS_HOSTNAME` does not point to it.

`pnpm run deploy --dry-run` runs the configuration checks and the build inspection only. It needs no credential and uploads nothing.

## Cost cap checks

`pnpm run preflight --account` checks the account against the [cost cap](../explanation/architecture.md#cost-cap):

| Check | API call | Failure |
| --- | --- | --- |
| Workers plan | `GET /accounts/{id}/subscriptions` | A plan with `worker` in its id or name prints a warning: the hard cost cap does not apply. |
| One bucket | `GET /accounts/{id}/r2/buckets` | The account has a bucket other than `ASSETS_R2_BUCKET`. |
| Storage class | `GET /accounts/{id}/r2/buckets/{bucket}` | The default storage class is not `Standard`. |
| No `r2.dev` | `GET .../domains/managed` | `r2.dev` access is enabled. |
| No custom domain | `GET .../domains/custom` | The bucket has a custom domain. |
| No Sippy | `GET .../sippy` | Sippy is enabled. |
| No Cache Reserve | `GET /zones/{zone}/cache/cache_reserve` | Cache Reserve is not `off`. |
| No Logpush to R2 | `GET /accounts/{id}/logpush/jobs` and `GET /zones/{zone}/logpush/jobs` | A job has an `r2://` destination. |

## Zone rules

The zone rules are in `cloudflare/zone-rules/`, in the Rulesets API format. Apply them with [Deploy to Cloudflare](../how-to/deploy.md#7-protect-the-hostname).

| File | Phase | Rule | Expression | Action |
| --- | --- | --- | --- | --- |
| `http_request_firewall_custom.json` | `http_request_firewall_custom` | `assets: allow only GET and HEAD on /a/ and /f/` | `http.host eq "assets.kanthorlabs.com" and (not http.request.method in {"GET" "HEAD"} or not (starts_with(http.request.uri.path, "/a/") or starts_with(http.request.uri.path, "/f/")))` | Block, enabled |
| `http_request_firewall_custom.json` | `http_request_firewall_custom` | `assets: kill switch` | `http.host eq "assets.kanthorlabs.com"` | Block, disabled |
| `http_ratelimit.json` | `http_ratelimit` | `assets: 50 requests per 10 s per IP on /a/ and /f/` | `starts_with(http.request.uri.path, "/a/") or starts_with(http.request.uri.path, "/f/")` | Block, enabled |

Constraints:

- The custom rules contain the hostname `assets.kanthorlabs.com`. For another `ASSETS_HOSTNAME`, change `http.host` in the file before you apply it.
- The rate limit counts per `cf.colo.id` and `ip.src`: 50 requests in a 10-second period, then a 10-second block.
- The rate limit has no host filter, because the Free plan allows only path fields. It applies to `/a/` and `/f/` on every hostname of the zone.
- The Free plan allows one rate limit rule per zone. Check that no other hostname on the zone uses it.
- Bot Fight Mode stays off. It challenges `curl`, agents and video players, and it has no exemption.
- Automatic DDoS protection stays on.

## Budget alert

One budget alert at `$3` in **Billing > Billable Usage**. It sends a next-day email for a charge outside the cost model. It caps nothing.
