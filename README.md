# Bug Tracker Lite

A small, production-minded bug tracking application built as a full-stack assignment for
**Elovient Software Solutions**. Users register, sign in, and manage their own bug reports
(title, description, severity, status) with an optional screenshot attached. Every record
is private to its owner, and images are stored in a **private** S3 bucket and reached only
through short-lived presigned URLs.

> **Deployed on AWS.** Frontend <https://d3e658zodlakth.cloudfront.net/> · API base URL
> <https://d3vwiql1m4fnip.cloudfront.net> · health check
> <https://d3vwiql1m4fnip.cloudfront.net/health>.

> Honest status: the code is complete, verified by build, lint and a mocked test suite,
> exercised manually end-to-end in the browser, and deployed to AWS. The automated suite
> mocks MongoDB and S3 and does **not** prove live behaviour — see
> [NOTES.md](NOTES.md) for the exact mocked-versus-verified split.

**Documentation:** [NOTES.md](NOTES.md) — decisions, trade-offs, limitations and
verification status · [Task 2 — plant production monitoring proposal](docs/task-2-monitoring-proposal.md) ·
[Task 3 — paint-manufacturer ERP architecture](docs/task-3-erp-architecture.md).

---

## Features

- **Authentication** — register, log in, log out. Passwords are bcrypt-hashed; sessions use
  JWTs returned in the response body and stored in `localStorage`.
- **Protected UI and API** — signed-out users are redirected to `/login`; every bug and
  upload route requires a valid Bearer token.
- **Bug CRUD** — create, read, update and delete bug reports, strictly scoped to the owner.
- **Dashboard** — the caller's bugs, newest first, with status filters (All / Open /
  In Progress / Closed).
- **Optional image attachment** — on both create and edit, with client-side type/size
  validation, a preview, and remove/replace before saving.
- **Direct-to-S3 uploads** — the browser uploads the raw file straight to S3 using a
  presigned `PUT`; image bytes never pass through Express.
- **Server-side image verification** — the API re-checks the object's real size, declared
  content type, and magic bytes before attaching it, so a client cannot spoof a file.
- **Safe failure handling** — partial failures (bug created but image upload failed) are
  reported per stage, with a retry path that never creates a duplicate bug.

---

## Architecture and technology stack

```
┌───────────────────────────┐        HTTPS / JSON         ┌───────────────────────────┐
│        Frontend           │  ───────────────────────▶   │         Backend           │
│  React + TypeScript (SPA) │  ◀───────────────────────   │  Express + TypeScript API │
│  Vite dev server / static │   Bearer <JWT>              │  Zod validation, JWT auth │
└──────────┬────────────────┘                             └───────┬───────────┬───────┘
           │                                                      │           │
           │  PUT raw file bytes (presigned URL, no API creds)    │           │ Mongoose
           │                                                      │           ▼
           │                                             ┌────────┴────────┐ ┌──────────────┐
           └────────────────────────────────────────────▶│  Private S3     │ │  MongoDB     │
                                                          │  (bug images)   │ │  Atlas/local │
                                                          └─────────────────┘ └──────────────┘
```

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router 7, plain CSS (no UI framework) |
| Backend | Node.js, Express 5, TypeScript, Zod 4 |
| Database | MongoDB via Mongoose 9 (Atlas in the cloud, or a local instance) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` password hashing |
| Storage | AWS S3 (private bucket) via AWS SDK v3 + `@aws-sdk/s3-request-presigner` |
| Hardening | `helmet`, `cors`, `express-rate-limit`, `file-type` magic-byte sniffing |
| Testing | Vitest + Supertest (mocked Mongoose and S3) |
| Lint | ESLint 10 flat config with `typescript-eslint` |

---

## Repository structure

```
bug-tracker-lite/
├── README.md                  # this file
├── NOTES.md                   # decisions, trade-offs, limitations, verification status
├── docs/
│   ├── task-2-monitoring-proposal.md   # Task 2: plant production monitoring proposal
│   └── task-3-erp-architecture.md      # Task 3: paint-manufacturer ERP architecture
├── backend/
│   ├── src/
│   │   ├── config/            # env accessors, MongoDB connection, S3 client
│   │   ├── controllers/       # auth, bug, upload request handlers
│   │   ├── middleware/        # requireAuth, centralized error handler
│   │   ├── models/            # Mongoose User and Bug schemas
│   │   ├── routes/            # /api/auth, /api/bugs, /api/uploads
│   │   ├── schemas/           # Zod request schemas
│   │   ├── services/          # s3.service (presign, head, ranged read, delete)
│   │   ├── utils/             # http helpers, image key/sniffing helpers
│   │   ├── app.ts             # Express app wiring
│   │   └── server.ts          # startup (dotenv, DB connect, listen)
│   ├── tests/                 # Vitest + Supertest suites
│   ├── .env.example
│   └── README.md              # backend-specific docs (IAM, CORS, S3 limitations)
└── frontend/
    ├── src/
    │   ├── api/               # typed API client (auth, bugs, uploads, client, types)
    │   ├── auth/              # AuthProvider/context, session storage, RequireAuth
    │   ├── components/        # layout, badges, alerts, modal, spinner, ImagePicker
    │   ├── lib/               # display formatting helpers
    │   └── pages/             # login, register, dashboard, create/edit/detail
    ├── .env.example
    └── README.md
```

---

## Prerequisites

- **Node.js 22+** and npm (the backend pins `engines` to `>=22 <23`, matching the Elastic
  Beanstalk Node.js 22 platform; the project uses ESM and modern TypeScript).
- A **MongoDB** database — either MongoDB Atlas (cloud) or a local `mongod`.
- An **AWS account** with an S3 bucket in a chosen region, and credentials that can
  read/write objects under the bucket's `uploads/` prefix (see [S3](#s3-image-storage)).

---

## Database configuration (MongoDB)

The backend reads the connection string from `MONGODB_URI`.

### Option A — MongoDB Atlas (cloud)

1. Create a free cluster in the [Atlas UI](https://cloud.mongodb.com/).
2. Create a database user (username + password).
3. Under **Network Access**, allow your current IP (or a range) so your machine can connect.
4. Copy the connection string and set it as `MONGODB_URI`, substituting your user,
   password and cluster host. Always URL-encode special characters in the password.

   ```
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/bug-tracker-lite?retryWrites=true&w=majority
   ```

### Option B — local MongoDB

Run a local server (`mongod`), then point at it:

```
MONGODB_URI=mongodb://127.0.0.1:27017/bug-tracker-lite
```

The database and its collections are created automatically on first write.

---

## Environment variables

Only **safe placeholders** are listed here. Never commit real values; both `.env` files
are git-ignored.

### Backend — `backend/.env` (copy from `backend/.env.example`)

| Variable | Required | Example / placeholder | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `5000` | HTTP port |
| `FRONTEND_URL` | no | `http://localhost:5173` | The single origin allowed by CORS |
| `MONGODB_URI` | yes | `mongodb://127.0.0.1:27017/bug-tracker-lite` | Database connection string |
| `JWT_SECRET` | yes | `replace-with-a-long-random-secret` | Signs/verifies JWTs |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime (`jsonwebtoken` duration) |
| `AWS_REGION` | yes | `ap-south-1` | Region of the image bucket |
| `S3_BUCKET_NAME` | yes | `your-private-bug-images-bucket` | Private bucket name |
| `AWS_ACCESS_KEY_ID` | no | _(unset)_ | Local dev only; prefer the AWS credential chain / IAM role |
| `AWS_SECRET_ACCESS_KEY` | no | _(unset)_ | Local dev only; prefer the AWS credential chain / IAM role |

Generate a strong secret with `openssl rand -hex 32`.

### Frontend — `frontend/.env` (copy from `frontend/.env.example`)

| Variable | Required | Example / placeholder | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | yes (production) | `https://d3vwiql1m4fnip.cloudfront.net` | Base URL of the backend API |

Vite only exposes variables prefixed with `VITE_` to the browser, so **never** put secrets
in the frontend `.env`. Vite inlines the value **at build time**, so set it *before* running
`npm run build`. In development (`npm run dev`) the app falls back to
`http://localhost:5000` when `VITE_API_URL` is unset; a production build **requires** it and
throws a clear error at startup without it.

---

## Running locally

Open two terminals.

**1. Backend**

```sh
cd backend
npm install
cp .env.example .env       # then fill in MONGODB_URI, JWT_SECRET, AWS_REGION, S3_BUCKET_NAME
npm run dev                # http://localhost:5000
```

Verify it is up: `GET http://localhost:5000/health` → `{ "status": "ok" }`.

**2. Frontend**

```sh
cd frontend
npm install
cp .env.example .env       # VITE_API_URL=http://localhost:5000
npm run dev                # http://localhost:5173
```

Then open `http://localhost:5173`, register an account and start creating bugs.

### Frontend routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/login`, `/register` | public | Sign in / sign up |
| `/dashboard` | protected | Bug list + status filters |
| `/bugs/new` | protected | Create a bug (optional image) |
| `/bugs/:id` | protected | Bug detail, image, edit/delete |
| `/bugs/:id/edit` | protected | Edit a bug (optional image replacement) |

---

## API endpoint summary

Base URL (local): `http://localhost:5000`. Deployed base URL:
`https://d3vwiql1m4fnip.cloudfront.net`. All `/api/bugs/*` and `/api/uploads/*` routes require
`Authorization: Bearer <token>`. Errors share the shape `{ error: { code, message, details? } }`.

| Method | Path | Auth | Success response |
| --- | --- | --- | --- |
| `GET` | `/health` | no | `200 { status: "ok" }` |
| `POST` | `/api/auth/signup` | no | `201 { token, user }` |
| `POST` | `/api/auth/login` | no | `200 { token, user }` |
| `GET` | `/api/bugs?status=open\|in-progress\|closed` | yes | `200 { bugs: Bug[] }` |
| `POST` | `/api/bugs` | yes | `201 { bug }` |
| `GET` | `/api/bugs/:id` | yes | `200 { bug }` |
| `PUT` | `/api/bugs/:id` | yes | `200 { bug }` |
| `DELETE` | `/api/bugs/:id` | yes | `200 { success: true, id }` |
| `POST` | `/api/uploads/presign` | yes | `200 { upload: { key, url, contentType, maxSizeBytes, expiresIn } }` |
| `POST` | `/api/bugs/:id/image` | yes | `200 { bug }` |
| `GET` | `/api/bugs/:id/image-url` | yes | `200 { image: { key, url, expiresIn } }` |

A `Bug` looks like:

```json
{
  "id": "<objectId>",
  "userId": "<objectId>",
  "title": "Login button does nothing",
  "description": "Steps to reproduce…",
  "severity": "low | med | high",
  "status": "open | in-progress | closed",
  "imageKey": "uploads/<userId>/<uuid>.png | null",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## S3 image storage

Images live in a **private** bucket. The API never exposes AWS credentials to the browser
and never returns a permanent URL.

### Upload flow

1. The browser validates the file (type + size) and calls `POST /api/uploads/presign`.
2. The API generates a **server-side, user-scoped key** `uploads/<userId>/<uuid>.<ext>` and
   returns a short-lived presigned `PUT` URL (300s) plus the exact `Content-Type` to send.
3. The browser `PUT`s the **raw file bytes** directly to S3 with that `Content-Type`.
4. The browser calls `POST /api/bugs/:id/image` with the returned `key`.
5. The API verifies the object (size, declared type, magic bytes) and only then stores the
   `imageKey` on the bug.
6. To display it, the browser calls `GET /api/bugs/:id/image-url` and receives a presigned
   `GET` URL (300s), re-fetched each time rather than cached.

Only the object **key** is persisted in MongoDB — never a URL.

### Private-bucket design

- Public access is blocked; no ACLs and no public bucket policy are used.
- Objects are reachable only through the short-lived presigned `GET` URLs the API signs
  **after** checking that the caller owns the bug.
- Signed URLs expire after 300 seconds.

### IAM requirements

The API's identity needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on
`arn:aws:s3:::<S3_BUCKET_NAME>/uploads/*` only — never on the whole bucket and never on `*`.
The attach-time `HeadObject` check is authorized by `s3:GetObject` (there is no
`s3:HeadObject` action). Full policy JSON and rationale are in
[backend/README.md](backend/README.md#iam-permissions-and-scope).

### CORS configuration

Because the browser `PUT`s directly to S3, the bucket needs a CORS rule allowing `PUT`
from the frontend origin with the `content-type` header. Local and production examples are
in [backend/README.md](backend/README.md#cors).

> **Not verified:** the production AWS-side IAM policy and production bucket CORS rule have
> **not** been confirmed by automated tooling in this repository. Verify them in the AWS
> console before shipping.

---

## Security measures and file validation

- **Password hashing** — bcrypt with 10 salt rounds; the hash is never returned by the API.
- **JWT** — signed with `JWT_SECRET`, with an expiry; the subject must be a 24-hex ObjectId
  before it is trusted. Missing, malformed, wrongly-signed or expired tokens get `401`.
- **Ownership** — every bug query is scoped to the authenticated `userId`, so another
  user's record is indistinguishable from a missing one (`404`). `imageKey` ownership is
  re-checked before signing or deleting.
- **No mass assignment** — Zod `strictObject` schemas reject unknown keys, so `userId` and
  `imageKey` cannot be supplied by the client; `imageKey` is set only by the attach endpoint.
- **Rate limiting** — a global limiter (100 req/min/IP) plus a stricter auth limiter
  (5 req/min/IP) on signup and login.
- **File validation (defence in depth)** —
  1. the client checks type and a 5 MB maximum for fast feedback;
  2. the API re-checks the stored object's size via S3 `HeadObject`;
  3. the API reads the first bytes (`Range`) and sniffs the **magic number** with
     `file-type`, rejecting declared/actual mismatches.
  Allowed types are JPG/JPEG, PNG and WebP. Rejected uploads are cleaned up best-effort.
- **Transport/headers** — `helmet` sets security headers and `x-powered-by` is disabled;
  CORS is restricted to a single configured origin; JSON bodies are capped at 100 KB.

---

## Build, lint and test

Run these from the relevant package directory.

### Backend

```sh
cd backend
npm run build    # tsc
npm run lint     # eslint .
npm test         # vitest run
```

Latest known results:

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | exit 0 — **85 tests passed across 5 files** |

Test files: `auth.test.ts` (17), `bug.test.ts` (31), `bug-image.test.ts` (23),
`upload.test.ts` (13), `health.test.ts` (1). Mongoose models and the S3 service are mocked,
so no live database or AWS access is required.

### Frontend

```sh
cd frontend
npm run build    # tsc -b && vite build
npm run lint     # eslint .
```

Latest known results: `build` exit 0 (48 modules); `lint` exit 0.

---

## Deployment

The application is deployed on AWS in the **`ap-south-1`** region.

| Environment | URL |
| --- | --- |
| Frontend (React SPA) | <https://d3e658zodlakth.cloudfront.net/> |
| Backend API base URL | <https://d3vwiql1m4fnip.cloudfront.net> |
| API health check | <https://d3vwiql1m4fnip.cloudfront.net/health> |
| Original Elastic Beanstalk endpoint (HTTP) | `http://bug-tracker-lite-env.eba-hww8d3nk.ap-south-1.elasticbeanstalk.com` |

> The **frontend URL** and the **API base URL** are two *different* CloudFront
> distributions. The SPA is served from the first; it calls the API at the second. Do not
> use the frontend origin as the API URL or vice versa.

### Deployed architecture

```
        Browser
           │  HTTPS
           ▼
 ┌──────────────────────┐        ┌──────────────────────┐
 │ CloudFront (frontend)│───────▶│ S3: static React build│
 └──────────┬───────────┘        └──────────────────────┘
            │  HTTPS + Bearer JWT (JSON)
            ▼
 ┌──────────────────────┐        ┌──────────────────────┐
 │ CloudFront (API)     │───────▶│ Elastic Beanstalk     │
 └──────────────────────┘  HTTPS │ Express API · Node 22 │
                                 └───────┬───────┬───────┘
                                         │       │
                               Mongoose  │       │ AWS SDK v3
                                         ▼       ▼
                              ┌──────────────┐ ┌────────────────────┐
                              │ MongoDB Atlas│ │ S3 (private bucket)│
                              └──────────────┘ │ presigned URLs only│
                                               └────────────────────┘
```

- **Frontend** — the Vite production build (`frontend/dist`) is uploaded to an S3 bucket and
  served through a **CloudFront** distribution (`d3e658zodlakth.cloudfront.net`), which
  provides HTTPS and the SPA fallback.
- **Backend** — the Express API runs on **AWS Elastic Beanstalk** (Node.js 22 platform)
  from the packaged `dist/` build, started by the `Procfile` (`web: node dist/server.js`).
- **HTTPS for the API** — a second **CloudFront** distribution
  (`d3vwiql1m4fnip.cloudfront.net`) sits in front of the Elastic Beanstalk environment and
  exposes the API over **HTTPS**.
- **Database** — **MongoDB Atlas** (Atlas in the cloud; a local `mongod` works for
  development).
- **Images** — a **private S3 bucket**. The browser uploads with short-lived presigned `PUT`
  URLs and reads through short-lived presigned `GET` URLs; no object is ever public and no
  AWS credentials reach the browser.

### Why the API is exposed through CloudFront

The assignment requires an HTTPS-reachable API. Direct **HTTPS** access to the original
Elastic Beanstalk hostname
(`bug-tracker-lite-env.eba-hww8d3nk.ap-south-1.elasticbeanstalk.com`) **timed out** during
testing — the environment's load balancer did not terminate TLS on the default endpoint.
Rather than change the environment's networking, a **CloudFront distribution was placed in
front of the environment**: CloudFront presents an HTTPS certificate to clients and forwards
requests to the EB origin. The trade-offs (TLS terminates at CloudFront rather than at the
origin, an extra hop, two distributions to manage) are recorded in
[NOTES.md](NOTES.md#9-deployment-and-the-cloudfront-https-workaround).

### Backend deployment (Elastic Beanstalk)

1. `cd backend && npm ci && npm run build`. A prebuilt `dist/` is shipped because the EB
   platform runs no build step and `typescript` is a dev dependency.
2. Package `dist/`, `package.json`, `package-lock.json` and `Procfile` (see
   `backend/.ebignore`); `backend/bug-tracker-backend.zip` is a ready-to-upload bundle with
   forward-slash entries.
3. Set the environment properties in the EB console: `MONGODB_URI`, `JWT_SECRET`,
   `JWT_EXPIRES_IN`, `AWS_REGION`, `S3_BUCKET_NAME` and `FRONTEND_URL` (the deployed
   frontend origin). In AWS the SDK uses the EC2 instance role, so no long-lived keys are
   set.
4. Deploy, then confirm `GET https://d3vwiql1m4fnip.cloudfront.net/health` returns
   `{ "status": "ok" }`.

### Frontend deployment (S3 + CloudFront)

1. Build with the deployed API URL inlined (Vite inlines it at build time):

   ```powershell
   cd frontend
   $env:VITE_API_URL = "https://d3vwiql1m4fnip.cloudfront.net"
   npm run build
   ```

2. Upload the contents of `frontend/dist/` to the S3 bucket behind the frontend CloudFront
   distribution.
3. Configure the SPA fallback so unknown paths serve `index.html` (React Router uses the
   History API).

### Post-deploy checklist

- [x] The backend is reachable over HTTPS through CloudFront; `/health` returns
      `{"status":"ok"}`.
- [x] The frontend production build points at the CloudFront API URL
      (`d3vwiql1m4fnip.cloudfront.net`).
- [x] The bucket stays private (Block Public Access on; no public policy; no ACLs).
- [ ] The IAM policy attached to the EB instance role matches the documented scope
      (`<bucket>/uploads/*`) — **not verified** by automated tooling; confirm in the AWS
      console.
- [ ] The S3 bucket CORS `AllowedOrigins` includes the deployed frontend origin —
      **not verified** by automated tooling; confirm in the AWS console.
- [ ] Re-test the live S3 upload flow (presign → `PUT` → attach) against the deployed
      origins.

---

## Known limitations

- **Orphaned uploads** — a presigned file that is never attached stays in S3. Do **not** fix
  this with a blanket lifecycle rule on `uploads/`, because attached and unattached images
  share that prefix; use a temporary prefix, object tagging, or a reconciliation job.
- **Replacing an image** leaves the previous object in the bucket.
- **No image-detachment endpoint** — an attached image can only be replaced or removed by
  deleting the bug.
- **Delete ordering** — bug deletion removes the S3 object before the database record, so a
  later database failure can leave a bug without its image.
- **In-memory rate limiting** — per-instance, so limits are not shared across scaled-out EB
  instances.
- **Unbounded bug-list pagination** — `GET /api/bugs` returns every bug owned by the caller
  with no limit/offset; fine at assignment scale, but it should be paginated as data grows.
- **AWS-side configuration is not automatically verified** — the exact IAM policy attached to
  the Elastic Beanstalk instance role and the production bucket CORS rule were not checked by
  tooling; confirm them in the AWS console.
- **No live integration test in CI** — the automated suite is fully mocked; the live
  S3/database paths were exercised **manually** (browser end-to-end and a deployment smoke
  test), not by automated tests.

Details and reasoning are in [NOTES.md](NOTES.md).

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| App shows **"VITE_API_URL is not set"** | Create `frontend/.env` from `.env.example` and restart the dev server. |
| **CORS error** calling the API | Set the backend `FRONTEND_URL` to the exact frontend origin (scheme + host + port). |
| **CORS error** during the S3 `PUT` | Add the frontend origin to the bucket CORS `AllowedOrigins` and allow the `content-type` header. |
| `401 UNAUTHORIZED` after a while | The JWT expired (`JWT_EXPIRES_IN`). Log in again. |
| `502 S3_ERROR` on presign/attach/delete | AWS credentials, region, bucket name, or IAM permissions are wrong/missing. |
| `400 IMAGE_TOO_LARGE` / `UNSUPPORTED_IMAGE_TYPE` / `INVALID_IMAGE_CONTENT` | The file exceeds 5 MB, is not JPG/PNG/WebP, or its bytes do not match its declared type. |
| Attach fails right after `PUT` | The upload `Content-Type` must exactly match what the presign response returned. |
| `Failed to connect to MongoDB` | Check `MONGODB_URI`, that the DB user exists, and that your IP is allowed in Atlas. |
| Bugs list is empty | Bugs are owner-scoped — create one while signed in as that user. |
