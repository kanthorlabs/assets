# Assets

The assets service serves files from one private Cloudflare R2 bucket on `assets.kanthorlabs.com`. One Cloudflare Worker serves two routes:

| Route | Mode | R2 key | Use |
| --- | --- | --- | --- |
| `GET`/`HEAD /a/<path>.<ext>` | Asset | `a/<path>.<ext>` | Public static content: HTML pages, CSS, JS, images, video and other large media. |
| `GET`/`HEAD /f/<uuid>/<basename>` | Forward | `f/<uuid>/<basename>` | Private files behind an unguessable link. PDF, images, video and audio open in the browser. |

Both routes support a single byte range (`206`), weak ETag revalidation (`304`) and `HEAD`. All other paths return `404`. A platform-agnostic core holds the request logic. A Cloudflare adapter supplies the runtime and the R2 reader.

The service only reads. Uploads run in a separate private workspace and follow the [upload contract](docs/reference/upload-contract.md).

## Repository layout

| Path | Content |
| --- | --- |
| `core/` | `@kanthorlabs/assets-core`: routes, validation, headers, Range, ETag and errors. Web-standard APIs only. |
| `cloudflare/` | `@kanthorlabs/assets-cloudflare`: the Worker entry, the R2 reader, deploy tooling and tests. |
| `cloudflare/scripts/` | Operator commands: preflight, deploy, readiness, live E2E and GitHub secret sync. |
| `cloudflare/zone-rules/` | Zone rules in the Rulesets API format: rate limit, method and path allowlist, kill switch, HTML rewrite settings. |
| `cloudflare/e2e-fixtures/` | The fixed objects that the live E2E suite reads. See [E2E fixtures](cloudflare/e2e-fixtures/README.md). |
| `docs/` | Platform-independent contracts: API, acceptance, upload contract, security. |
| `cloudflare/docs/` | Cloudflare operations: deploy, credentials, CI, incident, configuration, tooling, architecture. |
| `.github/workflows/cloudflare.yml` | CI: checks on each pull request, deploy and live E2E on a push to `main`. |

## Local checks

Use Node 24.15.0 and pnpm 11.24.0. Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` runs the `check` script of each package. In `core/`, it runs typecheck, lint and tests. In `cloudflare/`, it also runs the tooling tests and the production build. The checks need no Cloudflare account and no credentials.

## Run the Worker locally

Run this command from `cloudflare/`:

```sh
pnpm run dev
```

The Worker listens on `http://localhost:8787` with a local simulated R2 bucket named `assets-local`. The script uses `--no-cors`, because the Vite CORS middleware otherwise answers `OPTIONS` before the Worker. To put objects in the local bucket and run the live E2E suite against the local Worker, follow [E2E fixtures](cloudflare/e2e-fixtures/README.md#run-the-suite-against-the-local-worker).

## Documentation

The documentation follows [Diátaxis](https://diataxis.fr/).

- **How-to guides:** [deploy](cloudflare/docs/how-to/deploy.md), [credentials](cloudflare/docs/how-to/credentials.md), [CI](cloudflare/docs/how-to/ci.md) and [incident runbook](cloudflare/docs/how-to/incident.md).
- **Reference:** [HTTP API](docs/reference/api.md), [acceptance checks](docs/reference/acceptance.md), [upload contract](docs/reference/upload-contract.md), [configuration](cloudflare/docs/reference/configuration.md) and [commands and tooling](cloudflare/docs/reference/tooling.md).
- **Explanation:** [security model](docs/explanation/security.md) and [Cloudflare architecture and cost cap](cloudflare/docs/explanation/architecture.md).
