# Bug Tracker Lite — Backend

Node.js + Express + TypeScript API backed by MongoDB (Mongoose), with JWT authentication
and **private** S3 storage for bug images.

> For project-wide setup, architecture and deployment, see the [root README](../README.md).
> For decisions and known limitations, see [NOTES.md](../NOTES.md).

## Environment variables

Copy `.env.example` to `.env` and fill in the values. The API reads:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (default `5000`) | HTTP port |
| `FRONTEND_URL` | no (default `http://localhost:5173`) | Single allowed CORS origin |
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Signs/verifies JWTs |
| `JWT_EXPIRES_IN` | no (default `7d`) | Token lifetime |
| `AWS_REGION` | yes | Region of the image bucket |
| `S3_BUCKET_NAME` | yes | Private bucket that stores bug images |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | no | Local development only — the default AWS credential provider chain is used, so in AWS an IAM role is picked up instead |

Never commit real credentials. Credentials and secrets are never logged by the API.

## Scripts

```sh
npm run dev     # tsx watch src/server.ts
npm run build   # tsc
npm run lint    # eslint .
npm test        # vitest run
npm start       # run the compiled server (dist/server.js)
```

## API endpoints

All `/api/bugs/*` and `/api/uploads/*` routes require `Authorization: Bearer <token>`.

| Method | Path | Auth | Success | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | no | `200 { status: "ok" }` | Liveness probe |
| `POST` | `/api/auth/signup` | no | `201 { token, user }` | Rate-limited 5/min/IP |
| `POST` | `/api/auth/login` | no | `200 { token, user }` | Rate-limited 5/min/IP |
| `GET` | `/api/bugs?status=` | yes | `200 { bugs }` | Newest first; optional status filter |
| `POST` | `/api/bugs` | yes | `201 { bug }` | Owner comes from the JWT |
| `GET` | `/api/bugs/:id` | yes | `200 { bug }` | Owner-scoped |
| `PUT` | `/api/bugs/:id` | yes | `200 { bug }` | Partial update; owner-scoped |
| `DELETE` | `/api/bugs/:id` | yes | `200 { success, id }` | Also deletes the attached S3 object |
| `POST` | `/api/uploads/presign` | yes | `200 { upload }` | `{ key, url, contentType, maxSizeBytes, expiresIn }` |
| `POST` | `/api/bugs/:id/image` | yes | `200 { bug }` | Verifies the object in S3 before attaching |
| `GET` | `/api/bugs/:id/image-url` | yes | `200 { image }` | `{ key, url, expiresIn }` — short-lived signed GET |

Error responses use a single shape: `{ error: { code, message, details? } }`. Validation
failures return `400 VALIDATION_ERROR` with per-field `details`.

## Bucket setup

The bucket must stay **private**:

- Keep "Block Public Access" enabled and do not add a public bucket policy.
- Do not set ACLs. The API never sends an `ACL` header; images are only ever reached
  through short-lived (5 minute) presigned URLs.

### IAM permissions and scope

The API's identity needs exactly these actions, scoped to this project's bucket objects:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BugTrackerLiteImageObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<S3_BUCKET_NAME>/uploads/*"
    }
  ]
}
```

Notes:

- Scope the resource to `arn:aws:s3:::<S3_BUCKET_NAME>/uploads/*`, not the whole bucket,
  and never to `*`.
- Keep `S3_BUCKET_NAME` and `AWS_REGION` in step with the bucket the policy targets.
- `s3:PutObject` is required because the presigned `PUT` is signed with the API's
  credentials; the browser never receives AWS keys.
- The attach-time size/type check uses S3 `HeadObject`, which is authorized by
  **`s3:GetObject`** — there is **no** `s3:HeadObject` action, so it must not appear in the
  policy (AWS rejects unknown action names).
- No `s3:ListBucket` is needed — the API addresses objects by key only.
- Do **not** grant `s3:PutBucketPolicy`, `s3:PutBucketAcl` or any public-access action.

> **Verification status:** the IAM policy and bucket-policy above describe what the code
> requires. The **AWS-side IAM role/policy and the production bucket policy have not been
> verified by automated tooling in this repository** and should be confirmed in the AWS
> console before shipping.

### CORS

Browsers upload straight to S3 with a presigned `PUT`, so the bucket needs a CORS rule.
Use only the configured frontend origin and only the headers the upload sends
(`content-type`, which is part of the signature).

**Local development:**

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

**Production:** add the deployed frontend origin (the same value as the backend's
`FRONTEND_URL`) to `AllowedOrigins`. The deployed frontend origin is
`https://d3e658zodlakth.cloudfront.net`. If both local and production should work during a
transition, list both origins explicitly:

```json
[
  {
    "AllowedOrigins": ["https://d3e658zodlakth.cloudfront.net", "http://localhost:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Apply it with:

```sh
aws s3api put-bucket-cors \
  --bucket "$S3_BUCKET_NAME" \
  --cors-configuration file://cors.json
```

> **Verification status:** the production CORS rule has **not** been verified in AWS by
> this repository. `GET` requests are presigned and served by S3 directly, so only `PUT`
> needs to be in `AllowedMethods`; add `GET` only if the frontend ever fetches objects
> without a signed URL.

## Image upload flow

1. `POST /api/uploads/presign` with `{ "contentType": "image/png", "size": 123456 }`
   returns a server-generated, user-scoped `key` and a short-lived presigned `url`.
   Allowed types are `image/jpeg`, `image/png` and `image/webp`; the maximum size is 5 MB.
2. The client `PUT`s the file bytes to `url` with the **same** `Content-Type` header.
3. `POST /api/bugs/:id/image` with `{ "imageKey": "<key>" }` verifies the object's
   real size and content type in S3 before linking it to the bug.
4. `GET /api/bugs/:id/image-url` returns a short-lived presigned `GET` url for the
   attached image.

Because a presigned `PUT` cannot enforce a maximum size, the size and content type are
always re-checked server-side at step 3.

### Key layout and why it matters for cleanup

Object keys are `uploads/<userId>/<uuid>.<ext>`. **Attached and not-yet-attached images
share this same `uploads/` prefix**, which has an important consequence:

> **Do not add a blanket lifecycle expiration rule on the `uploads/` prefix.** Because
> attached and unattached objects are indistinguishable by prefix, an expiry rule would
> eventually delete images that are still referenced by a bug.

## S3 known limitations

These are accepted limitations of the current implementation, not bugs that were missed.
Safer future approaches are noted with each item.

- **Orphaned uploads.** If a client presigns and PUTs a file but never calls the attach
  endpoint (abandoned create/edit, tab closed mid-flow), the object stays in S3 forever.
  No lifecycle rule currently cleans it up.
- **Replacing an image leaves the old object behind.** `POST /api/bugs/:id/image`
  overwrites `bug.imageKey`; the previously attached object is not deleted, so it becomes
  unreferenced.
- **No image-detachment endpoint.** There is deliberately no `DELETE` for a bug's image
  (only attach and read), so an attached image cannot be removed without deleting the bug.

### Safe future cleanup options (do **not** use a blanket `uploads/` expiry)

1. **Dedicated temporary prefix.** Presign into `uploads/tmp/<userId>/<uuid>.<ext>`, then
   move/copy the object to `uploads/<userId>/<uuid>.<ext>` on attach. A lifecycle rule can
   then safely expire only `uploads/tmp/` after a short window.
2. **Object tagging.** Tag objects `state=pending` on upload and `state=attached` on
   attach, then expire only `pending` objects via a tag-based lifecycle rule.
3. **Reconciliation cleanup job.** A scheduled job lists objects older than N hours and
   deletes those whose key is not referenced by any bug's `imageKey` (the authoritative
   check). This also covers the replaced-image case.
4. **Delete-on-replace.** In the attach flow, delete the previous `imageKey` after the new
   key is successfully written (best-effort, logged on failure).

## Testing

```sh
npm test
```

The suite (5 files) mocks Mongoose models and the S3 service, so **no MongoDB instance or
AWS access is required**. See [NOTES.md](../NOTES.md) for the distinction between mocked
checks and manually verified behaviour.
