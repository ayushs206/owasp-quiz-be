# API Contract

## Conventions

- Base path: `/v1`.
- Transport: HTTPS and JSON.
- Authentication: `Authorization: Bearer <supabase-jwt>`.
- Timestamps: ISO 8601 UTC strings.
- IDs: UUID strings.
- Validation: Zod schemas implemented from this contract.
- Student identity comes from Google OAuth through Supabase; onboarding never accepts an email field from the client.
- Student endpoints enforce ownership and enrollment.
- Admin endpoints require the application `ADMIN` role.

Successful list responses use:

```json
{
  "data": [],
  "nextCursor": null
}
```

Errors use `application/problem+json`:

```json
{
  "type": "https://quiz.example/problems/attempt-expired",
  "title": "Attempt expired",
  "status": 409,
  "code": "ATTEMPT_EXPIRED",
  "detail": "The attempt can no longer accept answers.",
  "requestId": "uuid"
}
```

## Common status codes

| Status | Meaning |
| --- | --- |
| `200` | Successful read, update, or idempotent mutation. |
| `201` | Resource created. |
| `400` | Invalid request shape or value. |
| `401` | Missing or invalid Supabase JWT. |
| `403` | Authenticated but not permitted. |
| `404` | Resource not found within the caller's scope. |
| `409` | State conflict, expiry, stale revision, or immutable resource. |
| `413` | Batch or metadata payload too large. |
| `429` | Rate limit exceeded. |
| `503` | Temporary database or dependency failure; retry is allowed. |

## Health endpoints

### `GET /health/live`

Unauthenticated process liveness check. Returns `200` with `{ "status": "ok" }` without calling dependencies.

### `GET /health/ready`

Unauthenticated dependency readiness check. Returns `200` with `{ "status": "ready" }` only when required dependencies are available, otherwise `503 SERVICE_NOT_READY` using the standard problem response.

## Student endpoints

### `GET /v1/quiz-series`

Returns series containing at least one quiz assigned to the authenticated student. Each item includes `seriesId`, title, description, and `quizCount`.

### `GET /v1/quiz-series/:seriesId/quizzes`

Returns the authenticated student's assigned quizzes in the series. Child quizzes retain their own schedule, duration, availability, attempt, and result state.

### `GET /v1/me`

Returns the authenticated application profile or the first-login onboarding requirement. The email comes from the verified Google identity and is read-only.

```json
{
  "id": "uuid",
  "email": "student@example.edu",
  "fullName": null,
  "rollNumber": null,
  "branchCode": null,
  "phoneNumber": null,
  "role": "STUDENT",
  "status": "ACTIVE",
  "onboardingStatus": "REQUIRED"
}
```

If the authenticated Google identity is not an allowed TIET account or has no eligible roster entry, return `403 ACCOUNT_NOT_REGISTERED` and do not allow onboarding.

### `POST /v1/onboarding`

Completes the student profile after the first successful Google login.

```json
{
  "fullName": "Student Name",
  "rollNumber": "102300001",
  "branchCode": "CSE",
  "phoneNumber": "+919876543210"
}
```

Rules:

- The request must contain a valid Supabase JWT created through Google OAuth.
- Email is taken only from the verified JWT and must not appear in the body.
- Roll number and branch must match the eligible roster row for that email.
- Roll number must not belong to another profile.
- Phone number must be normalized to E.164 format.
- Repeating the same completed request is idempotent.
- Changing email, roll number, or branch after completion requires an admin correction flow.

Response:

```json
{
  "id": "uuid",
  "email": "student@example.edu",
  "fullName": "Student Name",
  "rollNumber": "102300001",
  "branchCode": "CSE",
  "phoneNumber": "+919876543210",
  "role": "STUDENT",
  "status": "ACTIVE",
  "onboardingStatus": "COMPLETED",
  "profileCompletedAt": "2026-08-08T09:00:00Z"
}
```

### `GET /v1/quizzes/:quizId`

Returns title, description, instructions, schedule, duration, availability, and whether an attempt already exists. It never returns questions or answer keys.

### `POST /v1/quizzes/:quizId/attempts`

Starts or resumes the single allowed attempt.

The request is rejected with `403 PROFILE_INCOMPLETE` until onboarding is complete.

It also requires the quiz to be published, enabled, and within its server-side schedule. An existing in-progress attempt is resumed even if the quiz was subsequently disabled. A submitted or scored attempt returns `409 QUIZ_ALREADY_ATTEMPTED`.

Response:

```json
{
  "id": "uuid",
  "quizId": "uuid",
  "status": "IN_PROGRESS",
  "startedAt": "2026-08-08T10:00:00Z",
  "expiresAt": "2026-08-08T10:30:00Z",
  "questionCount": 30,
  "serverTime": "2026-08-08T10:00:00Z",
  "resumed": false
}
```

Concurrent calls return the same attempt because one attempt is allowed per student and quiz.

### `GET /v1/attempts/:attemptId`

Returns attempt timing, status, submission reason, warning count, review status, and server time. It does not expose another student's attempt.

### `GET /v1/attempts/:attemptId/questions/:displayOrder`

Returns one question from the immutable attempt-specific order. The backend validates ownership, state, and expiry on every request and sets `Cache-Control: no-store`.

```json
{
  "attemptId": "uuid",
  "questionCount": 30,
  "question": {
    "questionId": "uuid",
    "displayOrder": 1,
    "prompt": "Question text",
    "imageUrl": null,
    "options": [
      { "optionId": "uuid", "text": "Option A" },
      { "optionId": "uuid", "text": "Option B" }
    ],
    "savedAnswer": {
      "selectedOptionId": "uuid",
      "clientRevision": 3
    }
  },
  "hasPrevious": false,
  "hasNext": true
}
```

Private image URLs are short-lived. Correctness and marks are not included. The frontend may prefetch only the next display position; the complete question set is never returned in one response.

### `PUT /v1/attempts/:attemptId/answers/:questionId`

Persists one answer directly to PostgreSQL.

Request:

```json
{
  "selectedOptionId": "uuid",
  "clientRevision": 4,
  "idempotencyKey": "uuid"
}
```

Response after database commit:

```json
{
  "attemptId": "uuid",
  "questionId": "uuid",
  "selectedOptionId": "uuid",
  "clientRevision": 4,
  "savedAt": "2026-08-08T10:05:00Z",
  "status": "SAVED"
}
```

Rules:

- Selecting an option updates IndexedDB only; this endpoint is called when Next, Previous, or Submit needs to persist a changed answer.
- Unanswered or unchanged questions do not call this endpoint.
- `clientRevision` is a positive integer that increases per question.
- A duplicate mutation with the same revision and content returns the current saved state.
- The same revision with different content returns `409 REVISION_CONFLICT`.
- A lower revision returns `409 STALE_ANSWER_REVISION` with the current revision.
- Answers are rejected after expiry or submission.
- Success means the answer is committed to PostgreSQL.
- `selectedOptionId: null` clears a previous answer at the supplied revision. The nullable stored selection remains as a revision tombstone and scores as unanswered.

### `POST /v1/attempts/:attemptId/violations`

Accepts at most 20 events per request.

```json
{
  "events": [
    {
      "eventId": "uuid",
      "type": "TAB_HIDDEN",
      "occurredAt": "2026-08-08T10:10:00Z",
      "metadata": {
        "hiddenDurationMs": 4200
      }
    }
  ]
}
```

Response:

```json
{
  "qualifyingViolationCount": 3,
  "action": "WARNING",
  "attemptStatus": "IN_PROGRESS"
}
```

`action` is one of `NONE`, `WARNING`, `FINAL_WARNING`, or `FORCE_SUBMITTED`.

This endpoint does not accept camera frames, audio, recordings, face data, confidence values, or ML output. Camera permission and the live preview are frontend-only behavior.

### `POST /v1/attempts/:attemptId/submit`

Idempotently submits the attempt. Repeated calls return the existing submitted state.

The backend calculates and stores the score in the same database transaction. The score remains hidden from this response until results are published.

```json
{
  "attemptId": "uuid",
  "status": "SUBMITTED",
  "submissionReason": "USER",
  "submittedAt": "2026-08-08T10:25:00Z"
}
```

### `GET /v1/attempts/:attemptId/result`

Returns `403 RESULTS_NOT_PUBLISHED` until an admin publishes results. A disqualified attempt does not expose a normal score response.

### `GET /v1/attempts/:attemptId/review`

After result publication, returns each immutable attempt question with the student's final selection, the correct option, and awarded marks. Before publication it returns `403 RESULTS_NOT_PUBLISHED`; disqualified attempts return `403 ATTEMPT_DISQUALIFIED`. Responses use `Cache-Control: no-store`.

### `GET /v1/quizzes/:quizId/leaderboard`

Returns a paginated leaderboard only after publication. The public student identifier must follow institutional privacy requirements.

## Admin endpoints

### Quiz-series management

- `POST /v1/admin/quiz-series`
- `GET /v1/admin/quiz-series`
- `GET /v1/admin/quiz-series/:seriesId`
- `PATCH /v1/admin/quiz-series/:seriesId`
- `DELETE /v1/admin/quiz-series/:seriesId`

A series groups independently scheduled quizzes. Deletion is allowed only when the series contains no quizzes; draft child quizzes must be deleted explicitly first.

### Quiz management

- `POST /v1/admin/quizzes`
- `GET /v1/admin/quizzes`
- `GET /v1/admin/quizzes/:quizId`
- `PATCH /v1/admin/quizzes/:quizId`
- `POST /v1/admin/quizzes/:quizId/publish`
- `POST /v1/admin/quizzes/:quizId/enable`
- `POST /v1/admin/quizzes/:quizId/disable`
- `POST /v1/admin/quizzes/:quizId/close`
- `POST /v1/admin/quizzes/:quizId/clone`
- `DELETE /v1/admin/quizzes/:quizId`
- `GET /v1/admin/quizzes/:quizId/summary`
- `GET /v1/admin/quizzes/:quizId/results/export`

Only draft quizzes are editable. Publication validates schedule, question count, option count, and exactly one correct option per question. Enable/disable is idempotent. Disabling blocks new attempts without interrupting active attempts. Closing is final and synchronously finalizes active attempts in bounded database batches.

Draft deletion is rejected after publication or once an attempt exists. The summary endpoint returns database aggregate counts. Result export is available only to admins and produces a bounded, streaming CSV without phone numbers.

### Question management

- `GET /v1/admin/quizzes/:quizId/questions`
- `POST /v1/admin/quizzes/:quizId/questions`
- `POST /v1/admin/quizzes/:quizId/questions/import`
- `GET /v1/admin/questions/:questionId`
- `PATCH /v1/admin/questions/:questionId`
- `DELETE /v1/admin/questions/:questionId`
- `POST /v1/admin/questions/:questionId/image-url`

The image URL endpoint returns a short-lived signed upload URL for a private Supabase Storage path.

Question lists are paginated. Batch import accepts a validated bounded JSON payload, reports row-level errors, and is atomic only when explicitly requested; it never modifies a published quiz.

### User administration

- `GET /v1/admin/users`
- `GET /v1/admin/users/:userId`
- `PATCH /v1/admin/users/:userId`

The update endpoint supports controlled role, account status, name, roll number, branch, and phone corrections. Verified identity email and Supabase user ID cannot be replaced through this endpoint. Role/status and identity corrections are audit logged.

### Roster management

- `POST /v1/admin/quizzes/:quizId/enrollments/import`
- `GET /v1/admin/quizzes/:quizId/enrollments`
- `PATCH /v1/admin/enrollments/:enrollmentId`

Roster imports require email, roll number, and branch code; the optional roster name is used for admin comparison. Imports normalize emails, report invalid/conflicting rows, and do not create duplicate enrollments.

### Attempts and violations

- `GET /v1/admin/quizzes/:quizId/attempts`
- `GET /v1/admin/attempts/:attemptId`
- `GET /v1/admin/attempts/:attemptId/violations`
- `POST /v1/admin/attempts/:attemptId/review`
- `POST /v1/admin/attempts/:attemptId/submit`

Review request:

```json
{
  "decision": "APPROVED",
  "note": "Reviewed by proctor"
}
```

Every review decision is logged with the acting admin and request ID.

Single-attempt admin submission is idempotent, uses submission reason `ADMIN`, and follows the same lock-and-score transaction as normal submission.

### Results

- `POST /v1/admin/quizzes/:quizId/results/publish`
- `GET /v1/admin/quizzes/:quizId/leaderboard`

Scores are stored on attempts during synchronous submission. Publishing is idempotent.

## Rate-limit groups

Exact limits are environment configuration, not hard-coded contract values.

- General authenticated reads: per user.
- Answer writes: per user and attempt, allowing normal rapid navigation.
- Violation events: per attempt with strict body-size limits.
- Admin imports and publication: per admin.

## Required edge-case behavior

| Situation | API behavior |
| --- | --- |
| First login with an eligible Google account | Return `onboardingStatus: REQUIRED` until `POST /v1/onboarding` succeeds. |
| Login uses a different Google account | Return `403 ACCOUNT_NOT_REGISTERED`; do not match by submitted roll number. |
| Google email is outside configured TIET domains | Return `403 EMAIL_DOMAIN_NOT_ALLOWED`. |
| Onboarding roll or branch does not match roster | Return `409 ROSTER_DETAILS_MISMATCH`. |
| Roll number is already linked to another identity | Return `409 ROLL_NUMBER_ALREADY_REGISTERED`. |
| Onboarding is submitted twice | Return the existing completed profile when the data matches. |
| Student attempts to edit email, roll, or branch | Reject and require an admin correction. |
| Published quiz is disabled | Reject new attempts with `403 QUIZ_DISABLED`; allow an existing attempt to resume. |
| Quiz is manually closed | Reject new starts and answers; submit remaining active attempts. |
| Concurrent attempt starts | Return the single existing or newly created attempt. |
| Submitted student tries to start again | Return `409 QUIZ_ALREADY_ATTEMPTED`. |
| Answer races with submission | The operation that obtains the attempt lock first completes; the other observes the resulting state. |
| Duplicate answer retry | Return the current saved answer without creating another row. |
| Same revision, different option | Return `409 REVISION_CONFLICT`. |
| Lower answer revision | Return `409 STALE_ANSWER_REVISION` and the current revision. |
| Option belongs to another question | Return `400 INVALID_QUESTION_OPTION`. |
| Save arrives after expiry | Return `409 ATTEMPT_EXPIRED`. |
| Save arrives after submission | Return `409 ATTEMPT_SUBMITTED`. |
| Student clears an answer | Persist `selectedOptionId: null` only when its revision is newer; score it as unanswered. |
| Database result is unknown to the client after timeout | Client retries the same revision and idempotency key. |
| Manual submit is repeated | Return the existing submitted state with `200`. |
| Result is not published | Return `403 RESULTS_NOT_PUBLISHED`. |
| Attempt is disqualified | Return `403 ATTEMPT_DISQUALIFIED` instead of the normal score payload. |
| Browser timer reaches zero | Exit the quiz immediately; backend time rejects later writes and the next request finalizes the attempt as expired. |
| Violation event is duplicated | Store/count it at most once and return the current warning count. |
| Violation payload is malformed or too large | Reject it without increasing the qualifying count. |
| Browser is offline after changing an answer | Keep it in IndexedDB and block unseen-question navigation until the PUT succeeds. |

## Query-shape expectations

- Quiz lists are paginated and include their availability in a bounded query plan.
- One question request loads its snapshot, ordered options, and saved answer with one bounded query shape.
- One changed answer produces one locked, revision-aware upsert when navigation or submission occurs.
- Admin counts use database aggregates rather than application-side loops.
- Leaderboards use a set-based aggregate/window query.
- API implementations must not execute Prisma calls inside loops over unbounded collections.

## Compatibility

- Breaking changes require a new API version.
- Additive response fields are allowed within `/v1`.
- Clients must ignore unknown response fields.
- Enum additions that change client behavior require coordinated frontend support.
