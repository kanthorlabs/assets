# Upload contract

Uploads run in a separate private workspace. This service only reads. The [cost cap](../../cloudflare/docs/explanation/architecture.md#cost-cap) holds only while the upload flow obeys every rule on this page.

## Credentials

- No long-lived R2 S3 tokens for people or agents.
- Use a short-lived credential for each upload session. Revoke it after the upload.
- The deploy token and the CI token have no R2 permission. Do not use them to upload.

## Storage limits

- Total R2 storage on the account is at most 100 GB.
- R2 writes (Class A operations) stay under 1 M per month.
- The account has one R2 bucket: `ASSETS_R2_BUCKET`. The account preflight rejects other buckets.

## Storage class and lifecycle

- Use the Standard storage class only. The bucket default storage class is Standard.
- No lifecycle rule moves objects to Infrequent Access.
- A lifecycle rule deletes incomplete multipart uploads after 1 day.

## Object keys

| Mode | Key | Rules |
| --- | --- | --- |
| Asset | `a/<path>` | `<path>` passes the asset validator: 1 to 8 segments, at most 1000 bytes, each segment matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`. The last segment ends in a mapped extension. |
| Forward | `f/<uuid>/<basename>` | `<uuid>` is a lowercase canonical UUIDv4. `<basename>` matches the segment rule. |

The [HTTP API](api.md) holds the full validation rules and the list of mapped extensions. The service cannot serve an object with a key that breaks these rules.

To make a forward id, generate a random UUIDv4 and convert it to lowercase:

```sh
uuidgen | tr A-Z a-z
```

Check that the third group starts with `4`.

## Content type

The service does not use the `Content-Type` stored on the object. The extension in the key sets the response type.

## Delete and revoke

- To revoke a forward link, delete its object. The link returns `404` at once.
- After the delete of an asset, browsers can keep a copy for up to 300 seconds (`max-age=300`).
- Do not delete the E2E fixture objects. The [E2E fixtures](../../cloudflare/e2e-fixtures/README.md) page lists their keys.
