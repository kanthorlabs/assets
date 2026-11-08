# Deploy to Cloudflare

Use this guide for the first deploy and for a manual redeploy. After the first deploy, CI deploys each push to `main`. See [CI](ci.md).

**A deploy publishes the Worker and attaches its Custom Domain.** Run each command from `cloudflare/`.

## Requirements

- Node 24.15.0 and pnpm 11.24.0.
- A Cloudflare account on Workers Free. A Free zone plan alone does not prove the Workers plan.
- An active zone in that account for the parent domain of `ASSETS_HOSTNAME`.
- One private R2 bucket with the Standard storage class, no `r2.dev` access and no custom domain.

## 1. Install and check

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

## 2. Prepare the configuration

1. Copy the template. The flag `-n` does not overwrite a file that exists.

   ```sh
   cp -n .env.example .env.production
   chmod 600 .env.production
   ```

2. Edit `.env.production` privately. Set each name in [Configuration](../reference/configuration.md#settings).
3. If the bucket does not exist, create it as a private bucket with the Standard storage class.
4. Validate the file. This step makes no remote call.

   ```sh
   pnpm run preflight
   ```

## 3. Check the cost cap

Run the account preflight with a short-lived read-only token. Follow [Run the account preflight](credentials.md#run-the-account-preflight).

Do not continue if the output contains `WARNING: Workers Paid subscription found.` On Workers Paid, the hard cost cap does not apply.

## 4. Configure the deploy credential

Choose one method:

- Token: create the deploy token in [Credentials](credentials.md#create-the-deploy-token). Put it in `.env.production` as `CLOUDFLARE_API_TOKEN`.
- Local OAuth: run `pnpm exec cf auth login`. Omit `CLOUDFLARE_API_TOKEN` from the file and the shell.

## 5. Review before the upload

```sh
pnpm run preflight --remote
pnpm run deploy --dry-run
```

The remote preflight checks the zone, the Custom Domain, the DNS records and the current Worker. The dry run builds the Worker and inspects the build output. It uploads nothing. [Configuration](../reference/configuration.md#ownership-checks) lists each check.

Do not continue after a conflict or an authorization failure. Do not add permissions to the token to pass a check.

## 6. Deploy and verify

1. Deploy:

   ```sh
   pnpm run deploy
   ```

2. Wait until the Worker answers on the Custom Domain. Replace the origin with `ASSETS_BASE_URL`.

   ```sh
   ASSETS_BASE_URL=https://assets.kanthorlabs.com node scripts/wait-ready.ts
   ```

3. If the E2E fixtures are not in the bucket, seed them. Follow [E2E fixtures](../../e2e-fixtures/README.md#seed-the-production-bucket).
4. Run the live E2E suite:

   ```sh
   ASSETS_BASE_URL=https://assets.kanthorlabs.com pnpm run test:e2e
   ```

The output is `Live E2E passed for asset and forward modes.` A failure after the upload can leave a changed deployment. Check the Cloudflare deployment status before a retry.

## 7. Protect the hostname

Do this step once, after the first deploy. Use a short-lived zone rules token from [Credentials](credentials.md#create-the-zone-rules-token).

1. If `ASSETS_HOSTNAME` is not `assets.kanthorlabs.com`, change `http.host` in `zone-rules/http_request_firewall_custom.json`.
2. Check that no other hostname on the zone uses the one Free rate limit rule.
3. Read the token and set the zone id:

   ```sh
   read -rs CF_WAF_TOKEN && export CF_WAF_TOKEN
   ZONE=<zone-id>
   ```

4. For each phase, read the phase entrypoint ruleset. The phases are `http_request_firewall_custom` and `http_ratelimit`.

   ```sh
   PHASE=http_request_firewall_custom
   curl -sS -H "Authorization: Bearer $CF_WAF_TOKEN" \
     "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/$PHASE/entrypoint"
   ```

5. If the entrypoint does not exist (HTTP `404`), create it with the file:

   ```sh
   curl -sS -X PUT -H "Authorization: Bearer $CF_WAF_TOKEN" -H "Content-Type: application/json" \
     --data @zone-rules/$PHASE.json \
     "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/$PHASE/entrypoint"
   ```

6. If the entrypoint exists, add each rule with `POST`. Set `RULESET` to the `id` from step 4.

   ```sh
   RULESET=<ruleset-id>
   jq -c '.rules[]' zone-rules/$PHASE.json | while read -r rule; do
     curl -sS -X POST -H "Authorization: Bearer $CF_WAF_TOKEN" -H "Content-Type: application/json" \
       --data "$rule" "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/$RULESET/rules"
   done
   ```

7. Do steps 4 to 6 again with `PHASE=http_ratelimit`.
8. Run `unset CF_WAF_TOKEN`. Delete the token in the dashboard.
9. In the dashboard, open **Billing > Billable Usage**. Create one budget alert at `$3`.
10. Run the checks in [Acceptance: edge and zone rules](../../../docs/reference/acceptance.md#edge-and-zone-rules).

Do not use `PUT` on an entrypoint that exists. A `PUT` replaces every rule in the phase. It can delete the rules of other services on the same zone.

## Redeploy

Keep `ASSETS_WORKER_NAME`, `ASSETS_HOSTNAME` and the prefixes `/a/` and `/f/` stable. A change to the hostname or a prefix breaks every shared link.

For a redeploy, run steps 5 and 6. For a token change, follow [Rotate the deploy token](credentials.md#rotate-the-deploy-token).
