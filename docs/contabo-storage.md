# Contabo Object Storage

The web app and background worker use the same S3 bucket for uploads, generated
images, thumbnails and media for publishing. Configure these server environment
variables on **both** services, then restart them:

```dotenv
# Example EU endpoint. Use the endpoint from YOUR Contabo S3 connection settings.
S3_ENDPOINT=https://eu2.contabostorage.com
S3_REGION=default
S3_ACCESS_KEY_ID=your-s3-access-key
S3_SECRET_ACCESS_KEY=your-s3-secret-key
S3_BUCKET=your-bucket-name
S3_PUBLIC_BASE_URL=
```

Use S3 credentials, not Contabo management API credentials. The endpoint is the
service URL without a bucket path; the SDK uses path-style bucket addressing.
The signing region is configurable; Contabo documents `default` for S3 tools.
See [Contabo connection settings](https://docs.contabo.com/docs/storage/object-storage/)
and [compatible tools](https://help.contabo.com/en/support/solutions/articles/103000283058-which-tools-are-compatible-with-contabo-s-object-storage-).

For Docker Compose, put the values in the root `.env` (already passed to both
containers). For local `pnpm dev` / `pnpm worker`, use `apps/web/.env` or export
the values in the process environment. Never use `NEXT_PUBLIC_` for storage keys.
An incomplete S3 configuration raises a configuration error instead of silently
storing files on local disk. S3 settings take precedence over legacy R2 settings.

## Private media and browser uploads

Keep the bucket private and leave `S3_PUBLIC_BASE_URL` empty. The app generates
temporary signed PUT URLs for browser uploads and signed GET URLs for reads.
Server-side media processing uses the same S3 credentials. Credentials need
object PUT, GET, HEAD and DELETE access for this bucket.

Browser uploads go directly to Contabo, so configure bucket CORS to allow your
app's exact origin. Save the following as `cors.json`, replacing the example
origin (include `http://localhost:3000` only if you need local uploads):

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.example.com"],
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

With the AWS CLI configured with your Contabo S3 credentials, apply it using your
actual endpoint and bucket:

```sh
aws --endpoint-url https://eu2.contabostorage.com --region default s3api put-bucket-cors --bucket your-bucket-name --cors-configuration file://cors.json
```

If you deliberately serve public media through a public bucket or CDN, set
`S3_PUBLIC_BASE_URL` to the full externally accessible bucket/CDN base URL.
The app appends the encoded object key. Setting this variable does not make
objects public; verify the URL works without credentials before enabling it.

## Verify after configuration

1. Upload an image through the app and confirm the browser PUT succeeds.
2. Confirm the worker processes it and its thumbnail/preview loads.
3. Generate an AI image to exercise server-side uploads.
4. Check a scheduled post with media on a connected social account.

Changing storage configuration does not copy existing media. If you have files
in local storage or another bucket, copy them to Contabo preserving object keys
before switching both services. Automated tests exercise an HTTP S3 stub and
real SDK URL signing; they do not authenticate against your live Contabo bucket.
