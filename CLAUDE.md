# OWASP TIET Quiz Portal Backend — Repository Instructions

This file is the mandatory starting point for every human or AI contributor. Read it completely before proposing, generating, or editing code.

The repository is currently design-first. The architecture, database intent, and API contract already exist. Implementation must follow them; do not redesign the system while completing an ordinary coding task.

## Required reading order

Before changing code, read these files in order:

1. `CLAUDE.md`
2. `README.md`
3. `docs/hld.md`
4. `docs/database-design.md`
5. `docs/api-contract.md`
6. `docs/openapi.yaml`
7. `docs/engineering.md`

Source-of-truth precedence:

- API paths and wire schemas: `docs/openapi.yaml`
- Database entities, constraints, and transaction intent: `docs/database-design.md`
- System behavior and cross-component flows: `docs/hld.md`
- Code quality, testing, and delivery rules: `docs/engineering.md`
- Project summary and deliberate non-goals: `README.md`

If documents conflict, do not guess. Reconcile the documents in the same change before implementation.

## Mandatory preflight

Every contributor must do the following before editing:

1. Inspect `git status` and preserve unrelated or user-owned changes.
2. Read the relevant module, tests, Prisma schema, and OpenAPI operations.
3. State which documented behavior the change implements.
4. Choose the smallest change that satisfies the contract.
5. Check whether API, database, security, or lifecycle behavior changes.

Do not commit, push, deploy, migrate shared databases, or change external services unless explicitly requested.

## Architecture that must not drift

Version one deliberately uses:

- Next.js frontend on Vercel.
- One stateless Express + TypeScript backend on Railway.
- Supabase Google OAuth, PostgreSQL, and private Storage.
- Prisma Client and Prisma Migrate.
- Zod request/environment validation.
- Direct PostgreSQL writes for answers, submission, scoring, and violations.

Version one deliberately does **not** use:

- Redis.
- BullMQ or another queue.
- Background worker services.
- Microservices.
- Custom password/session authentication.
- Read replicas.
- Browser-side ML or camera upload/recording.
- Generic controller/repository/DI frameworks.

Do not introduce a deferred component without explicit approval and measured evidence that the simple design is insufficient.

## Non-negotiable product rules

- Supabase owns OAuth sessions and refresh tokens. The backend verifies bearer JWTs and stores no custom session.
- A quiz series is the parent container for one or more independently scheduled quizzes.
- Email comes from the verified Google identity and is never accepted from onboarding input.
- TIET domain, roster eligibility, completed onboarding, account status, and role are checked server-side.
- One student has at most one attempt per quiz through a database unique constraint.
- Published quiz content is immutable; changes require a clone/new draft.
- Backend server time controls start, expiry, close, and submission.
- The frontend exits an attempt when its authoritative timer reaches zero; the backend treats the attempt as expired at that instant even if final score persistence occurs on the next request.
- Attempt question and option order is snapshotted and stable.
- Student APIs return one question at a time and never return correctness or marks.
- Selecting an option writes to IndexedDB only. Next, Previous, or Submit performs one PUT when the answer changed.
- Navigation to an unseen question waits for a successful answer commit.
- Accepted answers are already committed to PostgreSQL.
- Client revisions and idempotency keys protect retries and out-of-order requests.
- Answer save, submit, expiry, and qualifying violations lock the attempt row.
- Submission calculates and stores the score synchronously on `attempts`.
- Results and leaderboard remain hidden until admin publication.
- Browser violations are limited to configured events such as tab hiding, fullscreen exit, and copy/paste.
- Violations 1–3 warn, violation 4 gives a final warning, and violation 5 force-submits and flags review.
- Camera is a muted local live preview only. No audio, recording, frames, ML, or camera metadata reaches the backend.

## Required repository structure

Keep the implementation within this shape:

```text
.
|-- CLAUDE.md
|-- AGENTS.md
|-- README.md
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- .env.example
|-- docs/
|   |-- hld.md
|   |-- database-design.md
|   |-- api-contract.md
|   |-- openapi.yaml
|   `-- engineering.md
|-- prisma/
|   |-- schema.prisma
|   `-- migrations/
|-- src/
|   |-- modules/
|   |   |-- auth/
|   |   |   |-- middleware.ts
|   |   |   |-- service.ts
|   |   |   `-- service.test.ts
|   |   |-- users/
|   |   |   |-- routes.ts
|   |   |   |-- schema.ts
|   |   |   |-- service.ts
|   |   |   `-- service.test.ts
|   |   |-- quizzes/
|   |   |   |-- routes.ts
|   |   |   |-- schema.ts
|   |   |   |-- service.ts
|   |   |   `-- service.test.ts
|   |   |-- attempts/
|   |   |   |-- routes.ts
|   |   |   |-- schema.ts
|   |   |   |-- service.ts
|   |   |   |-- queries.ts
|   |   |   `-- service.test.ts
|   |   `-- violations/
|   |       |-- routes.ts
|   |       |-- schema.ts
|   |       |-- service.ts
|   |       `-- service.test.ts
|   |-- middleware/
|   |   |-- error-handler.ts
|   |   |-- not-found.ts
|   |   `-- request-id.ts
|   |-- lib/
|   |   |-- prisma.ts
|   |   `-- supabase.ts
|   |-- shared/
|   |   |-- config/
|   |   |   `-- env.ts
|   |   |-- errors/
|   |   |   `-- problem.ts
|   |   |-- logging/
|   |   |   `-- logger.ts
|   |   `-- security/
|   |       |-- cors.ts
|   |       `-- rate-limit.ts
|   |-- app.ts
|   `-- server.ts
|-- tests/
|   |-- integration/
|   `-- load/
|-- .github/
|   |-- workflows/
|   |   `-- ci.yml
|   |-- copilot-instructions.md
|   `-- pull_request_template.md
|-- .cursor/
|   `-- rules/
|       `-- repository.mdc
`-- .windsurfrules
```

This is the target structure. Do not create empty placeholder files or folders before their vertical slice is implemented.

Default HTTP module shape:

```text
module/
|-- routes.ts
|-- schema.ts
|-- service.ts
|-- service.test.ts
`-- queries.ts       # optional; only for justified complex SQL
```

`auth` is the intentional exception: it uses `middleware.ts`, `service.ts`, and tests because Supabase owns the login endpoints. `attempts/queries.ts` is the initial justified query helper for the revision-aware answer upsert.

Do not create a controller, repository, interface, DTO, mapper, or `types.ts` file automatically. Add a layer only when it removes real duplication or isolates real complexity.

## Module boundaries

- `auth`: Supabase JWT verification and authenticated identity middleware.
- `users`: profiles, onboarding, roles, account status, and roster identity linking.
- `quizzes`: quiz lifecycle, questions/options, enrollments, admin quiz operations, and media paths.
- `attempts`: attempt creation, question delivery, answers, timing, submission, scoring, results, and leaderboard queries.
- `violations`: browser event validation, deduplication, warning count, force submission, and admin review.

Admin routes belong to the domain they manage. Do not create a generic `admin` module.

Modules may call another module's exported service function. They must not import another module's private query helpers or mutate its tables without going through documented domain behavior.

## Implementation order

Build the repository in small vertical slices:

### 1. Foundation

- `package.json`, `pnpm-lock.yaml`, strict `tsconfig.json`.
- ESLint, Prettier, Vitest, and standard scripts.
- Environment validation.
- Express app/server separation.
- Request IDs, Pino logging, RFC 7807 error middleware.
- `/health/live` and `/health/ready`.

### 2. Database

- Implement the eleven documented Prisma models, including quiz series and append-only attempt reviews.
- Add database enums, unique constraints, foreign keys, and required indexes.
- Generate and review the initial Prisma migration.
- Use the pooled URL at runtime and direct URL for migrations.

### 3. Authentication and onboarding

- Supabase JWKS JWT verification.
- TIET domain and Google-provider checks.
- Profile shell, roster matching, onboarding, roles, and blocked accounts.

### 4. Quiz administration

- Draft quiz CRUD, questions/options, private image paths, roster import.
- Quiz-series CRUD and assignment of quizzes to a series.
- Admin question listing/detail, user administration, question batch import, summaries, exports, and single-attempt force submission.
- Publish, enable, disable, close, clone, and result publication transitions.

### 5. Student attempt slice

- Assigned quiz list/detail.
- Start/resume one attempt.
- Stable randomized snapshots.
- One-question-at-a-time delivery with `Cache-Control: no-store`.

### 6. Answers and submission

- Revision-safe answer PUT.
- Revision-safe answer clearing using a nullable selected option tombstone.
- Attempt-row locking and navigation-save behavior.
- Expiry checks, synchronous scoring, result access, and leaderboard.

### 7. Violations

- Browser event endpoint, deduplication, thresholds, force submission, and review.
- Do not add camera or ML payloads.

### 8. Hardening

- Integration tests, security checks, CI/CD, and k6 burst tests.
- Tune queries, indexes, pools, and Railway replicas before adding infrastructure.

Do not scaffold every module with placeholder code at once. Complete and test one vertical slice before expanding.

## API contract rules

- `docs/openapi.yaml` is the machine-readable contract.
- Zod schemas and route responses must match it exactly.
- Use the documented field names, including `questionId`, `optionId`, and `questionCount`.
- Return RFC 7807 `application/problem+json` errors with stable `code` and `requestId`.
- Do not expose stack traces, SQL details, internal secrets, correctness, or hidden marks.
- Breaking changes require deliberate versioning; do not silently change `/v1` behavior.

When an API changes, update together:

1. `docs/openapi.yaml`
2. `docs/api-contract.md`
3. Zod schemas
4. Route/service implementation
5. API and integration tests
6. README/HLD when product behavior changes

Run OpenAPI lint before completion:

```text
npx --yes @redocly/cli@latest lint docs/openapi.yaml
```

## Database and Prisma rules

- Create one reusable `PrismaClient` per API process.
- Never instantiate Prisma per request.
- Use Prisma Client for ordinary queries and transactions.
- Keep only one parameterized raw SQL helper for the revision-aware answer upsert unless another query is proven necessary.
- Never concatenate SQL or accept identifiers from request data.
- Never use `prisma db push` in staging or production.
- Review generated migration SQL before committing it.
- Never modify Supabase-managed `auth` or `storage` schemas.
- Keep transactions short and make no network calls inside them.

Concurrency invariants:

- `(quiz_id, user_id)` uniquely prevents duplicate attempts.
- `(attempt_id, question_id)` uniquely stores one answer.
- Higher answer revisions win; stale revisions never overwrite newer ones.
- The same revision with different content is a conflict.
- Attempt-row locks serialize save/submit/expiry/violation transitions for one student only.
- Repeated submission and publication actions are idempotent.

## Query discipline

- Never call Prisma inside an unbounded loop.
- Avoid N+1 queries with bounded `select`/`include`, `IN` queries, aggregates, or one justified query helper.
- Paginate admin lists.
- Fetch only required columns on hot paths.
- One question request must load its snapshot, options, and saved answer with a bounded query shape.
- Use database aggregates for counts and leaderboard data.
- Do not update shared counters on every answer save.

Initial query budgets:

- Assigned quiz list: at most 2 normal round trips.
- One question with options/saved answer: at most 2.
- One answer save, including lock: at most 3.
- Submit and score: at most 3 inside the transaction.

## TypeScript and validation

- Enable strict TypeScript.
- Do not use `any`; use `unknown` and narrow it.
- Infer types from Zod and Prisma instead of duplicating them.
- Validate environment variables at startup.
- Validate all path, query, header, and body inputs.
- Prefer explicit return types for exported functions.
- Avoid non-null assertions unless an invariant is documented.
- Keep functions focused and names domain-specific.
- Remove dead, commented-out, generated-placeholder, and speculative code.

## Security and privacy

- Verify JWT signature, issuer, audience, expiry, and expected provider/domain.
- Perform role, ownership, enrollment, profile, state, and expiry checks on the backend.
- Use strict CORS, Helmet, request-size limits, and simple route rate limits.
- Supabase service credentials are server-only.
- Never log access/refresh tokens, correct answers, signed URLs, phone numbers, or full request bodies.
- Question image buckets are private; return short-lived signed URLs only after authorization.
- Camera processing is frontend-only local preview behavior and is outside backend payloads.

## Testing requirements

Tests are part of implementation, not a follow-up task.

At minimum cover:

- Google/TIET identity and onboarding validation.
- Role, ownership, enrollment, and blocked-user checks.
- Concurrent attempt creation.
- Stable randomized question/option order.
- Correct answer fields never appearing in student responses.
- Stale, duplicate, conflicting, and out-of-order answer revisions.
- Answer racing with submission/expiry.
- Next/Previous waiting for a changed answer save.
- Idempotent submission and scoring, including negative marks and unanswered questions.
- Fifth qualifying violation force-submitting exactly once.
- Result publication and disqualification access.
- Published per-question answer review without exposing answer keys before publication.
- Bounded query counts for hot paths.

Run the repository scripts before declaring work complete. Once scaffolded, the standard commands must be:

```text
pnpm install
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm prisma validate
```

If a standard script does not exist during foundation work, add it rather than inventing a one-off command.

## Environment configuration

Use `.env.example` as the documented key list once scaffolding begins. Expected categories include:

- pooled PostgreSQL runtime URL
- direct PostgreSQL migration URL
- Supabase project/JWKS configuration
- server-only Supabase service credential for Storage
- allowed TIET email domains
- CORS origins
- port and log level

Never commit real secrets or copy production values into tests.

## Documentation update matrix

| Change | Required documentation |
| --- | --- |
| Endpoint, field, status, or error | OpenAPI and API contract |
| Table, enum, constraint, index, or transaction | Database design |
| Cross-component or lifecycle behavior | HLD and README |
| Tooling, test, CI, deployment, or code convention | Engineering guide and this file |

Documentation and implementation must be updated in the same pull request.

## Definition of done

Before reporting completion:

1. Confirm the implementation matches the relevant docs and OpenAPI operation.
2. Run formatting, lint, typecheck, tests, migration validation, and build as applicable.
3. Run `git diff --check`.
4. Confirm no secret, correct answer, signed URL, camera data, or unrelated file was added.
5. Confirm no N+1 query or avoidable per-item database loop was introduced.
6. Confirm race-sensitive changes use documented locks, constraints, revisions, or idempotency.
7. Update all affected documentation.
8. Summarize changed behavior, tests run, and any remaining risk.

## Simplicity rule

Prefer readable, direct code that a new contributor can follow. Do not build abstractions for hypothetical future needs. The best implementation for this repository is the smallest one that preserves the documented security, data-integrity, and concurrency invariants.
