# Set up CI

The workflow is `.github/workflows/cloudflare.yml`. Use this guide after a successful [manual deploy](deploy.md).

**A push to `main` deploys production.** Do not sync secrets to a repository that must not deploy.

## Workflow

The workflow runs when a change touches `core/**`, `cloudflare/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json` or the workflow file.

| Job | Trigger | Steps |
| --- | --- | --- |
| `check` | Pull request and push to `main` | `pnpm install --frozen-lockfile`, `pnpm run check` at the root, then `actionlint` on the workflow. |
| `deploy` | Push to `main`, after `check` passes | See the list below. |

The `deploy` job runs in `cloudflare/` with `contents: read` and a 20-minute timeout:

1. `pnpm install --frozen-lockfile`.
2. `node scripts/ci-environment.ts` writes `.env.production` from the GitHub secrets, with mode `0600`.
3. `pnpm run deploy --dry-run` checks the configuration and the build. It uploads nothing.
4. `pnpm run deploy` runs the remote preflight, builds, inspects the build and uploads.
5. `node scripts/wait-ready.ts && pnpm run test:e2e` waits for the Worker and runs the live E2E suite.
6. `rm -f .env.production` runs in an `always()` step, also after a failure.

Actions are pinned by commit. Runs for the same workflow and ref run one at a time. GitHub does not cancel a run in progress. CI never uploads to R2.

## Secrets

The deploy job reads these repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The deploy token from [Credentials](credentials.md#create-the-deploy-token). |
| `CLOUDFLARE_ACCOUNT_ID` | See [Configuration](../reference/configuration.md#settings). |
| `ASSETS_WORKER_NAME` | Same. |
| `ASSETS_HOSTNAME` | Same. |
| `ASSETS_BASE_URL` | Same. |
| `ASSETS_R2_BUCKET` | Same. |

`ci-environment.ts` stops with `Missing GitHub Actions secret: <name>` when a secret other than `CLOUDFLARE_API_TOKEN` is empty. It omits an empty `CLOUDFLARE_API_TOKEN`. A hosted runner has no OAuth profile, so the deploy then fails before the upload.

## Set up the repository

1. Seed the E2E fixtures once. Follow [E2E fixtures](../../e2e-fixtures/README.md#seed-the-production-bucket).
2. Put the deploy token in `.env.production` as `CLOUDFLARE_API_TOKEN`.
3. Log in to GitHub:

   ```sh
   gh auth login
   ```

4. From `cloudflare/`, copy the settings to the repository secrets. Replace `OWNER/REPOSITORY`.

   ```sh
   pnpm run sync-secrets --repo OWNER/REPOSITORY
   ```

5. Run `gh secret list --repo OWNER/REPOSITORY`. Make sure that it shows the six secrets.

`sync-secrets` validates the file, then sends each value to `gh secret set` through stdin. It never prints a value. It requires `--repo`. It accepts `--env-file PATH`.

## Run and inspect

1. Push a change on `main`.
2. In GitHub Actions, check that `check` passes.
3. Check that `deploy` prints `Live E2E passed for asset and forward modes.`

A pull request runs `check` only. It gets no production secrets.

## Handle a failure

A failed job does not roll back the upload. Read the failed step, then check the Cloudflare deployment status before a retry.

| Failed step | Output | Action |
| --- | --- | --- |
| Configuration | `Missing GitHub Actions secret: <name>` | Run `sync-secrets` again. |
| Dry run or deploy | `Deployment failed; no success is claimed.` | Run `pnpm run preflight --remote` and `pnpm run deploy --dry-run` locally with the same settings. |
| Readiness | `Readiness failed within the bounded retry window.` | Check the Custom Domain and the zone rules. Make sure that the kill switch is disabled. |
| Live E2E | `Live E2E failed: <check>` | Check that the fixtures are in the bucket. Compare the response with the [API reference](../../../docs/reference/api.md). |

If you change a fixture file, upload it again before the next push to `main`.
