# Security model

The service serves untrusted visitors from content that only the team and its agents upload. This page explains the trust boundaries and the controls on each one. The [HTTP API](../reference/api.md) holds the exact header values.

## Trust boundaries

| Actor | Trust | Access |
| --- | --- | --- |
| Visitor | Untrusted | `GET` and `HEAD` on `/a/` and `/f/` through the zone rules and the Worker. |
| Uploader (team and agents) | Trusted | Writes through the separate upload workspace, under the [upload contract](../reference/upload-contract.md). |
| Operator | Trusted | Deploys with a scoped token, and changes zone rules with a separate short-lived token. |
| CI | Trusted, limited | Deploys the Worker. It has no R2 permission and never uploads. |

The Worker has one R2 binding, `ASSETS_BUCKET`, and only reads. The project and its Worker hold no R2 S3 credentials. The bucket has no `r2.dev` access and no custom domain, so every read goes through the Worker and the zone rules.

## Shared HTML and SVG on our origin

Asset HTML and SVG run on `assets.kanthorlabs.com`. Without controls, a page script can register a Service Worker on `/a/` and set cookies for `.kanthorlabs.com`. It can also use origin storage and read other pages on the same origin.

HTML and SVG responses on `/a/` and `/f/` carry this policy:

```text
Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads
```

The sandbox omits `allow-same-origin`. The page gets an opaque origin. The opaque origin blocks Service Workers, cookies, storage and reads of other pages on the same origin. No KanthorLabs service uses cookies or sessions. The sandbox mainly stops a Service Worker takeover of `/a/`.

Scripts run. A shared page loads its own CSS, JS, images and media from `/a/`.

## CORS on asset mode

An opaque origin makes every request to our host a cross-origin request. Module scripts, `@font-face`, `fetch()` and `<link crossorigin>` need `Access-Control-Allow-Origin: *`. Vite builds emit `type="module" crossorigin` by default.

Asset `200`, `206` and `304` responses carry `Access-Control-Allow-Origin: *` with no credentials. Asset content is public, so `*` exposes nothing new. Forward responses carry no CORS header.

## Embeds on other sites

The service sends no `frame-ancestors` directive and no `X-Frame-Options`. Other sites can embed pages, images and video.

## Content type from the extension

The core map sets `Content-Type` from the extension in the URL. The service ignores the content type that R2 stores. A `.png` object with the stored type `text/html` never renders as HTML. Every response has `X-Content-Type-Options: nosniff`, so the browser does not guess a type.

On `/f/`, an unknown extension gets `application/octet-stream` and `Content-Disposition: attachment`. The browser downloads the file and never renders it.

A PDF never gets the CSP sandbox, because Chrome refuses to show a sandboxed PDF. The browser PDF viewer cannot reach our origin.

## Forward links

A forward id is a UUIDv4. Its 122 random bits make the link unguessable. The link is a bearer secret: any holder can read the file. The link has no expiry while the object exists.

To revoke a link, delete its object. Forward responses carry `Cache-Control: no-store`, so the revocation takes effect at once. `Referrer-Policy: no-referrer` keeps the URL of a served page out of the `Referer` header.

The E2E forward fixture has the fixed UUID `00000000-0000-4000-8000-000000000000` that is in this repository. It is public test content on purpose, not a secret link. Real forward links use a random UUIDv4.

## Path isolation

The asset validator rejects traversal, percent-encoded characters, backslash, dotfiles and empty segments. The fixed key prefixes `a/` and `f/` keep the two modes apart. An asset request cannot read a forward object.

## Errors

Error bodies are the reason phrase only, with `Cache-Control: no-store`. They never contain exception text or storage details.

## Abuse and cost

Zone rules block abusive traffic before the Worker. A per-IP rate limit, a method and path allowlist and a disabled kill switch protect the hostname. Workers Free is the hard cost cap. A flood is an outage until 00:00 UTC, not a bill.

See [Cloudflare architecture](../../cloudflare/docs/explanation/architecture.md#cost-cap) for the cost model and the [incident runbook](../../cloudflare/docs/how-to/incident.md) for the response to a flood.
