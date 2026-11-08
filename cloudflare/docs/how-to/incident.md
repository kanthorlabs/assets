# Respond to an incident

Use this runbook for a request flood, abusive content or a budget alert. The [architecture](../explanation/architecture.md#cost-cap) page explains the cost cap. The [configuration](../reference/configuration.md#zone-rules) page lists the zone rules.

## Limits

- Workers Free gives the account 100,000 Worker requests per day. The quota resets at 00:00 UTC.
- After the quota ends, Workers return error `1027` until 00:00 UTC. Workers Free never bills.
- The webhook service shares this quota. A flood stops both services until 00:00 UTC. A flood is an outage, not a bill.
- A request that a zone rule blocks uses no Worker request and no R2 read.
- The rate limit rule blocks an IP for 10 seconds after 50 requests in 10 seconds on `/a/` or `/f/`.

## Zone rules for an incident

Edit the rules in the dashboard of the zone, in the WAF custom rules and rate limit rules. An API change needs the zone rules token from [Credentials](credentials.md#create-the-zone-rules-token).

| Rule | Normal state | Incident use |
| --- | --- | --- |
| `assets: 50 requests per 10 s per IP on /a/ and /f/` | Enabled, 50 requests per 10 seconds | Lower the request count. |
| `assets: allow only GET and HEAD on /a/ and /f/` | Enabled | Keep enabled. |
| `assets: kill switch` | Disabled | Enable it to block every request to the hostname. |

## Respond to a flood

1. Find the hot path and the source IPs. Use Security Events, Workers metrics and R2 metrics.
2. If one path or a small set of IPs causes the flood, lower the request count of the rate limit rule.
3. If the rate limit does not stop the flood, enable the kill switch. The kill switch also saves the shared quota for the webhook service.
4. If an object attracts the flood, delete it through the upload flow.
5. Watch Workers metrics until the request rate falls.
6. If the quota ends, wait until 00:00 UTC. The Worker serves again after the reset.

Do not use Under Attack Mode, except for a short time. It breaks video playback and `curl`. Do not enable Bot Fight Mode.

An upgrade to Workers Paid ends error `1027`, but it removes the hard cost cap. On Workers Paid, cost grows with the number of attacker IPs, about $0.66 per million requests. Before an upgrade, make sure that the rate limit rule and the budget alert are active.

## Remove abusive content

1. Delete the object through the upload flow.
2. A forward link returns `404` at once. Browsers can keep an asset for up to 300 seconds.
3. For phishing content, also request a Safe Browsing review.

## Respond to a budget alert

The `$3` budget alert sends a next-day email for a charge outside the cost model.

1. In **Billing > Billable Usage**, find the product that bills.
2. Run the account preflight. Follow [Run the account preflight](credentials.md#run-the-account-preflight).
3. Fix each failure that the preflight reports. For example, remove `r2.dev` access or a custom domain from a bucket, or remove a Logpush job to R2.
4. If the preflight warns about Workers Paid, the hard cost cap does not apply. Check the Workers plan of the account.
5. Check R2 storage and R2 writes against the [upload contract](../../../docs/reference/upload-contract.md).

## Return to normal

1. Disable the kill switch.
2. Set the rate limit rule back to 50 requests per 10 seconds.
3. From `cloudflare/`, run the readiness check and the live E2E suite. Replace the origin with `ASSETS_BASE_URL`.

   ```sh
   ASSETS_BASE_URL=https://assets.kanthorlabs.com node scripts/wait-ready.ts
   ASSETS_BASE_URL=https://assets.kanthorlabs.com pnpm run test:e2e
   ```
