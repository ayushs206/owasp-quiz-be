# Database Design

## Principles

- PostgreSQL is the authoritative store.
- Prisma manages application tables in the application schema only.
- Supabase-managed `auth` and `storage` schemas are not modified by Prisma.
- Runtime traffic uses the pooled connection URL; migrations use the direct URL.
- IDs use UUIDs and timestamps use timezone-aware PostgreSQL timestamps.
- Destructive cascades are avoided for exam records and audit data.

## Entity relationship overview

```mermaid
erDiagram
    PROFILES ||--o{ QUIZZES : creates
    PROFILES ||--o{ QUIZ_ENROLLMENTS : links
    QUIZZES ||--o{ QUIZ_ENROLLMENTS : contains
    QUIZZES ||--o{ QUESTIONS : contains
    QUESTIONS ||--o{ QUESTION_OPTIONS : has
    PROFILES ||--o{ ATTEMPTS : makes
    QUIZZES ||--o{ ATTEMPTS : receives
    ATTEMPTS ||--o{ ATTEMPT_QUESTIONS : snapshots
    QUESTIONS ||--o{ ATTEMPT_QUESTIONS : selected_for
    ATTEMPTS ||--o{ ANSWERS : records
    QUESTIONS ||--o{ ANSWERS : answered_by
    QUESTION_OPTIONS ||--o{ ANSWERS : selected_as
    ATTEMPTS ||--o{ VIOLATION_EVENTS : receives
    ATTEMPTS ||--o{ VIOLATION_INCIDENTS : counts
    VIOLATION_EVENTS ||--o| VIOLATION_INCIDENTS : qualifies_as
    ATTEMPTS ||--o| ATTEMPT_RESULTS : produces
    PROFILES ||--o{ AUDIT_LOGS : performs

    PROFILES {
        uuid id PK
        string normalized_email UK
        user_role role
        account_status status
    }

    QUIZZES {
        uuid id PK
        string title
        int duration_minutes
        datetime starts_at
        datetime ends_at
        quiz_status status
        uuid created_by FK
    }

    QUIZ_ENROLLMENTS {
        uuid id PK
        uuid quiz_id FK
        uuid user_id FK
        string normalized_email
        enrollment_status status
    }

    QUESTIONS {
        uuid id PK
        uuid quiz_id FK
        string prompt
        string image_path
        decimal positive_marks
        decimal negative_marks
    }

    QUESTION_OPTIONS {
        uuid id PK
        uuid question_id FK
        string text
        boolean is_correct
    }

    ATTEMPTS {
        uuid id PK
        uuid quiz_id FK
        uuid user_id FK
        attempt_status status
        datetime started_at
        datetime expires_at
        int qualifying_violation_count
        review_status review_status
    }

    ATTEMPT_QUESTIONS {
        uuid attempt_id PK, FK
        uuid question_id PK, FK
        int display_order
        json option_order
        decimal positive_marks
        decimal negative_marks
    }

    ANSWERS {
        uuid id PK
        uuid attempt_id FK
        uuid question_id FK
        uuid selected_option_id FK
        bigint client_revision
        datetime answered_at
    }

    VIOLATION_EVENTS {
        uuid id PK
        uuid attempt_id FK
        violation_source source
        string type
        decimal confidence
        int duration_ms
    }

    VIOLATION_INCIDENTS {
        uuid id PK
        uuid attempt_id FK
        uuid event_id FK
        int sequence_number
    }

    ATTEMPT_RESULTS {
        uuid attempt_id PK, FK
        decimal score
        decimal maximum_score
        int scoring_version
    }

    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        string action
        string entity_type
        uuid entity_id
    }
```

## Enums

| Enum | Values |
| --- | --- |
| `user_role` | `STUDENT`, `ADMIN` |
| `account_status` | `ACTIVE`, `BLOCKED` |
| `quiz_status` | `DRAFT`, `PUBLISHED`, `CLOSED`, `RESULTS_PUBLISHED` |
| `enrollment_status` | `ELIGIBLE`, `REVOKED` |
| `attempt_status` | `IN_PROGRESS`, `SUBMITTED`, `SCORED` |
| `submission_reason` | `USER`, `EXPIRED`, `VIOLATION`, `ADMIN` |
| `review_status` | `NOT_REQUIRED`, `PENDING`, `APPROVED`, `DISQUALIFIED` |
| `violation_source` | `BROWSER`, `ML` |

## Tables

### `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key; equals the Supabase authenticated user ID. |
| `email` | `text` | Original authenticated email. |
| `normalized_email` | `text` | Lowercase and trimmed; unique. |
| `full_name` | `text` | Nullable. |
| `role` | `user_role` | Defaults to `STUDENT`. |
| `status` | `account_status` | Defaults to `ACTIVE`. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Last update time. |

The Supabase user is the identity source. The application profile stores authorization data and does not duplicate password or session fields.

### `quizzes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `title` | `text` | Required. |
| `description` | `text` | Nullable. |
| `instructions` | `text` | Nullable. |
| `duration_minutes` | `integer` | Positive value. |
| `starts_at` | `timestamptz` | Quiz access start. |
| `ends_at` | `timestamptz` | Must be after `starts_at`. |
| `status` | `quiz_status` | Defaults to `DRAFT`. |
| `results_published_at` | `timestamptz` | Nullable. |
| `created_by` | `uuid` | References `profiles.id`. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Last update time. |

Published quiz content is immutable. A changed quiz is created as a new draft or cloned version.

### `quiz_enrollments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `quiz_id` | `uuid` | References `quizzes.id`. |
| `normalized_email` | `text` | Imported roster identity. |
| `user_id` | `uuid` | Nullable reference to `profiles.id`; linked after login. |
| `student_reference` | `text` | Nullable roll number or institutional ID. |
| `status` | `enrollment_status` | Defaults to `ELIGIBLE`. |
| `created_at` | `timestamptz` | Creation time. |

Unique constraints:

- `(quiz_id, normalized_email)`
- `(quiz_id, user_id)` when `user_id` is not null

### `questions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `quiz_id` | `uuid` | References `quizzes.id`. |
| `prompt` | `text` | Required question text. |
| `image_path` | `text` | Nullable private Supabase Storage path. |
| `positive_marks` | `numeric(8,2)` | Must be non-negative. |
| `negative_marks` | `numeric(8,2)` | Must be non-negative; zero disables negative marking. |
| `source_order` | `integer` | Admin ordering before randomization. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Last update time. |

### `question_options`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `question_id` | `uuid` | References `questions.id`. |
| `text` | `text` | Required unless an option image is supported later. |
| `is_correct` | `boolean` | Hidden from student APIs. |
| `source_order` | `integer` | Admin ordering before randomization. |
| `created_at` | `timestamptz` | Creation time. |

Constraints:

- Unique `(question_id, id)` to support composite answer integrity.
- Partial unique index on `question_id` where `is_correct = true` to allow at most one correct option.
- Publication validation requires exactly one correct option and at least two options.

### `attempts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `quiz_id` | `uuid` | References `quizzes.id`. |
| `user_id` | `uuid` | References `profiles.id`. |
| `status` | `attempt_status` | Defaults to `IN_PROGRESS`. |
| `started_at` | `timestamptz` | Set by the backend. |
| `expires_at` | `timestamptz` | Set by the backend. |
| `submitted_at` | `timestamptz` | Nullable. |
| `submission_reason` | `submission_reason` | Nullable until submission. |
| `qualifying_violation_count` | `integer` | Defaults to zero. |
| `review_status` | `review_status` | Defaults to `NOT_REQUIRED`. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Last update time. |

Unique constraint: `(quiz_id, user_id)`.

### `attempt_questions`

| Column | Type | Notes |
| --- | --- | --- |
| `attempt_id` | `uuid` | References `attempts.id`. |
| `question_id` | `uuid` | References `questions.id`. |
| `display_order` | `integer` | Randomized question position. |
| `option_order` | `jsonb` | Ordered array of option UUIDs. |
| `positive_marks` | `numeric(8,2)` | Snapshot at attempt creation. |
| `negative_marks` | `numeric(8,2)` | Snapshot at attempt creation. |

Primary key: `(attempt_id, question_id)`. Display order is unique per attempt.

### `answers`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `attempt_id` | `uuid` | References `attempts.id`. |
| `question_id` | `uuid` | References `questions.id`. |
| `selected_option_id` | `uuid` | References an option belonging to the same question. |
| `client_revision` | `bigint` | Monotonically increases per question. |
| `last_idempotency_key` | `text` | Last accepted client mutation key. |
| `answered_at` | `timestamptz` | Server acceptance time. |
| `updated_at` | `timestamptz` | Last update time. |

Constraints:

- Unique `(attempt_id, question_id)`.
- Foreign key `(attempt_id, question_id)` to `attempt_questions`.
- Foreign key `(question_id, selected_option_id)` to `question_options(question_id, id)`.
- Upserts update only when the incoming `client_revision` is greater.

### `violation_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `attempt_id` | `uuid` | References `attempts.id`. |
| `source` | `violation_source` | Browser rule or ML. |
| `type` | `text` | Stable event identifier. |
| `confidence` | `numeric(5,4)` | Nullable for browser events. |
| `duration_ms` | `integer` | Nullable. |
| `detector_version` | `text` | Nullable for browser events. |
| `client_occurred_at` | `timestamptz` | Client-reported event time. |
| `received_at` | `timestamptz` | Server time. |
| `metadata` | `jsonb` | Validated, size-limited metadata. |

### `violation_incidents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `attempt_id` | `uuid` | References `attempts.id`. |
| `event_id` | `uuid` | References the qualifying event. |
| `type` | `text` | Incident type. |
| `sequence_number` | `integer` | Warning/removal count. |
| `created_at` | `timestamptz` | Server time. |

Unique constraints: `(attempt_id, event_id)` and `(attempt_id, sequence_number)`.

### `attempt_results`

| Column | Type | Notes |
| --- | --- | --- |
| `attempt_id` | `uuid` | Primary key and reference to `attempts.id`. |
| `score` | `numeric(10,2)` | Final score. |
| `maximum_score` | `numeric(10,2)` | Snapshot-based maximum. |
| `correct_count` | `integer` | Correct answers. |
| `incorrect_count` | `integer` | Incorrect answers. |
| `unanswered_count` | `integer` | Unanswered questions. |
| `scoring_version` | `integer` | Supports controlled recalculation. |
| `scored_at` | `timestamptz` | Completion time. |

### `audit_logs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `actor_id` | `uuid` | Nullable reference to `profiles.id`. |
| `action` | `text` | Stable action identifier. |
| `entity_type` | `text` | Target category. |
| `entity_id` | `uuid` | Nullable target ID. |
| `metadata` | `jsonb` | Size-limited audit context. |
| `created_at` | `timestamptz` | Server time. |

Audit rows are append-only through application permissions.

## Required indexes

- `profiles(normalized_email)` unique.
- `quizzes(status, starts_at, ends_at)`.
- `quiz_enrollments(normalized_email, status)`.
- `quiz_enrollments(quiz_id, user_id)`.
- `questions(quiz_id, source_order)`.
- `attempts(user_id, status)`.
- `attempts(quiz_id, status)`.
- `attempts(status, expires_at)` for expiry scans.
- `answers(attempt_id)`.
- `violation_events(attempt_id, received_at)`.
- `violation_incidents(attempt_id, sequence_number)`.
- `attempt_results(scored_at)`.

Indexes should be confirmed with query plans after realistic load tests; speculative indexes are avoided.

## Transaction boundaries

### Attempt creation

- Validate eligibility and schedule.
- Insert the attempt.
- Insert randomized `attempt_questions`.
- Commit together.

### Answer save

- Lock the attempt row.
- Validate attempt ownership, state, and expiry under the lock.
- Execute one revision-aware upsert.
- Commit before returning success.

### Submission

- Lock the attempt row.
- Set submission state only if still in progress.
- Commit before enqueueing scoring.

### Qualifying violation

- Insert the event and deduplicated incident.
- Lock and increment the attempt counter.
- Force submission when the count reaches five.
- Commit as one unit.

### Scoring

- Lock or idempotently check the result row.
- Read the attempt snapshot and answers.
- Insert the result and move the attempt to `SCORED`.
- Commit together.

## Concurrency invariants

- Attempt creation relies on the unique `(quiz_id, user_id)` constraint rather than a read-then-insert assumption.
- Answer save, submission, expiry, and qualifying-violation transitions lock the same attempt row.
- The answer upsert updates only when the incoming revision is higher.
- The same revision with different content is rejected instead of choosing an arbitrary winner.
- One result row per attempt makes scoring retries idempotent.
- Unique event and incident constraints prevent duplicate violation counts.
- PostgreSQL's normal `READ COMMITTED` isolation plus explicit row locks is sufficient initially; stronger isolation is added only if testing exposes an invariant that needs it.

## Query patterns and N+1 prevention

- Assigned quizzes: query eligible enrollments joined to quiz summaries; do not query each quiz separately.
- Attempt load: fetch attempt questions, questions/options, and saved answers in a fixed number of batched queries.
- Scoring: use one set-based query over attempt questions, options, and answers.
- Leaderboard: use one aggregate/window query after quiz closure.
- Admin summaries: use grouped counts rather than loading attempts and counting in application memory.
- Violation history: paginate by `(received_at, id)`.
- Inspect `EXPLAIN (ANALYZE, BUFFERS)` output for hot queries during staging load tests.

No service may execute a database call inside a loop over an unbounded result set.

## Migration policy

- Use Prisma Migrate and commit generated SQL.
- Review every migration before merge.
- Use custom SQL inside migrations for partial indexes and advanced constraints.
- Apply migrations to staging before production.
- Prefer backward-compatible expand-and-contract changes.
- Never use `prisma db push` against staging or production.
- Roll back application releases by redeployment; repair database changes with a reviewed forward migration.

## Data retention

Retention periods must be approved before production. Until then:

- Keep attempts, answers, results, and audit logs.
- Keep violation metadata only as long as required for review and institutional policy.
- Do not store camera video.
- Remove signed media URLs from logs; store only stable private object paths.
