# HTTP API

The service has four read-only routes on one origin. The exact paths `/` and `/ip` select the home and IP routes. For other paths, the first path segment selects the mode. The prefixes `/a/` and `/f/` are fixed. A change to a prefix breaks every shared link.

The Worker accepts `GET` and `HEAD` only. It ignores the query string. The query string never reaches storage.

## Routes

### Home: `/`

The Worker returns the text of the repository `README.md`. The build bundles the text into the Worker. The route makes no R2 call.

### IP: `/ip`

The Worker returns the client IP address. On Cloudflare, the value comes from the `CF-Connecting-IP` request header. The address is the IP of the connection: IPv4 for an IPv4 connection, IPv6 for an IPv6 connection. The Worker does not know the IPv4 address of a client that connects over IPv6. To get the IPv4 address, connect over IPv4, for example with `curl -4`. The route makes no R2 call.

The Worker parses `Accept` as a comma-separated list of media ranges. It ignores parameters, such as `q`, and case. If one media range is `application/json`, the body is `{"ip":"<ip>"}`. Otherwise, the body is the IP address as plain text, with no trailing newline. `*/*` alone gives plain text.

If the runtime supplies no client IP, the Worker returns `500`. Cloudflare always sends `CF-Connecting-IP`, so a missing value is a server fault, not a client fault.

The path must be exactly `/ip`. `/ip/` returns `404`.

### Asset: `/a/<path>`

The Worker reads the R2 object `a/<path>`. The fixed prefix `a/` makes sure that an asset request cannot read a forward object.

The path after `/a/` must pass these rules. A failure returns `400`.

- It has 1 to 8 segments, separated by `/`.
- It has at most 1000 bytes in UTF-8.
- Each segment matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`.

The segment rule rejects `..`, dotfiles, empty segments, `%`, backslash and control characters. The URL parser removes dot segments before validation, so `/a/../x.html` becomes `/x.html` and returns `404`.

The last segment must end in a mapped extension (see [Content types](#content-types)). An unknown or absent extension returns `404` before the Worker reads storage. The extension comes from the last segment only. It matches without case. The key keeps its case.

### Forward: `/f/<uuid>/<basename>`

The Worker reads the R2 object `f/<uuid>/<basename>`. The URL carries the full key, so the service needs no id lookup.

The path after `/f/` must pass these rules. A failure returns `400`.

- It has exactly two segments.
- The first segment is a lowercase canonical UUIDv4: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. An uppercase UUID returns `400`.
- The basename matches the asset segment rule. It has no length limit of its own. A key that R2 does not hold returns `404`.

A delete of the object revokes the link at once, because forward responses carry `Cache-Control: no-store`.

## Status codes

The Worker checks the conditions in this order. The first condition that applies selects the status.

| Order | Condition | Status | Extra headers |
| --- | --- | --- | --- |
| 1 | Method other than `GET` or `HEAD`, on any path. `OPTIONS` is included. | `405` | `Allow: GET, HEAD` |
| 2 | Path is `/`. | `200` | See [Home](#home-and-ip). |
| 2 | Path is `/ip` and the runtime supplies a client IP. | `200` | See [IP](#home-and-ip). |
| 2 | Path is `/ip` and the runtime supplies no client IP. | `500` | |
| 2 | Path is not `/` or `/ip`, and does not start with `/a/` or `/f/`. This includes `/a`, `/f`. | `404` | |
| 2 | Path other than `/` ends with `/`. This includes `/ip/`, `/a/`, `/f/` and `/f/<uuid>/`. | `404` | |
| 3 | Asset path or forward path fails validation. | `400` | |
| 4 | Asset path has an unknown or absent extension. | `404` | |
| 5 | R2 has no object for the key. | `404` | |
| 6 | Valid `Range` with a start at or past the object size. | `416` | `Content-Range: bytes */<size>` |
| 7 | `If-None-Match` matches the ETag. | `304` | See [Headers](#headers). |
| 8 | Valid `Range` inside the object. | `206` | `Content-Range: bytes <first>-<last>/<size>` |
| 8 | All other requests for an object that exists. | `200` | |
| any | R2 throws an error (`StorageUnavailable`). | `503` | |
| any | Any other exception. | `500` | |

`HEAD` returns the same status and headers as `GET`, with no body. This includes error responses.

In production, zone rules run before the Worker. They block a method other than `GET` or `HEAD` with `403`. They also block a path that is not `/` or `/ip` and is outside `/a/` and `/f/`. These requests never reach the Worker. See [Cloudflare configuration](../../cloudflare/docs/reference/configuration.md#zone-rules).

## Range

The Worker reads `Range` on `GET` only. It accepts one range in one of these forms:

| Form | Meaning |
| --- | --- |
| `bytes=a-b` | Bytes `a` to `b`, inclusive. `b` must be equal to or greater than `a`. |
| `bytes=a-` | Bytes from `a` to the end. |
| `bytes=-n` | The last `n` bytes. `n` must be greater than `0`. |

The unit `bytes` matches without case. The Worker trims white space around the value. R2 clamps the end of the range to the object size.

The Worker ignores the header and serves the full object with `200` in these cases:

- The header has more than one range, or it does not match a form above.
- A number is not a safe integer.
- The value is `bytes=-0`.
- The request has an `If-Range` header, with any value.
- The method is `HEAD`.

A resumed download that sends `If-Range` therefore gets the full object again.

## Conditional requests

The Worker compares `If-None-Match` with the object ETag by weak comparison. It removes `W/` from both sides. It accepts a comma-separated list and `*`. On a match, it cancels the R2 body and returns `304`. The ETag is the R2 `httpEtag` value.

Cloudflare removes `ETag` and `Content-Length` from every `200` response with `text/html` on this zone. The body bytes do not change. An HTML response therefore has no `ETag` at the client, and HTML gets no `304`.

The order in [Status codes](#status-codes) applies. A request with a range past the end returns `416`, also when its `If-None-Match` matches.

## Headers

### Every response

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

### Home and IP

| Header | Home `200` | IP `200` |
| --- | --- | --- |
| `Content-Type` | `text/plain; charset=utf-8` | `application/json; charset=utf-8` for a JSON `Accept`, else `text/plain; charset=utf-8` |
| `Content-Length` | Body size in bytes. | Body size in bytes. |
| `Cache-Control` | `public, max-age=300` | `no-store` |
| `Vary` | | `Accept` |

These responses have no `ETag`, no `Accept-Ranges` and no CORS header. The Worker ignores `Range` and `If-None-Match` on these routes.

### Asset `200` and `206`

| Header | Value |
| --- | --- |
| `Content-Type` | From the [content type map](#content-types). |
| `Content-Length` | Object size, or range length on `206`. |
| `Accept-Ranges` | `bytes` |
| `ETag` | R2 `httpEtag`. |
| `Cache-Control` | `public, max-age=300` |
| `Access-Control-Allow-Origin` | `*` (no credentials) |
| `Content-Range` | `206` only: `bytes <first>-<last>/<size>`. |
| `Content-Security-Policy` | HTML and SVG only: `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads`. |

### Asset `304`

`ETag`, `Cache-Control: public, max-age=300` and `Access-Control-Allow-Origin: *`. The `304` has no `Content-Security-Policy`.

### Forward `200` and `206`

| Header | Value |
| --- | --- |
| `Content-Type` | From the [content type map](#content-types). An unknown or absent extension gives `application/octet-stream`. |
| `Content-Disposition` | Mapped extension: `inline; filename*=UTF-8''<basename>`. Other basenames: `attachment; filename*=UTF-8''<basename>`. |
| `Content-Length` | Object size, or range length on `206`. |
| `Accept-Ranges` | `bytes` |
| `ETag` | R2 `httpEtag`. |
| `Cache-Control` | `no-store` |
| `Content-Range` | `206` only: `bytes <first>-<last>/<size>`. |
| `Content-Security-Policy` | HTML and SVG only: the same sandbox value as asset mode. A PDF never gets it. |

Forward responses have no `Access-Control-Allow-Origin`. The basename is percent-encoded in `Content-Disposition`. The segment rule allows only unreserved characters, so the encoded value is equal to the basename.

### Forward `304`

`ETag` and `Cache-Control: no-store`, with no CORS header.

### Errors

Every `400`, `404`, `405`, `416`, `500` and `503` has these headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `text/plain; charset=utf-8` |
| `Cache-Control` | `no-store` |

The body is the reason phrase only, for example `Not Found`. It never contains exception text. A `416` has no CORS header.

## Content types

The core map sets `Content-Type` from the extension. The service ignores the content type that R2 stores on the object.

| Extensions | Content-Type |
| --- | --- |
| `html`, `htm` | `text/html; charset=utf-8` |
| `css` | `text/css; charset=utf-8` |
| `js`, `mjs` | `text/javascript; charset=utf-8` |
| `json` | `application/json; charset=utf-8` |
| `txt` | `text/plain; charset=utf-8` |
| `svg` | `image/svg+xml; charset=utf-8` |
| `png` | `image/png` |
| `jpg`, `jpeg` | `image/jpeg` |
| `gif` | `image/gif` |
| `webp` | `image/webp` |
| `avif` | `image/avif` |
| `ico` | `image/x-icon` |
| `pdf` | `application/pdf` |
| `woff2` | `font/woff2` |
| `mp4` | `video/mp4` |
| `webm` | `video/webm` |
| `mov` | `video/quicktime` |
| `mp3` | `audio/mpeg` |
| `m4a` | `audio/mp4` |
| `wav` | `audio/wav` |

Every mapped type on `/f/` is `inline`. This includes HTML, SVG, CSS, JS, JSON, TXT and WOFF2.
