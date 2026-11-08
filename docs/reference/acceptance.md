# Acceptance checks

These checks define the required live behavior of a deployment. Run them after the first deploy and after a change to the zone rules, the R2 reader or the response headers. The automated subset runs in CI as `pnpm run test:e2e`.

A pass on this page is evidence for one deployment only. It is not a guarantee for later revisions.

## Setup

Set the origin in the shell:

```sh
H=https://assets.kanthorlabs.com
```

"Worker error" means a response with the expected status, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Content-Type: text/plain; charset=utf-8`.

Upload the test objects through the upload flow. Follow the [upload contract](upload-contract.md). The CI fixtures are in [E2E fixtures](../../cloudflare/e2e-fixtures/README.md).

## Automated live E2E

`pnpm run test:e2e` reads the fixed fixtures from `cloudflare/e2e-fixtures/manifest.json`. It sends `Accept-Encoding: identity`, so edge compression does not change the length, Range and ETag checks.

| Mode | Check | Expected result |
| --- | --- | --- |
| Asset | `GET /a/e2e/fixture.html` | `200`, exact fixture bytes, `text/html; charset=utf-8`, `public, max-age=300`, `Access-Control-Allow-Origin: *`, CSP sandbox, `nosniff`, `Accept-Ranges: bytes`, `ETag`. |
| Asset | `HEAD` on the fixture | `200`, the same `Content-Type`, `Content-Length`, `ETag` and `Cache-Control` as `GET`, no body. |
| Asset | `If-None-Match: <etag>` | `304` with the same `ETag` and `Access-Control-Allow-Origin: *`. |
| Asset | `Range: bytes=0-99` | `206`, `Content-Range: bytes 0-99/<size>`, `Content-Length: 100`, the first 100 bytes. |
| Asset | Random absent key | Worker error `404`. |
| Asset | `/a/e2e/fixture.unknown` | Worker error `404`. |
| Asset | `/a/e2e/.hidden.html`, `/a/e2e%2Ffixture.html`, `/a/e2e%5Cfixture.html` | Worker error `400`. |
| Asset | Raw path `/a/e2e/../e2e/missing.html` | Worker error `400` or `404`. Cloudflare can normalize dot segments. |
| Asset | `POST` and `OPTIONS` on the fixture | Cloudflare block `403`, or Worker error `405` with `Allow: GET, HEAD`. |
| Forward | `GET` on the fixture PDF | `200`, exact bytes, `application/pdf`, `inline; filename*=UTF-8''fixture.pdf`, `no-store`, `nosniff`, no CSP, no CORS. |
| Forward | `HEAD` on the fixture | Same headers as `GET`, no body. |
| Forward | `Range: bytes=0-99` | `206`, `Content-Range: bytes 0-99/<size>`, `Content-Length: 100`, the first 100 bytes. |
| Forward | Random lowercase UUIDv4 | Worker error `404`. |
| Forward | `not-a-uuid`, uppercase UUID, three segments, dotfile basename | Worker error `400`. |

## Edge and zone rules

1. `curl -sS -i $H/x` returns the Cloudflare block.
2. `curl -sS -i -X POST $H/a/x.html` returns the Cloudflare block.
3. More than 50 requests in 10 seconds from one IP to `/a/` return `429` or the Cloudflare block.
4. The kill switch rule exists and is disabled.
5. The `$3` budget alert exists.
6. `curl -sS -i $H/a/x.html` returns the Worker error `404`.

## Asset mode

Upload `a/hello.html`, `a/hello.js`, `a/font.woff2` and `a/video.mp4` (at least 1 GB). The page loads `<script type="module" src="/a/hello.js">` and a `@font-face` from `/a/font.woff2`.

1. `curl -sS -i --compressed $H/a/hello.html` returns `200`, `text/html; charset=utf-8`, the CSP sandbox, an `ETag`, `public, max-age=300`, `Access-Control-Allow-Origin: *`, `nosniff` and `no-referrer`.
2. `curl -sS -i --compressed -H 'If-None-Match: <etag>' $H/a/hello.html` returns `304` with no body. Use the `W/` ETag from check 1.
3. `curl -sS -I $H/a/hello.html` returns the same headers and `Content-Length` as `GET`.
4. In a browser, the module script runs and the font loads, with no CORS errors.
5. In a browser, `a/video.mp4` plays and seeks. DevTools shows `206` responses.
6. `curl -sS -r 0-99 -o part -D - $H/a/video.mp4 && wc -c part` returns `206`, `bytes 0-99/<size>` and 100 bytes.
7. `curl -sS -D - -o /dev/null -H 'Range: bytes=-100' $H/a/video.mp4` returns `206` for the last 100 bytes.
8. `curl -sS -i -H 'Range: bytes=999999999999-' $H/a/hello.html` returns `416` with `Content-Range: bytes */<size>`.
9. Each of these returns a Worker error `400` or `404`:
   - `curl -sS -i --path-as-is $H/a/../a/hello.html`
   - `curl -sS -i --path-as-is $H/a/x/../../f/x.html`
   - `curl -sS -i $H/a/%2e%2e/hello.html`
   - `curl -sS -i $H/a/x%2Fhello.html`
   - `curl -sS -i $H/a/.env.json`
10. `curl -sS -i $H/a/missing.html` returns the Worker error `404`.

A `503` in check 8 means that production R2 throws on a range past the end. The R2 reader then needs a fix.

## Forward mode

Make an id with `ID=$(uuidgen | tr A-Z a-z)`. Upload `f/$ID/report.pdf` and `f/$ID/demo.mp4` (at least 1 GB).

1. `curl -sS -I $H/f/$ID/report.pdf` returns `200`, `application/pdf`, `inline; filename*=UTF-8''report.pdf`, `no-store`, `nosniff` and `no-referrer`, with no CSP and no CORS.
2. Chrome, Firefox and Safari show the PDF inline, with no download prompt.
3. In a browser, `demo.mp4` plays and seeks, also near the end.
4. `curl -sS -r 0-99 -o part -D - $H/f/$ID/demo.mp4 && wc -c part` returns `206`, `bytes 0-99/<size>` and 100 bytes.
5. `curl -sS -i $H/f/$(uuidgen | tr A-Z a-z)/report.pdf` returns the Worker error `404`.
6. `curl -sS -i $H/f/not-a-uuid/report.pdf` returns the Worker error `400`.
7. Delete `f/$ID/report.pdf` through the upload flow. Run check 1 again at once. It returns `404`.
8. `curl -sS -o /dev/null -w '%{speed_download} %{time_total}\n' $H/f/$ID/demo.mp4` shows a speed close to a direct R2 download.
9. Workers metrics show a CPU time below 10 ms for the download in check 8.

## CI

1. A push to `main` runs `check`, then `deploy`. The deploy job prints `Live E2E passed for asset and forward modes.`
2. A pull request that changes `cloudflare/**` runs `check` only.
