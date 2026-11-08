# E2E fixtures

The live E2E suite (`pnpm run test:e2e`) reads three fixed objects from the R2 bucket. `manifest.json` maps each object key to its file in this directory. The suite compares the served bytes with these files.

| Mode | Key | File |
| --- | --- | --- |
| Asset | `a/e2e/readme.html` | `readme.html` |
| Asset | `a/e2e/readme.txt` | `readme.txt` |
| Forward | `f/00000000-0000-4000-8000-000000000000/readme.pdf` | `readme.pdf` |

The fixtures are public test content on purpose. The forward fixture UUID is a fixed placeholder in this repository, so its link is not a secret. Real forward links use a random UUIDv4.

## Generate the fixtures

The fixtures are a copy of the root `README.md` at one point in time. A README edit needs no fixture change.

`scripts/fixtures.ts` derives the three files from the root `README.md`. `readme.html` is the README rendered as HTML. `readme.pdf` contains the README text. `readme.txt` is the README bytes unchanged. The output is deterministic.

Run this command from `cloudflare/`:

```sh
pnpm run fixtures
```

To refresh the fixtures, run `pnpm run fixtures`, commit, and seed the production bucket before the merge.

## Seed the production bucket

CI does not upload. The deploy and CI tokens have no R2 permission. Seed the fixtures through the upload flow, outside CI. Do not delete these objects.

Run these commands from `cloudflare/` with a short-lived credential that can write to the bucket. Replace `<bucket>` with `ASSETS_R2_BUCKET`.

```sh
pnpm exec cf r2 objects put a/e2e/readme.html --bucket-name <bucket> --file e2e-fixtures/readme.html --cf-r2-storage-class Standard
pnpm exec cf r2 objects put a/e2e/readme.txt --bucket-name <bucket> --file e2e-fixtures/readme.txt --cf-r2-storage-class Standard
pnpm exec cf r2 objects put f/00000000-0000-4000-8000-000000000000/readme.pdf --bucket-name <bucket> --file e2e-fixtures/readme.pdf --cf-r2-storage-class Standard
```

## Run the suite against the local Worker

1. Seed the local bucket of the Vite dev server:

   ```sh
   pnpm exec cf r2 objects put a/e2e/readme.html --local --persist-to .cloudflare/state --bucket-name assets-local --file e2e-fixtures/readme.html
   pnpm exec cf r2 objects put a/e2e/readme.txt --local --persist-to .cloudflare/state --bucket-name assets-local --file e2e-fixtures/readme.txt
   pnpm exec cf r2 objects put f/00000000-0000-4000-8000-000000000000/readme.pdf --local --persist-to .cloudflare/state --bucket-name assets-local --file e2e-fixtures/readme.pdf
   ```

2. Start the Worker. The script disables the Vite CORS middleware, because it answers `OPTIONS` before the Worker:

   ```sh
   pnpm run dev
   ```

3. In a second shell, run the suite:

   ```sh
   ASSETS_BASE_URL=http://localhost:8787 pnpm run test:e2e
   ```
