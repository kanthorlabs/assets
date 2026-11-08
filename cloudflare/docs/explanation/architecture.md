# Architecture and cost cap

One Cloudflare Worker serves `/a/` and `/f/` from one private R2 bucket. It also serves `/` and `/ip`, which make no R2 call. Zone rules run in front of the Worker. Workers Free is the hard cost cap.

```text
visitor ──► zone rules ──► Worker (core handler + R2 reader) ──► R2 bucket
            rate limit       one get() or head() per request      a/<path>
            allowlist                                             f/<uuid>/<basename>
            kill switch
```

## Components

| Component | Package | Role |
| --- | --- | --- |
| Core | `@kanthorlabs/assets-core` | Routes, validation, content types, headers, Range, ETag and errors. It uses only web-standard `Request`, `Response`, `URL` and `ReadableStream`. |
| Cloudflare adapter | `@kanthorlabs/assets-cloudflare` | The Worker entry and the R2 reader. It builds the core ports from `env` on each request. |
| Zone rules | `cloudflare/zone-rules/` | Rate limit, method and path allowlist, kill switch. They block abuse before the Worker. |
| Operator tooling | `cloudflare/scripts/` | Preflight, deploy, readiness, live E2E and CI helpers. |

The core typecheck runs without Workers types. The type checker therefore proves that core has no platform dependency. The core port is one interface:

```ts
interface AssetReader {
  read(key: string, method: "GET" | "HEAD", range?: ByteRange): Promise<AssetObject | null>;
}
```

One `AssetReader` serves both modes. `createHandler({ assets, home, clientIp })` returns the request handler. `home` is the README text. The build bundles it into the Worker with a Vite `?raw` import. `clientIp` returns the client IP of a request. The Cloudflare adapter reads `CF-Connecting-IP`. Core has no Cloudflare header knowledge.

## Request flow

1. The handler returns `405` for a method other than `GET` or `HEAD`.
2. The exact path `/` returns the bundled README text. The exact path `/ip` returns the client IP. These two routes make no R2 call and stop here.
3. For other paths, the route selects asset or forward mode from the prefix. Other paths return `404`.
4. The mode validates the path. A failure returns `400`. Asset mode returns `404` for an unknown extension.
5. The handler builds the key `a/<path>` or `f/<uuid>/<basename>`.
6. On `GET` without `If-Range`, the handler parses `Range`.
7. The R2 reader makes one call. `GET` calls `ASSETS_BUCKET.get(key, { range })`. `HEAD` calls `ASSETS_BUCKET.head(key)`.
8. A `null` result returns `404`. A range start at or past the size returns `416`.
9. A weak `If-None-Match` match cancels the body and returns `304`.
10. The handler returns `200`, or `206` with `Content-Range`. It passes the R2 body stream through.

The R2 reader sends the range to R2 as a `Range` header. For a start at or past the object size, production R2 throws an error with code `10039`. The reader then calls `head()` once and returns the size without a body. Miniflare returns the full object with its size instead. In both cases, core cancels any body and returns `416` with `bytes */<size>`. The `206` range comes from the range that R2 returns, clamped to the size.

Every other exception from `get()` or `head()` becomes `StorageUnavailable`, and the handler returns `503`. A stream error after the headers cannot become a `503`.

The Worker never reads the body. The runtime pipes the bytes, so a large video uses almost no Worker CPU time. A large file costs one Worker request and one R2 read, whatever its size. Each range request of a video player costs one Worker request and one R2 read.

## One R2 call per request

Each Worker request makes at most one R2 call, with one exception. A `400`, a `405`, and a `404` that the route or the extension decides make no call. The `/` and `/ip` routes make no call. The reader never lists and never retries. A Miniflare test counts the bucket calls per route.

The exception is a `416` for a range start at or past the object size. Production R2 rejects that `get()` with error `10039`, so the reader makes one `head()` call to learn the size. That request makes two R2 calls. A test with a bucket double proves the `get` and `head` sequence.

With the Workers Free quota, this invariant keeps R2 reads at 200,000 per day or fewer. That bound applies only if every request is an unsatisfiable range. Otherwise the bound is 100,000 per day.

## Storage

One private R2 bucket holds both modes. Asset objects use the prefix `a/`. Forward objects use `f/<uuid>/<basename>`. The URL carries the full key, so the service needs no id lookup store. The basename in the key keeps the download filename.

The bucket has no `r2.dev` access and no custom domain. Every read goes through the Worker, so the zone rules cover every read.

## Deployment identity

`cloudflare/cloudflare.config.ts` declares one Worker with one Custom Domain. `workers.dev`, preview URLs, observability and Logpush are off. These settings keep all Worker traffic behind the zone rules. `pnpm run deploy` asserts each of them in the build output, with the exact R2 binding.

The deploy refuses to take over a Custom Domain, DNS records or a Worker that another deployment owns. [Configuration](../reference/configuration.md#ownership-checks) lists the checks.

## Cost cap

Usage charges stay at or below $10 per month in the worst case. Fixed fees, such as the zone plan and the domain, are outside the cap.

Workers Free is the hard cap. The account gets 100,000 Worker requests per day, reset at 00:00 UTC. After that, Workers return error `1027`. Workers Free never bills. The webhook service shares this quota. A flood stops both services until 00:00 UTC. That is an outage, not a bill.

The rate limit protects the shared daily quota, not the bill. A request that a zone rule blocks uses no Worker request and no R2 read.

### Worst case

For a 31-day month:

| Item | Bound | Cost |
| --- | --- | --- |
| Workers requests and CPU | Workers Free never bills. | $0 |
| R2 reads | 2 × 100,000 × 31 = 6.2 M, under the free 10 M. Two reads apply only to an unsatisfiable range. | $0 |
| R2 writes | The upload contract keeps them under the free 1 M. | $0 |
| R2 storage | The upload contract caps it at 100 GB: (100 − 10) × $0.015. | $1.35 |
| S3 API and REST API | No credentials exist. | $0 |
| Total | | about $1.35 |

### Conditions

The cap holds while these conditions are true:

- Cloudflare enforces the Workers Free limits.
- The code keeps the R2 call bound in [One R2 call per request](#one-r2-call-per-request).
- The upload flow obeys the [upload contract](../../../docs/reference/upload-contract.md).
- The account stays secure: 2FA, few members, and no broad OAuth profile for deploys.
- The deploy and CI tokens have no R2 permission. No R2 S3 credentials exist. Requests that fail authentication do not bill.
- The account preflight passes. [Configuration](../reference/configuration.md#cost-cap-checks) lists its checks.

### Workers Paid

An upgrade to Workers Paid removes the hard cap. Before an upgrade, make sure that the rate limit rule and the budget alert are active. On Workers Paid, cost grows with the number of requests, not with the number of bytes. Cost grows with the number of attacker IPs, about $0.66 per million requests.

| Item | Price |
| --- | --- |
| Workers Paid plan | $5 per month, with 10 M requests and 30 M CPU ms |
| Workers requests above the allowance | $0.30 per million |
| Workers CPU above the allowance | $0.02 per million CPU ms |
| Workers egress | $0 |
| R2 reads (Class B, Standard) | 10 M free per month, then $0.36 per million |
| R2 writes (Class A) | $4.50 per million |
| R2 storage | $0.015 per GB-month |
| R2 egress | $0 |

R2 bills a `404` on a binding call, because the request is authenticated. Workers Paid and R2 have no hard spend cap.
