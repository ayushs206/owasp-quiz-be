-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('STUDENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "quiz_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('ELIGIBLE', 'REVOKED');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "submission_reason" AS ENUM ('USER', 'EXPIRED', 'VIOLATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'DISQUALIFIED');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "full_name" TEXT,
    "roll_number" TEXT,
    "branch_code" TEXT,
    "phone_e164" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'STUDENT',
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "profile_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_series" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "quiz_status" NOT NULL DEFAULT 'DRAFT',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "results_published_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_enrollments" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "user_id" UUID,
    "roll_number" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL,
    "roster_name" TEXT,
    "status" "enrollment_status" NOT NULL DEFAULT 'ELIGIBLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "image_path" TEXT,
    "positive_marks" DECIMAL(8,2) NOT NULL,
    "negative_marks" DECIMAL(8,2) NOT NULL,
    "source_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "source_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "attempt_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "submission_reason" "submission_reason",
    "qualifying_violation_count" INTEGER NOT NULL DEFAULT 0,
    "review_status" "review_status" NOT NULL DEFAULT 'NOT_REQUIRED',
    "score" DECIMAL(10,2),
    "maximum_score" DECIMAL(10,2),
    "correct_count" INTEGER,
    "incorrect_count" INTEGER,
    "unanswered_count" INTEGER,
    "scored_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_questions" (
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "option_order" JSONB NOT NULL,
    "positive_marks" DECIMAL(8,2) NOT NULL,
    "negative_marks" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "attempt_questions_pkey" PRIMARY KEY ("attempt_id","question_id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_option_id" UUID,
    "client_revision" BIGINT NOT NULL,
    "last_idempotency_key" UUID NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "client_event_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "client_occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,
    "qualifies" BOOLEAN NOT NULL,
    "sequence_number" INTEGER,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_reviews" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "reviewed_by" UUID NOT NULL,
    "decision" "review_status" NOT NULL,
    "note" TEXT,
    "request_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_normalized_email_key" ON "profiles"("normalized_email");

-- CreateIndex
CREATE INDEX "quiz_series_created_by_idx" ON "quiz_series"("created_by");

-- CreateIndex
CREATE INDEX "quizzes_status_schedule_idx" ON "quizzes"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "quizzes_series_starts_at_idx" ON "quizzes"("series_id", "starts_at");

-- CreateIndex
CREATE INDEX "quizzes_created_by_idx" ON "quizzes"("created_by");

-- CreateIndex
CREATE INDEX "quiz_enrollments_email_status_idx" ON "quiz_enrollments"("normalized_email", "status");

-- CreateIndex
CREATE INDEX "quiz_enrollments_user_id_idx" ON "quiz_enrollments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_enrollments_quiz_email_key" ON "quiz_enrollments"("quiz_id", "normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_enrollments_quiz_roll_key" ON "quiz_enrollments"("quiz_id", "roll_number");

-- CreateIndex
CREATE UNIQUE INDEX "questions_quiz_source_order_key" ON "questions"("quiz_id", "source_order");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_id_key" ON "question_options"("question_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_source_order_key" ON "question_options"("question_id", "source_order");

-- CreateIndex
CREATE INDEX "attempts_user_status_idx" ON "attempts"("user_id", "status");

-- CreateIndex
CREATE INDEX "attempts_quiz_status_idx" ON "attempts"("quiz_id", "status");

-- CreateIndex
CREATE INDEX "attempts_status_expires_at_idx" ON "attempts"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_quiz_user_key" ON "attempts"("quiz_id", "user_id");

-- CreateIndex
CREATE INDEX "attempt_questions_question_id_idx" ON "attempt_questions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_attempt_display_order_key" ON "attempt_questions"("attempt_id", "display_order");

-- CreateIndex
CREATE INDEX "answers_question_selected_option_idx" ON "answers"("question_id", "selected_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_attempt_question_key" ON "answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "violations_attempt_received_id_idx" ON "violations"("attempt_id", "received_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "violations_attempt_event_key" ON "violations"("attempt_id", "client_event_id");

-- CreateIndex
CREATE INDEX "attempt_reviews_attempt_created_id_idx" ON "attempt_reviews"("attempt_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "attempt_reviews_reviewed_by_idx" ON "attempt_reviews"("reviewed_by");

-- AddForeignKey
ALTER TABLE "quiz_series" ADD CONSTRAINT "quiz_series_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "quiz_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_enrollments" ADD CONSTRAINT "quiz_enrollments_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_enrollments" ADD CONSTRAINT "quiz_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_question_id_fkey" FOREIGN KEY ("attempt_id", "question_id") REFERENCES "attempt_questions"("attempt_id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_selected_option_id_fkey" FOREIGN KEY ("question_id", "selected_option_id") REFERENCES "question_options"("question_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_reviews" ADD CONSTRAINT "attempt_reviews_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_reviews" ADD CONSTRAINT "attempt_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL-only partial uniqueness required by the data model.
CREATE UNIQUE INDEX "profiles_roll_number_key"
    ON "profiles"("roll_number")
    WHERE "roll_number" IS NOT NULL;

CREATE UNIQUE INDEX "quiz_enrollments_quiz_user_key"
    ON "quiz_enrollments"("quiz_id", "user_id")
    WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "question_options_one_correct_key"
    ON "question_options"("question_id")
    WHERE "is_correct" = true;

CREATE UNIQUE INDEX "violations_attempt_sequence_key"
    ON "violations"("attempt_id", "sequence_number")
    WHERE "sequence_number" IS NOT NULL;

-- Validate the bounded UUID array stored as the immutable option-order snapshot.
CREATE FUNCTION "is_valid_uuid_array"("value" JSONB, "minimum_length" INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN jsonb_typeof("value") <> 'array' THEN false
        ELSE jsonb_array_length("value") >= "minimum_length"
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text("value") AS element(item)
                WHERE item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            )
            AND jsonb_array_length("value") = (
                SELECT count(DISTINCT item)
                FROM jsonb_array_elements_text("value") AS element(item)
            )
    END
$$;

-- Local domain and lifecycle checks that Prisma cannot declare.
ALTER TABLE "profiles"
    ADD CONSTRAINT "profiles_email_normalized_check"
        CHECK (length(btrim("email")) > 0 AND "normalized_email" = lower(btrim("email"))),
    ADD CONSTRAINT "profiles_phone_e164_check"
        CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "profiles_completion_check"
        CHECK (
            "profile_completed_at" IS NULL OR (
                "full_name" IS NOT NULL
                AND "roll_number" IS NOT NULL
                AND "branch_code" IS NOT NULL
                AND length(btrim("full_name")) > 0
                AND length(btrim("roll_number")) > 0
                AND length(btrim("branch_code")) > 0
                AND "phone_e164" IS NOT NULL
            )
        );

ALTER TABLE "quiz_series"
    ADD CONSTRAINT "quiz_series_title_check" CHECK (length(btrim("title")) > 0);

ALTER TABLE "quizzes"
    ADD CONSTRAINT "quizzes_title_check" CHECK (length(btrim("title")) > 0),
    ADD CONSTRAINT "quizzes_duration_check" CHECK ("duration_minutes" > 0),
    ADD CONSTRAINT "quizzes_schedule_check" CHECK ("ends_at" > "starts_at"),
    ADD CONSTRAINT "quizzes_results_publication_check"
        CHECK (("status" = 'RESULTS_PUBLISHED') = ("results_published_at" IS NOT NULL)),
    ADD CONSTRAINT "quizzes_enabled_status_check"
        CHECK (NOT "is_enabled" OR "status" = 'PUBLISHED');

ALTER TABLE "quiz_enrollments"
    ADD CONSTRAINT "quiz_enrollments_email_check"
        CHECK (length("normalized_email") > 0 AND "normalized_email" = lower(btrim("normalized_email"))),
    ADD CONSTRAINT "quiz_enrollments_roll_check" CHECK (length(btrim("roll_number")) > 0),
    ADD CONSTRAINT "quiz_enrollments_branch_check" CHECK (length(btrim("branch_code")) > 0);

ALTER TABLE "questions"
    ADD CONSTRAINT "questions_prompt_check" CHECK (length(btrim("prompt")) > 0),
    ADD CONSTRAINT "questions_source_order_check" CHECK ("source_order" >= 1),
    ADD CONSTRAINT "questions_marks_check" CHECK ("positive_marks" >= 0 AND "negative_marks" >= 0);

ALTER TABLE "question_options"
    ADD CONSTRAINT "question_options_text_check" CHECK (length(btrim("text")) > 0),
    ADD CONSTRAINT "question_options_source_order_check" CHECK ("source_order" >= 1);

ALTER TABLE "attempts"
    ADD CONSTRAINT "attempts_time_check" CHECK ("expires_at" >= "started_at"),
    ADD CONSTRAINT "attempts_violation_count_check" CHECK ("qualifying_violation_count" >= 0),
    ADD CONSTRAINT "attempts_lifecycle_check"
        CHECK (
            (
                "status" = 'IN_PROGRESS'
                AND "submitted_at" IS NULL
                AND "submission_reason" IS NULL
                AND "score" IS NULL
                AND "maximum_score" IS NULL
                AND "correct_count" IS NULL
                AND "incorrect_count" IS NULL
                AND "unanswered_count" IS NULL
                AND "scored_at" IS NULL
            ) OR (
                "status" = 'SUBMITTED'
                AND "submitted_at" IS NOT NULL
                AND "submission_reason" IS NOT NULL
                AND "score" IS NOT NULL
                AND "maximum_score" IS NOT NULL
                AND "maximum_score" >= 0
                AND "correct_count" IS NOT NULL
                AND "correct_count" >= 0
                AND "incorrect_count" IS NOT NULL
                AND "incorrect_count" >= 0
                AND "unanswered_count" IS NOT NULL
                AND "unanswered_count" >= 0
                AND "scored_at" IS NOT NULL
            )
        );

ALTER TABLE "attempt_questions"
    ADD CONSTRAINT "attempt_questions_display_order_check" CHECK ("display_order" >= 1),
    ADD CONSTRAINT "attempt_questions_marks_check" CHECK ("positive_marks" >= 0 AND "negative_marks" >= 0),
    ADD CONSTRAINT "attempt_questions_option_order_check" CHECK ("is_valid_uuid_array"("option_order", 2));

ALTER TABLE "answers"
    ADD CONSTRAINT "answers_client_revision_check" CHECK ("client_revision" >= 1);

ALTER TABLE "violations"
    ADD CONSTRAINT "violations_type_check" CHECK (length(btrim("type")) > 0),
    ADD CONSTRAINT "violations_sequence_check" CHECK ("sequence_number" IS NULL OR "sequence_number" >= 1),
    ADD CONSTRAINT "violations_metadata_check" CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "attempt_reviews"
    ADD CONSTRAINT "attempt_reviews_decision_check" CHECK ("decision" IN ('APPROVED', 'DISQUALIFIED')),
    ADD CONSTRAINT "attempt_reviews_note_check" CHECK ("note" IS NULL OR length("note") <= 2000);

-- The review table is authoritative append-only audit history.
CREATE FUNCTION "prevent_attempt_review_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'attempt_reviews rows are immutable';
END;
$$;

CREATE TRIGGER "attempt_reviews_immutable"
BEFORE UPDATE OR DELETE ON "attempt_reviews"
FOR EACH ROW
EXECUTE FUNCTION "prevent_attempt_review_mutation"();
