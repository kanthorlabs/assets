# Manage credentials

Each task uses its own Cloudflare credential with the smallest scope. Only the deploy token is long-lived. The deploy token and the CI token have no R2 permission. The project and its Worker hold no R2 S3 credentials.

Create each token in **My Profile > API Tokens > Create Token > Create Custom Token**. Do not use **Manage Account > Account API Tokens**. Set every resource scope to the specific account and the specific zone of `ASSETS_HOSTNAME`. Do not select all accounts or all zones.

## Credentials

| Credential | Lifetime | Where it lives | Use |
| --- | --- | --- | --- |
| Deploy token | Long-lived, rotate on demand | `CLOUDFLARE_API_TOKEN` in `.env.production` and in GitHub secrets | `pnpm run deploy`, `pnpm run preflight --remote`, CI deploy. |
| Preflight token | Short-lived, read-only | The shell only | `pnpm run preflight --account`. |
| Zone rules token | Short-lived | The shell only | Apply or change the zone rules through the API. |
| R2 write credential | Short-lived | The shell only | Seed the E2E fixtures. The upload flow uses its own short-lived credentials. |
| GitHub CLI login | Session | `gh` | `pnpm run sync-secrets`. |

## Create the deploy token

Give the token these permissions:

| Scope | Permission | Access | Use |
| --- | --- | --- | --- |
| Account | Workers Scripts | Edit | Upload the Worker and attach the Custom Domain. |
| Account | Account Settings | Read | Read account metadata for the `cf` CLI. |
| Zone | Zone | Read | Find the active zone of `ASSETS_HOSTNAME`. |
| Zone | DNS | Read | Find DNS records that conflict with the Custom Domain. |
| Zone | Workers Routes | Read | Route conflict checks of the `cf` CLI. |

Do not add an R2 permission. The Worker R2 binding needs no token permission. Do not add billing, WAF or DNS write permissions.

Put the token in `.env.production` as `CLOUDFLARE_API_TOKEN`. Hosted CI runners have no OAuth profile, so CI requires this token. For a local deploy, you can omit the token and use `pnpm exec cf auth login`.

## Run the account preflight

1. Create a token with these read permissions:

   | Scope | Permission | Access |
   | --- | --- | --- |
   | Account | Account Settings | Read |
   | Account | Billing | Read |
   | Account | Workers R2 Storage | Read |
   | Account | Logs | Read |
   | Zone | Zone | Read |
   | Zone | Zone Settings | Read |
   | Zone | Logs | Read |

2. Set the TTL end date of the token to the current day.
3. If `.env.production` contains `CLOUDFLARE_API_TOKEN`, copy it without that line to `.env.preflight`.
4. Run `chmod 600 .env.preflight`.
5. Read the token into the shell without echo:

   ```sh
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   ```

6. Run the account preflight from `cloudflare/`. Add `--config ./.env.preflight` if you made that file in step 3.

   ```sh
   pnpm run preflight --account
   ```

7. Make sure that the output contains `Workers Free: no Workers Paid subscription found.` and `Cost cap checks passed.` The output can also contain information lines about other private buckets and Logpush. See [Cost cap checks](../reference/configuration.md#cost-cap-checks).
8. Run `unset CLOUDFLARE_API_TOKEN`.
9. Delete the token in the dashboard. Remove `.env.preflight`.

A token in the environment file has priority over the shell token. The deploy token has no billing permission, so the account preflight fails with it.

## Create the zone rules token

Give the token **Zone > Zone WAF > Edit** and **Zone > Config Rules > Edit** on the zone of `ASSETS_HOSTNAME`. Set the TTL end date to the current day. Delete the token after the change. An operator who edits the rules in the dashboard needs no token.

## Seed the E2E fixtures

Create a token with **Account > Workers R2 Storage > Edit**. Set the TTL end date to the current day. Read it into the shell as `CLOUDFLARE_API_TOKEN`, as in the account preflight. Run the upload commands in [E2E fixtures](../../e2e-fixtures/README.md#seed-the-production-bucket). Then unset the variable and delete the token.

## Rotate the deploy token

1. Create a new deploy token with the permissions above.
2. Replace `CLOUDFLARE_API_TOKEN` in `.env.production`.
3. Run `pnpm run preflight --remote`.
4. If CI deploys this Worker, run `pnpm run sync-secrets --repo OWNER/REPOSITORY`. See [CI](ci.md).
5. Delete the old token in the dashboard.

If a token leaks, delete it in the dashboard first. Then do the rotation steps.
