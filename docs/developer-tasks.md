# Three-Developer Implementation Guide

## Purpose

This guide divides the remaining backend work among:

- **Ayush:** authentication, profiles, onboarding, and user administration.
- **Sanyam:** quiz series, quizzes, questions, enrollments, and private question images.
- **Param:** attempts, answers, submission, violations, results, and leaderboards.

It is written for developers who are new to the repository. Follow the documented API and database design exactly; do not redesign endpoint paths, response fields, tables, or lifecycle rules inside an ordinary feature task.

The database foundation and health endpoints already exist. Most feature endpoints are not implemented yet.

## Mandatory Reading and Setup

Before writing code, every developer must read these files in order:

1. `CLAUDE.md`
2. `README.md`
3. `docs/hld.md`
4. `docs/database-design.md`
5. `docs/api-contract.md`
6. `docs/openapi.yaml`
7. `docs/engineering.md`
8. This file

Set up the repository:

```powershell
git clone https://github.com/PrathamRanka/owasp-quiz-be.git
cd owasp-quiz-be
corepack enable
pnpm install
Copy-Item .env.example .env
pnpm prisma:migrate:deploy
pnpm dev
```

Obtain development `.env` values from the maintainer through a secure channel. Never commit `.env` or paste secret values into issues, pull requests, screenshots, logs, or Postman collections.

Verify the foundation:

```powershell
curl.exe http://localhost:3001/health/live
curl.exe http://localhost:3001/health/ready
```

Both should return HTTP `200`.

## Team Ownership

| Developer | Modules owned                                                       | Branch prefix     |
| --------- | ------------------------------------------------------------------- | ----------------- |
| Ayush     | `auth`, `users`, shared authenticated request context               | `feature/ayush-`  |
| Sanyam    | `quizzes`, quiz series, questions, enrollments, Storage integration | `feature/sanyam-` |
| Param     | `attempts`, `violations`, scoring, results, leaderboard             | `feature/param-`  |

Ownership prevents conflicting implementations; it does not prevent collaboration. A developer may call another module's exported service function but must not import another module's private query helpers.

## Architecture Pattern for Every Module

Use the repository's direct route-to-service structure:

```text
HTTP request
  -> authentication/authorization middleware
  -> Zod validation
  -> domain service
  -> Prisma transaction/query
  -> documented response
```

Default files:

```text
src/modules/<module>/
|-- routes.ts
|-- schema.ts
|-- service.ts
`-- service.test.ts
```

Only `attempts` initially needs `queries.ts` for the parameterized revision-aware answer upsert. Do not create controllers, repositories, interfaces, DTO folders, mappers, or dependency-injection containers.

Each route module should export an Express router. Route registration in `src/app.ts` should be a small, reviewed change. Coordinate before editing `src/app.ts` so only one open pull request changes the same registration block at a time.

## Shared Rules

Every implementation must:

- Use strict TypeScript without `any`.
- Validate path, query, header, and body input with Zod.
- Return response fields exactly as defined in `docs/openapi.yaml`.
- Return RFC 7807 errors through the existing error middleware.
- Use stable error codes from `docs/api-contract.md`.
- Use the shared Prisma client from `src/lib/prisma.ts`.
- Avoid database calls inside unbounded loops.
- Paginate unbounded admin lists.
- Never log JWTs, service keys, phone numbers, answer keys, signed URLs, or full request bodies.
- Never expose `isCorrect`, hidden marks, or correctness in student question APIs.
- Keep network calls outside database transactions.
- Include tests in the same pull request as the implementation.

Do not edit `prisma/schema.prisma` unless the documented database design genuinely requires a change. Do not use `prisma db push`.

## Dependency and Merge Order

```text
Ayush A1: JWT middleware and authenticated identity
  |-- Ayush A2/A3: onboarding and user administration
  |-- Sanyam: protected quiz administration and student discovery
  `-- Param: protected attempt and violation operations

Sanyam: published quiz, questions, options, and enrollment
  `-- Param: attempt creation, snapshots, answer saving, and scoring
```

### Required pull-request merge sequence

Issues may be developed partly in parallel, but pull requests must merge in the following waves. Do not merge a later wave while one of its required dependencies is still open.

| Wave | Pull requests to merge                                                                                                   | Can be developed in parallel?                                                              | Why this order keeps `main` stable                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **A1 / #1** JWT middleware, then **P0 / #9** pure scoring and randomization                                              | Yes; merge A1 first, then P0                                                               | A1 establishes the only authenticated request context. P0 has no routes or database writes, so it cannot break incomplete feature flows.                                                       |
| 2    | **A2 / #2** profile and onboarding                                                                                       | No dependency-free substitute                                                              | Every student route needs a trusted profile, account state, onboarding state, and roster identity. Merging this before student quiz/attempt routes prevents temporary authorization shortcuts. |
| 3    | **A3 / #3** admin helpers, then **S1 / #4** quiz-series CRUD                                                             | S1 service/schema/tests may be prepared while A3 is reviewed                               | A3 creates one reusable source of admin authorization. S1 then becomes the first complete protected administration slice without duplicating role checks.                                      |
| 4    | **S2 / #5** draft quiz/lifecycle, **S3 / #6** questions/storage, then **S4 / #7** enrollments                            | Develop sequentially within Sanyam's module; review may overlap                            | A usable attempt requires a valid series, quiz, questions/options, and enrollment. This wave makes all prerequisite exam content and eligibility available before attempt routes merge.        |
| 5    | **P1 / #10** attempt start/question delivery                                                                             | No                                                                                         | P1 now has trusted students and complete published quiz data. `main` gains a usable read/start attempt slice without accepting answers yet.                                                    |
| 6    | **P2 / #11** answer save/submission                                                                                      | No                                                                                         | This adds the shared lock-and-finalize service that later close and violation flows must reuse, preventing duplicate scoring implementations.                                                  |
| 7    | **S6 / #12** quiz close and **P3 / #13** violations                                                                      | Yes after P2; merge either first                                                           | Both depend on P2's finalization service but affect separate modules. Each preserves the same locking and scoring behavior.                                                                    |
| 8    | **P4 / #14** attempts/reviews/results/leaderboards and **S5 / #8** discovery/reporting                                   | Coordinate response/report dependencies; normally merge P4 before the final S5 export work | P4 establishes authoritative result publication and review behavior. S5 can then report/export final data without inventing duplicate result rules.                                            |
| 9    | Hardening PRs: full integration tests, query-budget checks, security review, k6 scenarios, and operational documentation | Yes when files do not overlap                                                              | Features are complete, so hardening measures the integrated system instead of testing temporary implementations.                                                                               |

Within a wave, “developed in parallel” does not mean “merge without rebasing.” The second PR merged in a wave must rebase onto the newly updated `main` and rerun all checks.

### Merge gate for every pull request

The maintainer should merge a PR only when all of these are true:

1. Every issue listed as a dependency has already merged.
2. The branch is rebased onto the latest `main`; GitHub reports no conflicts.
3. CI passes on the rebased commit.
4. At least one teammate reviewed the code; authentication, scoring, submission, migrations, and violations need especially careful review.
5. The PR contains implementation and tests for one complete vertical slice, not disconnected placeholder files.
6. Postman checks listed in the issue were run and recorded in the PR description.
7. No temporary auth bypass, hard-coded user, public Storage bucket, debug endpoint, or secret is present.
8. The merge leaves health endpoints and every previously merged endpoint working.

Use **Squash and merge** for these task PRs unless preserving multiple commits has a specific review value. The squash commit should reference the issue, for example:

```text
feat(auth): verify Supabase JWTs and trusted identity (#1)
```

### Rebase checkpoint after each dependency merge

When a dependency merges, every developer whose branch depends on it must update before continuing integration work:

```powershell
git switch main
git pull --rebase origin main
git switch <your-feature-branch>
git rebase main
pnpm install
pnpm prisma:generate
pnpm typecheck
pnpm test
```

Resolve conflicts by preserving the already merged contract and shared helpers. Do not resolve a conflict by copying an old whole file over `main`. After resolving:

```powershell
git add <resolved-files>
git rebase --continue
git push --force-with-lease
```

Use `--force-with-lease` only on the developer's feature branch, never on `main`.

### Shared-file coordination

These files are integration hotspots and require explicit ownership per PR:

| Shared file                           | Merge rule                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`                          | Only the PR currently registering its completed routes edits the route-registration section. Rebase later route PRs and add registrations without replacing existing ones. |
| `src/lib/supabase.ts`                 | A1 creates the shared Supabase/JWKS foundation. S3 extends it for Storage after rebasing; it must not remove authentication exports.                                       |
| `package.json` / `pnpm-lock.yaml`     | A1 adds `jose`; S3 may add `@supabase/supabase-js`. Always run `pnpm install` after rebasing and commit matching lockfile changes.                                         |
| `docs/openapi.yaml`                   | The existing contract is authoritative. Change it only for a deliberate reconciled contract correction, not to make an implementation easier.                              |
| `prisma/schema.prisma` and migrations | No assigned feature currently needs redesign. Any change requires maintainer approval and a reviewed migration.                                                            |
| `src/modules/quizzes/*`               | Sanyam owns normal changes. Param exposes services rather than editing quiz internals. S6 is reviewed jointly.                                                             |
| `src/modules/attempts/*`              | Param owns normal changes. Sanyam calls exported finalization behavior rather than mutating attempt tables directly.                                                       |

### System state after each wave

Each merge wave must leave a coherent, testable backend:

1. **After Wave 1:** health remains operational; authentication middleware and pure domain logic are tested, but no fake feature endpoints are exposed.
2. **After Wave 2:** a rostered Google user can resolve and complete a profile; unauthorized users remain blocked.
3. **After Wave 3:** an authenticated admin can manage quiz-series containers using the shared role policy.
4. **After Wave 4:** an admin can prepare a complete publishable quiz, private images, and eligible roster.
5. **After Wave 5:** an eligible student can discover/start a quiz and retrieve one safe randomized question.
6. **After Wave 6:** the student can save revision-safe answers and submit/score exactly once.
7. **After Wave 7:** admin close and browser enforcement terminate attempts through the same authoritative finalization path.
8. **After Wave 8:** admin review and publication control all student result, review, leaderboard, summary, and export visibility.
9. **After Wave 9:** the complete backend is measured, secured, documented, and ready for staging acceptance.

If a wave leaves a public route that always throws “not implemented,” bypasses authorization, or writes partial lifecycle state, do not merge it.

The quiz-close endpoint is a cross-module integration point. Sanyam owns the quiz lifecycle transition, while Param owns attempt locking, finalization, and scoring. Do not merge a partial close implementation that changes the quiz state without finalizing active attempts. Complete `POST /v1/admin/quizzes/:quizId/close` in a small follow-up pull request after Param exports the shared finalization service.

While waiting for Ayush's middleware, Sanyam and Param should implement and test pure domain functions, Zod schemas, and service logic using explicit identity arguments. They should not invent temporary authentication middleware.

## Git Workflow for Beginners

Start each small task from current `main`:

```powershell
git switch main
git pull --rebase origin main
git switch -c feature/ayush-jwt-middleware
```

Replace the branch name with the assigned task. Keep one logical slice per branch.

Before opening a pull request:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm build
pnpm prisma:validate
git diff --check
npx --yes @redocly/cli@latest lint docs/openapi.yaml
```

Do not commit or push directly to `main`. Do not include `.env`, generated coverage, build output, or unrelated formatting changes.

## Postman Setup for All Developers

### Import the API contract

1. Open Postman.
2. Click **Import**.
3. Select `docs/openapi.yaml` from the repository.
4. Create a collection named `OWASP Quiz Backend`.
5. Re-import or manually update requests only when the OpenAPI contract changes.

### Create a Local environment

Add these Postman variables:

| Variable             | Initial value           |
| -------------------- | ----------------------- |
| `baseUrl`            | `http://localhost:3001` |
| `studentAccessToken` | empty                   |
| `adminAccessToken`   | empty                   |
| `studentUserId`      | empty                   |
| `adminUserId`        | empty                   |
| `seriesId`           | empty                   |
| `quizId`             | empty                   |
| `questionId`         | empty                   |
| `optionId`           | empty                   |
| `enrollmentId`       | empty                   |
| `attemptId`          | empty                   |
| `clientRevision`     | `1`                     |

Do not store real tokens in a shared/exported Postman environment.

### Authorization

For student requests:

```text
Authorization type: Bearer Token
Token: {{studentAccessToken}}
```

For admin requests:

```text
Authorization type: Bearer Token
Token: {{adminAccessToken}}
```

Never use `SUPABASE_SERVICE_ROLE_KEY` as a user's bearer token.

### Obtaining a development access token

Supabase owns login; this backend does not expose a login endpoint.

1. Sign in through the configured Supabase Google OAuth flow using the frontend or a maintainer-approved temporary development auth page.
2. Read the Supabase session's `access_token` in that development client.
3. Paste only the access token into the private Postman environment.
4. Repeat with an admin account for `adminAccessToken`.
5. Refresh the token when Postman begins returning `401` because Supabase access tokens expire.

The initial admin must be provisioned through a controlled development setup by the maintainer. Application routes must not trust a client-supplied role or provide a public “make me admin” endpoint.

### Common Postman test scripts

Verify a successful JSON response:

```javascript
pm.test('status is successful', () => {
  pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]);
});
```

Verify RFC 7807 errors:

```javascript
pm.test('problem response is safe', () => {
  pm.expect(pm.response.headers.get('Content-Type')).to.include('application/problem+json');
  const body = pm.response.json();
  pm.expect(body).to.have.property('code');
  pm.expect(body).to.have.property('requestId');
  pm.expect(body).not.to.have.property('stack');
});
```

Save an ID returned by an endpoint:

```javascript
const body = pm.response.json();
pm.environment.set('quizId', body.quizId);
```

Generate an idempotency key in a request body with Postman's dynamic variable:

```json
{
  "idempotencyKey": "{{$guid}}"
}
```

## Ayush: Authentication and Users

Ayush owns the foundation that all protected routes depend on. Complete the tasks in order.

### A1. Supabase JWT verification

Branch:

```text
feature/ayush-jwt-middleware
```

Create:

```text
src/lib/supabase.ts
src/modules/auth/middleware.ts
src/modules/auth/service.ts
src/modules/auth/service.test.ts
```

Add the `jose` dependency for standards-based JWT/JWKS verification. Keep `src/lib/supabase.ts` focused on reusable Supabase client/JWKS construction. After this PR merges, Sanyam may extend that shared file for the server-only Storage client in a separate reviewed change rather than creating a second Supabase client per request.

Implement:

1. Load Supabase JWKS from `SUPABASE_JWKS_URL` with `jose`.
2. Verify JWT signature, issuer, audience, expiry, and subject.
3. Require the expected Google identity/provider information.
4. Normalize the verified email to lowercase and trimmed form.
5. Enforce `ALLOWED_EMAIL_DOMAINS` server-side.
6. Create an authenticated identity object containing only trusted claims such as subject and verified email.
7. Attach that identity to the Express request using a TypeScript-safe declaration extension.
8. Return `401` for missing/invalid tokens and `403 EMAIL_DOMAIN_NOT_ALLOWED` for disallowed domains.

Do not:

- Accept an email or user ID from request bodies as identity.
- Store access or refresh tokens.
- Call Supabase on every request when JWKS verification can be cached.
- Log bearer tokens or complete JWT claims.

Required tests:

- Missing bearer token.
- Malformed authorization header.
- Invalid signature.
- Wrong issuer or audience.
- Expired token.
- Missing subject/email.
- Disallowed domain.
- Valid trusted identity.

Postman checks:

```http
GET {{baseUrl}}/v1/me
Authorization: Bearer invalid-token
```

Expected: `401` problem response.

Then use a real student access token. Until A2 is merged, `GET /v1/me` may not exist; add a protected route only as part of A2, not as a temporary public debug route.

Completion criteria:

- Middleware exports a stable authenticated request context for Sanyam and Param.
- Tests do not depend on real Supabase or network calls.
- No login endpoint or custom session table is introduced.

### A2. Profile shell and onboarding

Branch:

```text
feature/ayush-profile-onboarding
```

Create:

```text
src/modules/users/routes.ts
src/modules/users/schema.ts
src/modules/users/service.ts
src/modules/users/service.test.ts
```

Endpoints:

```http
GET  /v1/me
POST /v1/onboarding
```

Implement `GET /v1/me`:

1. Read the verified subject and email from authentication middleware.
2. Resolve the profile by Supabase subject.
3. Confirm account status.
4. Confirm an eligible roster record exists for the verified email.
5. Return the exact `Profile` schema.
6. Return `onboardingStatus: REQUIRED` for an eligible user whose profile is incomplete.
7. Return `ACCOUNT_NOT_REGISTERED` when no eligible roster exists.

Implement onboarding in one short transaction:

1. Validate `fullName`, `rollNumber`, `branchCode`, and E.164 `phoneNumber`.
2. Never accept email in the request body.
3. Lock the eligible roster entry for the verified email.
4. Verify roll number and branch against the roster.
5. Reject a roll number already linked to another profile.
6. Complete the profile and link applicable enrollment rows.
7. Make an identical repeated request idempotent.
8. Reject conflicting repeated onboarding.

Required error cases:

- `ACCOUNT_NOT_REGISTERED`
- `EMAIL_DOMAIN_NOT_ALLOWED`
- `ROSTER_DETAILS_MISMATCH`
- `ROLL_NUMBER_ALREADY_REGISTERED`
- Invalid E.164 phone number
- Blocked account

Required tests:

- Eligible first login returns onboarding required.
- Email from JWT is used; body email is rejected by Zod.
- Matching onboarding succeeds.
- Wrong roll/branch fails without partial writes.
- Repeated matching onboarding is idempotent.
- Another identity cannot claim an existing roll number.
- Blocked users are denied.

Postman sequence:

```http
GET {{baseUrl}}/v1/me
Authorization: Bearer {{studentAccessToken}}
```

Then:

```http
POST {{baseUrl}}/v1/onboarding
Authorization: Bearer {{studentAccessToken}}
Content-Type: application/json

{
  "fullName": "Student Name",
  "rollNumber": "102300001",
  "branchCode": "CSE",
  "phoneNumber": "+919876543210"
}
```

Repeat the same request and verify it returns the same completed profile without creating duplicates.

### A3. Role middleware and user administration

Branch:

```text
feature/ayush-admin-users
```

Endpoints:

```http
GET   /v1/admin/users
GET   /v1/admin/users/:userId
PATCH /v1/admin/users/:userId
```

Implement:

1. Export reusable profile/account/role authorization helpers.
2. Resolve role from PostgreSQL, not editable token metadata.
3. Paginate user lists.
4. Allow controlled corrections to name, roll, branch, phone, role, and status.
5. Never allow replacement of verified email or Supabase user ID.
6. Log privileged changes with actor and request IDs without sensitive values.

Postman checks:

- Student token calling `/v1/admin/users` returns `403`.
- Admin token returns a paginated list.
- Invalid user ID returns scoped `404`.
- Profile correction returns `200`.
- Attempting to send `email` is rejected by validation.

## Sanyam: Quizzes, Questions, Enrollments, and Storage

Sanyam owns all quiz configuration and student quiz discovery. Protected routes depend on Ayush's authenticated context and admin authorization helpers.

### S1. Quiz-series CRUD

Branch:

```text
feature/sanyam-quiz-series
```

Create the initial module files:

```text
src/modules/quizzes/routes.ts
src/modules/quizzes/schema.ts
src/modules/quizzes/service.ts
src/modules/quizzes/service.test.ts
```

Endpoints:

```http
POST   /v1/admin/quiz-series
GET    /v1/admin/quiz-series
GET    /v1/admin/quiz-series/:seriesId
PATCH  /v1/admin/quiz-series/:seriesId
DELETE /v1/admin/quiz-series/:seriesId
```

Implement:

1. Require an active admin profile.
2. Validate title and description according to OpenAPI limits.
3. Set `createdBy` from authenticated admin identity.
4. Paginate list responses.
5. Return `quizCount` using a bounded aggregate.
6. Delete only an empty series.
7. Return `409` when child quizzes exist.

Postman create request:

```http
POST {{baseUrl}}/v1/admin/quiz-series
Authorization: Bearer {{adminAccessToken}}
Content-Type: application/json

{
  "title": "OWASP Recruitment 2026",
  "description": "Backend security quiz series"
}
```

Save the returned ID:

```javascript
pm.environment.set('seriesId', pm.response.json().seriesId);
```

Test create, list, detail, update, empty delete, and delete conflict.

### S2. Draft quiz CRUD and lifecycle

Branch:

```text
feature/sanyam-quiz-lifecycle
```

Endpoints:

```http
POST   /v1/admin/quizzes
GET    /v1/admin/quizzes
GET    /v1/admin/quizzes/:quizId
PATCH  /v1/admin/quizzes/:quizId
DELETE /v1/admin/quizzes/:quizId
POST   /v1/admin/quizzes/:quizId/publish
POST   /v1/admin/quizzes/:quizId/enable
POST   /v1/admin/quizzes/:quizId/disable
POST   /v1/admin/quizzes/:quizId/clone
```

The close endpoint is completed later in the cross-module integration PR described below.

Implement:

1. Create quizzes only under an existing series.
2. Use server-parsed UTC timestamps.
3. Require `endsAt > startsAt` and positive duration.
4. Allow edits/deletion only in `DRAFT` with no attempt history.
5. Publication validates question and option requirements.
6. Published content becomes immutable.
7. Enable/disable must be idempotent.
8. Disable blocks new starts but does not affect active attempts.
9. Clone creates a complete editable draft without copying attempts, answers, or enrollment links unless the contract explicitly requires them.

Cross-module follow-up after Param P2:

```http
POST /v1/admin/quizzes/:quizId/close
```

Sanyam performs the final quiz lifecycle transition and calls Param's exported bounded attempt-finalization service. The operation must reject later answers and synchronously finalize active attempts in bounded batches as documented.

Postman create request:

```http
POST {{baseUrl}}/v1/admin/quizzes
Authorization: Bearer {{adminAccessToken}}
Content-Type: application/json

{
  "seriesId": "{{seriesId}}",
  "title": "OWASP Basics",
  "description": "Security fundamentals",
  "instructions": "Select one answer per question.",
  "durationMinutes": 30,
  "startsAt": "2026-09-01T09:00:00Z",
  "endsAt": "2026-09-01T11:00:00Z"
}
```

Save `quizId`. Verify draft update succeeds and publishing an empty quiz fails.

### S3. Questions, options, batch import, and private images

Branch:

```text
feature/sanyam-questions-storage
```

Endpoints:

```http
GET    /v1/admin/quizzes/:quizId/questions
POST   /v1/admin/quizzes/:quizId/questions
POST   /v1/admin/quizzes/:quizId/questions/import
GET    /v1/admin/questions/:questionId
PATCH  /v1/admin/questions/:questionId
DELETE /v1/admin/questions/:questionId
POST   /v1/admin/questions/:questionId/image-url
```

Implement question writes:

1. Only draft quizzes may change questions/options.
2. Validate at least two options.
3. Validate source ordering.
4. Store positive and non-negative negative marks as decimals.
5. Publication requires exactly one correct option.
6. Admin responses may include correctness; student responses must not.
7. Batch imports are bounded to OpenAPI limits and report row errors.
8. Do not perform one database query per imported question when a bounded transaction/batch is possible.

Implement private Storage integration:

1. Add the official `@supabase/supabase-js` dependency if it is not already present.
2. Extend the shared `src/lib/supabase.ts` client factory after Ayush's authentication PR is merged.
3. Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` only on the server.
4. Verify admin role and draft ownership/state before signing.
5. Accept only PNG, JPEG, and WebP metadata defined by OpenAPI.
6. Generate a server-controlled object path such as `quizzes/<quizId>/questions/<questionId>/<uuid>.<ext>`.
7. Return a short-lived signed upload URL.
8. Store only the stable object path in `questions.image_path` after the documented update flow.
9. Never store or log signed URLs.
10. Never make the bucket public.

Postman question request:

```http
POST {{baseUrl}}/v1/admin/quizzes/{{quizId}}/questions
Authorization: Bearer {{adminAccessToken}}
Content-Type: application/json

{
  "prompt": "Which OWASP category covers broken authorization checks?",
  "imagePath": null,
  "positiveMarks": 4,
  "negativeMarks": 1,
  "sourceOrder": 1,
  "options": [
    { "text": "Broken Access Control", "isCorrect": true, "sourceOrder": 1 },
    { "text": "Cryptographic Failures", "isCorrect": false, "sourceOrder": 2 }
  ]
}
```

Save `questionId` and a non-secret option ID for later attempt testing.

Signed upload request:

```http
POST {{baseUrl}}/v1/admin/questions/{{questionId}}/image-url
Authorization: Bearer {{adminAccessToken}}
Content-Type: application/json

{
  "contentType": "image/png",
  "fileName": "diagram.png"
}
```

Verify students never receive `imagePath`; they receive an authorized short-lived `imageUrl` only when loading a question.

### S4. Enrollment import and management

Branch:

```text
feature/sanyam-enrollments
```

Endpoints:

```http
POST  /v1/admin/quizzes/:quizId/enrollments/import
GET   /v1/admin/quizzes/:quizId/enrollments
PATCH /v1/admin/enrollments/:enrollmentId
```

Implement:

1. Parse a bounded multipart CSV upload.
2. Require email, roll number, and branch code.
3. Normalize email with trim/lowercase before checking uniqueness.
4. Report invalid and conflicting rows without leaking unrelated student data.
5. Link existing profiles only when verified identity and roster rules match.
6. Paginate enrollment listing.
7. Allow controlled roster corrections and eligibility revocation.

Postman CSV import:

1. Select **Body -> form-data**.
2. Add key `file` with type **File**.
3. Choose a CSV containing columns agreed by the contract/service parser.
4. Send with the admin token.
5. Verify created, updated, rejected, and error counts.

Test duplicate emails differing only by case/space, duplicate roll numbers, invalid rows, and revoked enrollment behavior.

### S5. Student discovery and admin reporting

Branch:

```text
feature/sanyam-quiz-discovery-reporting
```

Endpoints:

```http
GET /v1/quiz-series
GET /v1/quiz-series/:seriesId/quizzes
GET /v1/quizzes/:quizId
GET /v1/admin/quizzes/:quizId/summary
GET /v1/admin/quizzes/:quizId/results/export
```

Implement:

- Return only quizzes assigned to the authenticated student.
- Enforce completed profile, active account, and eligible enrollment.
- Calculate availability from backend time and lifecycle state.
- Do not return question content from quiz detail.
- Use database aggregates for summaries.
- Stream bounded CSV results without phone numbers.

## Param: Attempts, Answers, Violations, and Results

Param owns the most concurrency-sensitive code. Keep transactions short and follow the documented lock ordering exactly.

### P0. Pure randomization and scoring functions

Branch:

```text
feature/param-scoring-randomization
```

Before attempt routes are available, implement pure tested functions inside `src/modules/attempts/service.ts` or a small domain-specific file only if justified.

Cover:

- Stable shuffled question order from supplied randomness.
- Stable shuffled option order.
- Positive marks for correct answers.
- Negative marks for incorrect answers.
- Zero for unanswered or cleared answers.
- Negative final scores are allowed.
- Maximum score and answer counts.

Do not query the database from pure functions.

### P1. Start/resume attempt and question delivery

Branch:

```text
feature/param-attempt-start-question
```

Create:

```text
src/modules/attempts/routes.ts
src/modules/attempts/schema.ts
src/modules/attempts/service.ts
src/modules/attempts/service.test.ts
```

Endpoints:

```http
POST /v1/quizzes/:quizId/attempts
GET  /v1/attempts/:attemptId
GET  /v1/attempts/:attemptId/questions/:displayOrder
```

Implement start/resume:

1. Require active student, completed profile, and eligible enrollment.
2. Require published, enabled quiz within server schedule for a new attempt.
3. Resume an existing in-progress attempt even if the quiz is later disabled.
4. Reject a submitted attempt with `QUIZ_ALREADY_ATTEMPTED`.
5. Set server-controlled `startedAt` and `expiresAt`.
6. Set expiry to the earlier of duration and quiz end.
7. Create randomized immutable `attempt_questions` in the same transaction.
8. Rely on unique `(quiz_id, user_id)` for concurrent starts.

Implement question delivery:

1. Authorize attempt ownership.
2. Enforce expiry and state.
3. Fetch one snapshot, its ordered options, and saved answer within the query budget.
4. Return `Cache-Control: no-store`.
5. Never return correctness or marks.
6. Sign a private image URL only when the current question has an image.

Postman sequence:

```http
POST {{baseUrl}}/v1/quizzes/{{quizId}}/attempts
Authorization: Bearer {{studentAccessToken}}
```

Save the attempt ID:

```javascript
const body = pm.response.json();
pm.environment.set('attemptId', body.id ?? body.attemptId);
```

Then:

```http
GET {{baseUrl}}/v1/attempts/{{attemptId}}/questions/1
Authorization: Bearer {{studentAccessToken}}
```

Verify `Cache-Control: no-store`, at least two options, and absence of `isCorrect`, positive marks, and negative marks.

### P2. Revision-safe answers and submission

Branch:

```text
feature/param-answer-submit
```

Create only the justified query helper:

```text
src/modules/attempts/queries.ts
```

Endpoints:

```http
PUT  /v1/attempts/:attemptId/answers/:questionId
POST /v1/attempts/:attemptId/submit
```

Answer save transaction:

1. Lock the attempt row.
2. Validate ownership, `IN_PROGRESS` state, and expiry under the lock.
3. Confirm the question belongs to the attempt.
4. Confirm a selected option belongs to that question.
5. Run one parameterized `INSERT ... ON CONFLICT` helper.
6. Accept only a higher revision.
7. Return the current saved value for an identical retry.
8. Reject the same revision with different content as `REVISION_CONFLICT`.
9. Reject lower revisions as `STALE_ANSWER_REVISION` and include current revision.
10. Treat `selectedOptionId: null` as a revisioned clear tombstone.

Submission transaction:

1. Lock the same attempt row.
2. Make repeated submission idempotent.
3. Read snapshots and answers using bounded/set-based queries.
4. Calculate score synchronously.
5. Store submission reason, timestamps, score, maximum score, and counts together.
6. Reject all later answer writes.

Postman answer request:

```http
PUT {{baseUrl}}/v1/attempts/{{attemptId}}/answers/{{questionId}}
Authorization: Bearer {{studentAccessToken}}
Content-Type: application/json

{
  "selectedOptionId": "{{optionId}}",
  "clientRevision": 1,
  "idempotencyKey": "{{$guid}}"
}
```

Postman revision tests:

1. Repeat exactly the same revision/content and expect success/current state.
2. Send revision `1` with another option and expect `REVISION_CONFLICT`.
3. Send revision `2` and expect success.
4. Send revision `1` again and expect `STALE_ANSWER_REVISION`.
5. Send revision `3` with `selectedOptionId: null` and verify it clears safely.

Submit:

```http
POST {{baseUrl}}/v1/attempts/{{attemptId}}/submit
Authorization: Bearer {{studentAccessToken}}
```

Repeat submission and verify the same submitted state is returned.

### P3. Violations and force submission

Branch:

```text
feature/param-violations
```

Create:

```text
src/modules/violations/routes.ts
src/modules/violations/schema.ts
src/modules/violations/service.ts
src/modules/violations/service.test.ts
```

Endpoints:

```http
POST /v1/attempts/:attemptId/violations
GET  /v1/admin/attempts/:attemptId/violations
```

Implement:

1. Accept at most 20 events.
2. Accept only documented event types.
3. Validate timestamps and bounded object metadata.
4. Reject camera frames, audio, recordings, face data, and ML output.
5. Deduplicate by client event ID and cooldown policy.
6. Store every accepted event's qualification decision.
7. Lock the attempt before incrementing the qualifying count.
8. Return warning for counts 1-3 and final warning for count 4.
9. At count 5, synchronously submit/score once and set review status to `PENDING`.
10. Reuse Param's submission service rather than duplicating scoring logic.

Postman request:

```http
POST {{baseUrl}}/v1/attempts/{{attemptId}}/violations
Authorization: Bearer {{studentAccessToken}}
Content-Type: application/json

{
  "events": [
    {
      "eventId": "{{$guid}}",
      "type": "TAB_HIDDEN",
      "occurredAt": "2026-09-01T09:10:00Z",
      "metadata": { "hiddenDurationMs": 4200 }
    }
  ]
}
```

Test duplicate event IDs, malformed metadata, more than 20 events, warning counts, and exactly-once fifth-event force submission.

### P4. Admin attempts, review, results, and leaderboard

Branch:

```text
feature/param-results-review
```

Endpoints:

```http
GET  /v1/admin/quizzes/:quizId/attempts
GET  /v1/admin/attempts/:attemptId
POST /v1/admin/attempts/:attemptId/submit
POST /v1/admin/attempts/:attemptId/review
POST /v1/admin/quizzes/:quizId/results/publish
GET  /v1/admin/quizzes/:quizId/leaderboard
GET  /v1/attempts/:attemptId/result
GET  /v1/attempts/:attemptId/review
GET  /v1/quizzes/:quizId/leaderboard
```

Implement:

- Paginate admin attempt lists.
- Use the same idempotent submission service for admin force-submit with reason `ADMIN`.
- Append an immutable `attempt_reviews` row and update current review state in one transaction.
- Publish results idempotently only after required finalization.
- Hide student scores, answer keys, and leaderboard before publication.
- Deny normal results/review to disqualified attempts.
- Use database aggregate/window queries for leaderboard ranking.
- Return answer correctness only in published per-question review.

Postman review request:

```http
POST {{baseUrl}}/v1/admin/attempts/{{attemptId}}/review
Authorization: Bearer {{adminAccessToken}}
Content-Type: application/json

{
  "decision": "APPROVED",
  "note": "Reviewed by proctor"
}
```

Before publishing results, verify student result/review endpoints return `RESULTS_NOT_PUBLISHED`. Publish as admin, then verify approved students can read results and answer review, while disqualified students receive `ATTEMPT_DISQUALIFIED`.

## End-to-End Postman Run Order

Run this after the three main modules are merged:

1. `GET /health/live` and `/health/ready`.
2. Admin authentication token is available.
3. Admin creates a quiz series.
4. Admin creates a draft quiz.
5. Admin adds valid questions/options.
6. Admin imports a student enrollment.
7. Student signs in and completes onboarding.
8. Admin publishes and enables the quiz.
9. Student lists assigned series/quizzes.
10. Student starts an attempt.
11. Student loads question 1.
12. Student saves, changes, retries, and clears an answer using revisions.
13. Student submits.
14. Student result remains hidden.
15. Admin inspects the attempt and publishes results.
16. Student reads result, review, and leaderboard.
17. Run a separate attempt to test five qualifying violations and admin review.

For every endpoint test at least:

- Successful authorized request.
- Missing token.
- Wrong role.
- Invalid request body/path.
- Resource not found in caller scope.
- Important lifecycle conflict.
- Repeated/idempotent request where documented.

## Pull Request Size and Review

Do not combine an entire developer assignment into one pull request. Target one vertical slice or approximately 3-8 endpoints per pull request, depending on complexity.

Every pull request description should state:

1. Documented behavior implemented.
2. Endpoints added or changed.
3. Authorization rules.
4. Database transaction/locking behavior.
5. Tests added.
6. Commands run.
7. Postman scenarios manually verified.
8. Remaining dependency or risk.

Authentication, migration, scoring, answer revision, submission, and violation-enforcement changes require careful peer review.

## Definition of Done for Each Task

A task is complete only when:

- Route paths and wire schemas match `docs/openapi.yaml`.
- Zod validation is implemented.
- Authentication, role, ownership, enrollment, and lifecycle checks are server-side.
- Prisma queries are bounded and avoid N+1 behavior.
- Race-sensitive behavior uses the documented unique constraints, revisions, idempotency, or attempt-row locks.
- Unit/API/integration tests cover success and meaningful failures.
- Postman verification is documented in the pull request.
- No secrets, correct answers, signed URLs, stack traces, or camera data are leaked.
- Formatting, linting, typechecking, tests, build, Prisma validation, OpenAPI lint, and `git diff --check` pass.
