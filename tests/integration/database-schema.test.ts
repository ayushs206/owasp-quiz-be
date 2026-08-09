import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();
const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

afterAll(async () => {
  await prisma.$disconnect();
});

describeDatabase('database migration', () => {
  it('creates the eleven documented application tables', async () => {
    const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT tablename AS "tableName"
      FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
        AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;

    expect(tables.map(({ tableName }) => tableName)).toEqual([
      'answers',
      'attempt_questions',
      'attempt_reviews',
      'attempts',
      'profiles',
      'question_options',
      'questions',
      'quiz_enrollments',
      'quiz_series',
      'quizzes',
      'violations',
    ]);
  });

  it('installs the required PostgreSQL-only indexes', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexName: string }>>`
      SELECT indexname AS "indexName"
      FROM pg_catalog.pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'profiles_roll_number_key',
          'quiz_enrollments_quiz_user_key',
          'question_options_one_correct_key',
          'violations_attempt_sequence_key'
        )
      ORDER BY indexname
    `;

    expect(indexes.map(({ indexName }) => indexName)).toEqual([
      'profiles_roll_number_key',
      'question_options_one_correct_key',
      'quiz_enrollments_quiz_user_key',
      'violations_attempt_sequence_key',
    ]);
  });

  it('installs immutable attempt-review audit enforcement', async () => {
    const triggers = await prisma.$queryRaw<Array<{ triggerName: string }>>`
      SELECT tgname AS "triggerName"
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'attempt_reviews'::regclass
        AND NOT tgisinternal
    `;

    expect(triggers).toEqual([{ triggerName: 'attempt_reviews_immutable' }]);
  });
});
