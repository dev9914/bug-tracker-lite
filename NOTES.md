# Notes — Bug Tracker Lite

Engineering notes for the Elovient Software Solutions assignment: key decisions,
trade-offs, production priorities, scaling, limitations, and an honest statement of what
has actually been verified.

---

## 1. Important technical decisions and trade-offs

**Separation of concerns, thin controllers.** Controllers stay thin and delegate to models,
Zod schemas and the S3 service. Errors are passed to one centralized Express error
middleware via `next(err)`, so every failure returns the same
`{ error: { code, message, details? } }` shape. Trade-off: a little more indirection, but
consistent responses and one place to change error handling.

**Zod `strictObject` at the boundary.** Request bodies are parsed with strict schemas that
reject unknown keys. This is deliberate: it makes **mass assignment impossible**, so a
client can never inject `userId` or set `imageKey` directly. Trade-off: adding a field means
updating the schema, but the safety is worth it.

**Ownership enforced in the query, not after the fetch.** Every bug lookup includes
`userId` in the filter. A record owned by someone else simply does not match, so it returns
`404` exactly like a missing record — no separate "you're not allowed" branch that could
leak existence. The same ownership check is repeated at each S3 interaction (signing a GET,
attaching, deleting) rather than trusting the earlier check.

**JWT subject is validated, not just decoded.** `requireAuth` verifies the signature with
`JWT_SECRET` and confirms that `sub` is a 24-hex ObjectId before it is used in a database
query, so a validly-signed but malformed subject cannot reach Mongoose.

**Plain CSS over a UI framework.** The frontend ships a single hand-written `index.css`
(tokens + component classes). Trade-off: slightly more manual styling, but no bundle bloat,
no framework lock-in, and a fast build.

**Frontend, not backend, generates the object key?** No — the **server** generates the key
(`buildImageKey`) so it can guarantee the `uploads/<userId>/` scope and a random UUID. The
client only echoes the key back when attaching; the API re-verifies it is owned before use.

**Direct-to-S3 uploads.** The browser uploads the raw file straight to S3 with a presigned
`PUT`. Trade-off: a presigned URL cannot enforce a maximum size, so the server must
re-verify the object afterwards (see §3).

---

## 2. Why MongoDB?

- **Document model fits the data.** A bug is a self-contained document (title, description,
  severity, status, `imageKey`, timestamps) with no complex relational graph — a natural
  fit for documents, avoiding joins for the common read path.
- **Fast iteration.** Schema evolution is cheap early on; adding fields does not require a
  migration.
- **Managed hosting.** MongoDB Atlas provides a free tier with automated backups, monitoring
  and TLS, so the assignment does not need to run its own database.
- **Native Node driver story.** Mongoose gives schema validation, casting and compound
  indexes while keeping the code idiomatic TypeScript.

The trade-off is the absence of multi-document ACID transactions by default, which matters
for the delete flow (see §6). At this scale that is acceptable; a relational database would
be the better choice if the domain grew genuinely relational (e.g. the ERP scenario in
Task 3).

---

## 3. Why presigned S3 URLs instead of sending image bytes through Express?

- **The API never handles large binary payloads.** Image bytes go browser → S3 directly, so
  Node is not blocked on multi-megabyte uploads and the JSON body limit can stay tiny
  (100 KB).
- **Cost and scalability.** Bandwidth and memory stay flat as uploads grow; the API only
  signs URLs and verifies metadata.
- **Security is preserved.** The bucket is **private**; the API mints short-lived (300 s)
  presigned URLs signed with its own credentials. The browser never receives AWS keys. Keys
  are server-generated and user-scoped, and attaching requires an authorized `POST`.
- **The trade-off, stated honestly.** A presigned `PUT` cannot enforce size or content type
  by itself, and it bypasses the API. That is why the attach endpoint **always** re-checks
  the stored object: `HeadObject` for the real size and declared type, then a ranged read of
  the first bytes sniffed with `file-type` to confirm the magic number matches the declared
  type. Anything that fails is rejected and cleaned up best-effort.
- **No permanent URL is ever stored.** MongoDB keeps only the object key; a fresh signed
  `GET` URL is minted on demand, so nothing breaks when a URL expires.

---

## 4. Authentication, ownership, rate limiting, validation, error handling

- **Authentication.** Passwords are hashed with `bcryptjs` (10 rounds) and never returned.
  Login issues a JWT signed with `JWT_SECRET` and an expiry (`JWT_EXPIRES_IN`, default
  `7d`). The frontend stores it in `localStorage` and sends it as a Bearer token; a `401`
  triggers a clean logout.
- **Ownership checks.** Every bug query is scoped to the authenticated `userId`, so users can
  only list, read, update and delete their own bugs. `imageKey` ownership is re-validated
  before signing a `GET` URL, attaching, or deleting the object. Cross-user access returns
  `404`.
- **Rate limiting.** A global limiter (100 req/min/IP) protects all routes; a stricter
  limiter (5 req/min/IP) protects signup and login against credential stuffing. The auth
  limiter is bypassed under test.
- **Validation.** Zod schemas validate every request body and query param. `title` and
  `description` are required and length-capped; `severity` and `status` must be one of the
  allowed enum values; the image `contentType` must be an allowed image type. Invalid payloads
  return `400 VALIDATION_ERROR` with per-field `details`, which the frontend maps back onto
  the offending fields.
- **Error handling.** One middleware converts known error types (validation, not found,
  invalid id, unsupported type, too large, S3 failure) into stable machine-readable codes,
  and everything else into a generic `500` without leaking internals.

---

## 5. What to prioritize first for a production version

1. **Real (non-mocked) integration tests** for the auth, CRUD and full S3 flow against a
   disposable database and bucket — the biggest gap today.
2. **Fix the S3 lifecycle gaps** (see §6): delete-on-replace, and a safe cleanup strategy for
   orphaned uploads.
3. **Verify AWS-side configuration** — the app is deployed (§9), but the IAM policy actually
   in use, the production CORS rule and the private-bucket settings are documented rather
   than verified.
4. **Operational hardening** — structured logging, request IDs, health/readiness probes,
   secret management (a managed secrets store instead of `.env`), and centralized error
   tracking.
5. **Refresh tokens / short-lived access tokens** instead of a single 7-day token.
6. **CI** running build, lint and tests on every push, plus dependency and image scanning.

---

## 6. Scaling to 10,000 users

- **API is stateless** (JWT, no server session), so it scales horizontally behind a load
  balancer; add instances and let the platform autoscale.
- **Database** — run MongoDB Atlas with a replica set, keep the existing compound indexes
  (`userId` + `createdAt`, `userId` + `status`), and add pagination to the bug list (currently
  unbounded per user). Add read preference/analytics isolation if reporting grows.
- **Object storage** — S3 already scales; keep short-lived presigned URLs and consider a
  CDN for `GET` traffic if read volume grows (only if the bucket/CDN is configured to accept
  the same signed URLs).
- **Rate limiting** — replace the in-memory limiter with a shared store (Redis) so limits
  hold across multiple instances.
- **Image processing** — move thumbnail generation and any downscaling to an async worker
  triggered after attach, so the request path stays fast.
- **Observability** — metrics, logs and traces with alerting (see
  [docs/task-2-monitoring-proposal.md](docs/task-2-monitoring-proposal.md)) so 10,000 users
  can be supported without flying blind.
- **Cost/performance** — cache the bug list briefly, and paginate aggressively; keep the
  upload path serverless-friendly by never proxying bytes.

---

## 7. Remaining limitations (honest)

### S3 limitations

- **Orphaned uploads.** If a client presigns and `PUT`s a file but never attaches it
  (abandoned create/edit, closed tab), the object remains in S3 indefinitely.
- **Replacing an image leaves the old object behind.** The attach endpoint overwrites
  `bug.imageKey`; the previously attached object is not deleted and becomes unreferenced.
- **No image-detachment endpoint.** There is no API to remove an attached image; the frontend
  can only replace it (or clear a *local, not-yet-uploaded* selection). Removal is therefore
  out of scope.
- **Delete ordering.** Bug deletion deletes the S3 object **before** deleting the database
  record. If the database delete then fails, the bug remains but its image is gone. Also,
  bug deletion stops (returns `502`) rather than falsely reporting success if the S3 delete
  fails.

#### Why a blanket expiration rule on `uploads/` is unsafe

Object keys are `uploads/<userId>/<uuid>.<ext>`, and **attached and unattached images share
this one prefix**. A lifecycle rule that expires `uploads/` after N days cannot tell them
apart, so it would eventually delete images that are still referenced by bugs. **Do not add
such a rule.**

#### Safer future approaches

1. **Dedicated temporary prefix** — presign into `uploads/tmp/…`, move/copy to the final
   prefix on attach, and expire only `uploads/tmp/` on a lifecycle rule.
2. **Object tagging** — tag `state=pending` on upload and `state=attached` on attach, then
   expire only `pending` objects.
3. **Reconciliation cleanup job** — periodically list objects older than N hours and delete
   those whose key is not referenced by any bug (also covers replaced images).
4. **Delete-on-replace** — in the attach flow, delete the previous `imageKey` after the new
   one is written (best-effort, logged on failure).

### Other limitations

- **No live integration test in CI** — the suite is mocked (see §8).
- **In-memory rate limiting** — per-instance, so limits are not shared across a scaled-out
  deployment. On Elastic Beanstalk with more than one instance, each instance keeps its own
  counters.
- **7-day token, no refresh** — a stolen token is valid until expiry.
- **Unbounded bug-list pagination** — `GET /api/bugs` returns every bug owned by the caller,
  with no `limit`/`offset`. Fine at assignment scale; it must be paginated as data grows.
- **Deployed but not load-tested** — the live environment was smoke-tested manually (the API
  health endpoint over HTTPS); no load, soak or failover testing was performed.
- **AWS-side configuration not automatically verified** — the exact IAM policy attached to
  the Elastic Beanstalk instance role and the production bucket CORS rule were not checked by
  tooling (see §8).

---

## 8. Verification status — mocked vs. manually verified

Be precise about the difference:

| Area | How it was verified | Confidence |
| --- | --- | --- |
| Auth (hashing, JWT sign/verify, expired/invalid/forged tokens, 401s) | Backend unit tests (Mongoose mocked) + code inspection | High (logic) |
| Bug CRUD validation, ownership scoping, invalid-id/not-found handling | Backend unit tests (Mongoose mocked) + code inspection | High (logic) |
| S3 presign/attach/verify/delete incl. failure paths (502, no false success) | Backend unit tests (**S3 service mocked**) + code inspection | High (logic), **not** against real AWS |
| Image validation (size, declared type, magic-byte mismatch) | Backend unit tests mocked at the S3 boundary + code inspection | High (logic) |
| Build / lint / tests | Commands actually run (see below) | High |
| Registration, login, logout, create/edit, dashboard filtering | **Manual browser testing** by the author | Confirmed manually |
| Real S3 upload and presigned `GET` | **Manual** end-to-end check (presign → `PUT` → attach; unsigned object URL returns `AccessDenied`) | Confirmed manually, **not** automated |
| AWS-side IAM policy, production CORS, bucket policy | **Not verified** by tooling | Unknown — must be checked in the AWS console |
| Live HTTPS API (CloudFront → Elastic Beanstalk) and `/health` | **Manual** smoke check of the deployed endpoint | Confirmed manually, **not** automated |
| Live S3 upload flow against the deployed origins | **Not re-run** against the deployed frontend/API | Unknown — re-test pending |
| Deployment | **Performed** (see §9) — smoke-tested, not load-tested | Live, limited verification |

The automated suite mocks Mongoose and the S3 service, so it does **not** prove behaviour
against a live database or a live bucket. Live paths were exercised manually in the browser
only.

### Recorded command results

Backend:

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | exit 0 — **85 tests passed (5 files)** |

Test breakdown: `auth.test.ts` (17 — includes an added expired-token case), `bug.test.ts`
(31), `bug-image.test.ts` (23), `upload.test.ts` (13), `health.test.ts` (1).

Frontend:

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 (48 modules) |
| `npm run lint` | exit 0 |

---

## 9. Deployment and the CloudFront HTTPS workaround

**What is deployed** (AWS, `ap-south-1`):

| Piece | Where | URL |
| --- | --- | --- |
| Frontend | React build on S3, served by CloudFront | <https://d3e658zodlakth.cloudfront.net/> |
| API | Express on Elastic Beanstalk (Node 22), fronted by CloudFront | <https://d3vwiql1m4fnip.cloudfront.net> |
| Database | MongoDB Atlas | — |
| Images | Private S3 bucket, presigned URLs only | — |

The **frontend URL** and the **API base URL** are two *different* CloudFront distributions;
they must not be confused (the SPA calls the API at the second).

**Why the API uses CloudFront.** The assignment requires an HTTPS-reachable API. Direct
HTTPS requests to the original Elastic Beanstalk hostname
(`bug-tracker-lite-env.eba-hww8d3nk.ap-south-1.elasticbeanstalk.com`) **timed out** during
testing — the environment's load balancer did not serve TLS on that endpoint. Instead of
reconfiguring the environment's networking (a change to AWS resources), a **CloudFront
distribution was placed in front of it**: CloudFront terminates HTTPS for the client and
forwards to the EB origin.

**Trade-offs (stated honestly):**

- **TLS terminates at CloudFront, not at the origin.** Client → CloudFront is HTTPS; the
  CloudFront → EB-origin hop may remain HTTP, so that segment is not end-to-end encrypted.
  Acceptable for this assignment; a production system should also enable HTTPS on the load
  balancer.
- **Extra hop and configuration surface.** Requests traverse CloudFront before the load
  balancer, adding a little latency and one more place to configure forwarding and to debug.
- **Two distributions to manage.** The frontend and the API are separate CloudFront
  distributions; mixing up their URLs is an easy mistake.
- **Not load-tested.** Only a manual smoke check of `/health` over HTTPS was performed; the
  EB environment still exposes its original HTTP endpoint.
