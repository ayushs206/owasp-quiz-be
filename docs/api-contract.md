# API Contract

## Conventions

- Base path: `/v1`.
- Transport: HTTPS and JSON.
- Authentication: `Authorization: Bearer <supabase-jwt>`.
- Timestamps: ISO 8601 UTC strings.
- IDs: UUID strings.
- Validation: Zod schemas implemented from this contract.
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

## Student endpoints

### `GET /v1/me`

Returns the authenticated application profile.

```json
{
  "id": "uuid",
  "email": "student@example.edu",
  "fullName": "Student Name",
  "role": "STUDENT",
  "status": "ACTIVE"
}
```

### `GET /v1/quizzes`

Returns quizzes for which the student has an eligible roster entry. Supports cursor pagination and optional status filtering.

### `GET /v1/quizzes/:quizId`

Returns title, description, instructions, schedule, duration, availability, and whether an attempt already exists. It never returns questions or answer keys.

### `POST /v1/quizzes/:quizId/attempts`

Starts or resumes the single allowed attempt.

Response:

```json
{
  "id": "uuid",
  "quizId": "uuid",
  "status": "IN_PROGRESS",
  "startedAt": "2026-08-08T10:00:00Z",
  "expiresAt": "2026-08-08T10:30:00Z",
  "serverTime": "2026-08-08T10:00:00Z",
  "resumed": false
}
```

Concurrent calls return the same attempt because one attempt is allowed per student and quiz.

### `GET /v1/attempts/:attemptId`

Returns attempt timing, status, submission reason, warning count, review status, and server time. It does not expose another student's attempt.

### `GET /v1/attempts/:attemptId/questions`

Returns the immutable attempt-specific display order:

```json
{
  "attemptId": "uuid",
  "questions": [
    {
      "id": "uuid",
      "displayOrder": 1,
      "prompt": "Question text",
      "imageUrl": null,
      "options": [
        { "id": "uuid", "text": "Option A" },
        { "id": "uuid", "text": "Option B" }
      ],
      "savedAnswer": {
        "selectedOptionId": "uuid",
        "clientRevision": 3
      }
    }
  ]
}
```

Private image URLs are short-lived. Correctness and marks are not included.

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

- `clientRevision` is a positive integer that increases per question.
- A duplicate mutation with the same revision and content returns the current saved state.
- The same revision with different content returns `409 REVISION_CONFLICT`.
- A lower revision returns `409 STALE_ANSWER_REVISION` with the current revision.
- Answers are rejected after expiry or submission.
- Success means the answer is committed to PostgreSQL.

### `POST /v1/attempts/:attemptId/answers/sync`

Synchronizes up to 100 offline mutations.

```json
{
  "answers": [
    {
      "questionId": "uuid",
      "selectedOptionId": "uuid",
      "clientRevision": 4,
      "idempotencyKey": "uuid"
    }
  ]
}
```

The response reports each item as `SAVED`, `DUPLICATE`, `STALE`, or `REJECTED`. The frontend removes only confirmed mutations from IndexedDB.

The API locks the attempt once for a bounded batch, validates that it is still active, and then applies revision-aware upserts. It does not issue one ownership query per answer.

### `POST /v1/attempts/:attemptId/violations`

Accepts at most 20 events per request.

```json
{
  "events": [
    {
      "eventId": "uuid",
      "source": "ML",
      "type": "MULTIPLE_FACES",
      "confidence": 0.98,
      "durationMs": 4200,
      "detectorVersion": "face-detector-1",
      "occurredAt": "2026-08-08T10:10:00Z",
      "metadata": {}
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

### `POST /v1/attempts/:attemptId/submit`

Idempotently submits the attempt. Repeated calls return the existing submitted state.

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

### `GET /v1/quizzes/:quizId/leaderboard`

Returns a paginated leaderboard only after publication. The public student identifier must follow institutional privacy requirements.

## Admin endpoints

### Quiz management

- `POST /v1/admin/quizzes`
- `GET /v1/admin/quizzes`
- `GET /v1/admin/quizzes/:quizId`
- `PATCH /v1/admin/quizzes/:quizId`
- `POST /v1/admin/quizzes/:quizId/publish`
- `POST /v1/admin/quizzes/:quizId/close`
- `POST /v1/admin/quizzes/:quizId/clone`

Only draft quizzes are editable. Publication validates schedule, question count, option count, and exactly one correct option per question.

### Question management

- `POST /v1/admin/quizzes/:quizId/questions`
- `PATCH /v1/admin/questions/:questionId`
- `DELETE /v1/admin/questions/:questionId`
- `POST /v1/admin/questions/:questionId/image-url`

The image URL endpoint returns a short-lived signed upload URL for a private Supabase Storage path.

### Roster management

- `POST /v1/admin/quizzes/:quizId/enrollments/import`
- `GET /v1/admin/quizzes/:quizId/enrollments`
- `PATCH /v1/admin/enrollments/:enrollmentId`

Roster imports accept CSV, normalize emails, report invalid rows, and do not create duplicate enrollments.

### Attempts and violations

- `GET /v1/admin/quizzes/:quizId/attempts`
- `GET /v1/admin/attempts/:attemptId`
- `GET /v1/admin/attempts/:attemptId/violations`
- `POST /v1/admin/attempts/:attemptId/review`

Review request:

```json
{
  "decision": "APPROVED",
  "note": "Reviewed by proctor"
}
```

Every review decision creates an audit log.

### Results

- `POST /v1/admin/quizzes/:quizId/results/recalculate`
- `POST /v1/admin/quizzes/:quizId/results/publish`
- `GET /v1/admin/quizzes/:quizId/leaderboard`

Publishing is idempotent and audited.

## Rate-limit groups

Exact limits are environment configuration, not hard-coded contract values.

- General authenticated reads: per user.
- Answer writes: per user and attempt, allowing normal rapid navigation.
- Offline sync: lower request frequency with a larger bounded payload.
- Violation events: per attempt with strict body-size limits.
- Admin imports and publication: per admin.

## Required edge-case behavior

| Situation | API behavior |
| --- | --- |
| Concurrent attempt starts | Return the single existing or newly created attempt. |
| Answer races with submission | The operation that obtains the attempt lock first completes; the other observes the resulting state. |
| Duplicate answer retry | Return the current saved answer without creating another row. |
| Same revision, different option | Return `409 REVISION_CONFLICT`. |
| Lower answer revision | Return `409 STALE_ANSWER_REVISION` and the current revision. |
| Option belongs to another question | Return `400 INVALID_QUESTION_OPTION`. |
| Save arrives after expiry | Return `409 ATTEMPT_EXPIRED`. |
| Save arrives after submission | Return `409 ATTEMPT_SUBMITTED`. |
| Database result is unknown to the client after timeout | Client retries the same revision and idempotency key. |
| Manual submit is repeated | Return the existing submitted state with `200`. |
| Worker is unavailable after submission | Submission remains successful; scoring recovery handles the missing result. |
| Result is not published | Return `403 RESULTS_NOT_PUBLISHED`. |
| Attempt is disqualified | Return `403 ATTEMPT_DISQUALIFIED` instead of the normal score payload. |
| Violation event is duplicated | Store/count it at most once and return the current warning count. |
| Violation payload is malformed or too large | Reject it without increasing the qualifying count. |

## Query-shape expectations

- Quiz lists are paginated and include their availability in a bounded query plan.
- Attempt questions, options, and saved answers are loaded in no more than three database round trips.
- Batch answer sync locks the attempt once and performs set-based or bounded upserts.
- Admin counts use database aggregates rather than application-side loops.
- Leaderboards use a set-based aggregate/window query.
- API implementations must not execute Prisma calls inside loops over unbounded collections.

## Compatibility

- Breaking changes require a new API version.
- Additive response fields are allowed within `/v1`.
- Clients must ignore unknown response fields.
- Enum additions that change client behavior require coordinated frontend support.
