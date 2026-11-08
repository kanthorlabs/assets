# Commands and tooling

Run package commands from the package directory. Run `pnpm install` and the root `pnpm run check` from the repository root.

Pass flags directly after the script name: `pnpm run deploy --dry-run`. Do not write `pnpm run deploy -- --dry-run`. pnpm forwards the literal `--`, and the script stops with `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`.

## Pinned environment

| Tool | Version |
| --- | --- |
| Node | 24.15.0. The engine field allows `>=24.15.0 <25`. |
| pnpm | 11.24.0 |
| `cf` | 1.0.0-beta.5 |
| `@cloudflare/vite-plugin` | 2.0.0-beta.sha-ad79608dd |
| `@cloudflare/vitest-pool-workers` | 0.22.0 |
| `@cloudflare/workers-auth` | 0.9.4 |
| Vite | 8.3.1 |
| TypeScript | 7.0.2 |
| Biome | 2.5.14 |
| Vitest | 4.1.9 |

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` and `saveExact: true`. pnpm 11 ignores these settings in `.npmrc`. `allowBuilds` permits the install scripts of `esbuild` and `workerd` only. Install with `pnpm install --frozen-lockfile`.

## Root

| Command | Effect |
| --- | --- |
| `pnpm install --frozen-lockfile` | Installs the workspace from the lockfile. |
| `pnpm run check` | Runs `pnpm -r run check`: the `check` script of `core` and of `cloudflare`. |

## `core/` scripts

| Command | Effect |
| --- | --- |
| `pnpm run typecheck` | `tsc --noEmit` with no Workers types. It proves that core has no platform dependency. |
| `pnpm run lint` | `biome check .` |
| `pnpm run format` | `biome check --write .`. It changes files. |
| `pnpm run test` | Vitest in Node with in-memory fakes. |
| `pnpm run check` | `typecheck`, `lint`, then `test`. |

## `cloudflare/` scripts

| Command | Effect |
| --- | --- |
| `pnpm run typecheck` | `cf workers types`, then `tsc --noEmit`. |
| `pnpm run lint` | `biome check .` |
| `pnpm run format` | `biome check --write .`. It changes files. |
| `pnpm run test` | Vitest in the Workers pool with Miniflare and the `ASSETS_BUCKET` R2 bucket. |
| `pnpm run test:tooling` | `node --test test-tools/*.test.ts`. The Cloudflare API and `gh` are fakes. |
| `pnpm run build` | `cf build`. It writes `.cloudflare/output/` and uploads nothing. |
| `pnpm run check` | `typecheck`, `lint`, `test`, `test:tooling`, then `build`. |
| `pnpm run dev` | `vite dev --port 8787 --strictPort --no-cors`. See [Local Worker](#local-worker). |

Local checks need no credentials and make no call to a live Cloudflare account.

## Operator commands

Run these from `cloudflare/`. Each command that reads the environment file accepts `--config PATH`. The default is `.env.production`. See [Configuration](configuration.md#environment-file).

| Command | Flags | Effect |
| --- | --- | --- |
| `pnpm run preflight` | `--config`, `--remote`, `--account` | Validates the file. `--remote` also authenticates and runs the ownership checks. `--account` runs the cost cap checks. |
| `pnpm run deploy` | `--config`, `--dry-run` | Remote preflight, build, build inspection, then upload. `--dry-run` skips authentication and the upload. |
| `pnpm run sync-secrets` | `--config`, `--repo OWNER/REPOSITORY` | Copies each setting in the file to a GitHub repository secret through `gh`. `--repo` is required. |
| `node scripts/wait-ready.ts` | None | Sends `GET /f/not-a-uuid/ready.pdf` and waits for the Worker `400` with `no-store` and `nosniff`. At most 24 attempts, 5 seconds apart. |
| `pnpm run test:e2e` | None | Live E2E for asset and forward modes. See [Acceptance](../../../docs/reference/acceptance.md#automated-live-e2e). |
| `pnpm run fixtures` | None | Writes the E2E fixtures from the root `README.md`. See [E2E fixtures](../../e2e-fixtures/README.md#generate-the-fixtures). |
| `node scripts/ci-environment.ts` | None | CI only. Writes `.env.production` from the process environment. It refuses to overwrite a file. |

`wait-ready.ts` and `test:e2e` read `ASSETS_BASE_URL` from the process environment. They follow no redirect and time out each request after 30 seconds.

The commands print no secret values and no CLI diagnostics. A failed deploy prints `Deployment failed; no success is claimed.` Check the Cloudflare deployment status before a retry.

## Local Worker

Run the Worker with a local R2 simulation from `cloudflare/`:

```sh
pnpm run dev
```

The local bucket is `assets-local`. Its state is in `cloudflare/.cloudflare/state`. The script uses `--no-cors`, because the Vite CORS middleware otherwise answers `OPTIONS` before the Worker. To seed the local bucket and run the E2E suite, follow [E2E fixtures](../../e2e-fixtures/README.md#run-the-suite-against-the-local-worker).

## Source map

| Path | Role |
| --- | --- |
| `core/src/handler.ts` | `createHandler`: method, route, validation, one read, `416`, `304`, `200` and `206`. |
| `core/src/route.ts` | Prefix routes `/a/` and `/f/`. |
| `core/src/validate.ts` | Asset path and forward path rules. |
| `core/src/range.ts` | `Range` parser and `Content-Range` value. |
| `core/src/etag.ts` | Weak `If-None-Match` comparison. |
| `core/src/content-type.ts` | Extension to `Content-Type` map. |
| `core/src/headers.ts` | Cache, CORS, security, CSP and `Content-Disposition` headers. |
| `core/src/errors.ts` | Plain-text error responses. |
| `core/src/ports.ts` | `AssetReader`, `AssetObject`, `ByteRange`, `StorageUnavailable`. |
| `cloudflare/src/index.ts` | Worker entry. Builds the handler from `env.ASSETS_BUCKET`. |
| `cloudflare/src/r2-reader.ts` | `AssetReader` on R2: one `get` or `head` call per request. |
| `cloudflare/scripts/environment.ts` | Environment file rules and setting validation. |
| `cloudflare/scripts/deployment-auth.ts`, `cf-profile.ts` | Credential selection and the private OAuth profile reader. |
| `cloudflare/scripts/cloudflare-api.ts` | Read-only Cloudflare API client, zone and ownership checks. |
| `cloudflare/scripts/preflight.ts`, `deploy.ts` | Preflight, cost cap checks, build inspection and upload. |
| `cloudflare/scripts/client.ts`, `wait-ready.ts`, `e2e.ts` | HTTP client, readiness and live E2E. |
| `cloudflare/scripts/fixtures.ts` | E2E fixture generator. |
| `cloudflare/scripts/ci-environment.ts`, `sync-secrets.ts` | CI environment file and GitHub secrets. |
| `cloudflare/test/` | Worker and R2 reader tests in Miniflare. |
| `cloudflare/test-tools/` | Node tests for the operator scripts. |
| `cloudflare/zone-rules/` | Zone rules. |
| `cloudflare/e2e-fixtures/` | Live E2E fixtures and their manifest. |
