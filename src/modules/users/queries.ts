import type { Prisma, QuizEnrollment } from '@prisma/client';

export async function lockEligibleEnrollments(
  tx: Prisma.TransactionClient,
  normalizedEmail: string,
): Promise<QuizEnrollment[]> {
  return tx.$queryRaw<QuizEnrollment[]>`
    SELECT id, quiz_id as "quizId", normalized_email as "normalizedEmail", user_id as "userId", roll_number as "rollNumber", branch_code as "branchCode", roster_name as "rosterName", status, created_at as "createdAt"
    FROM quiz_enrollments
    WHERE normalized_email = ${normalizedEmail} AND status = 'ELIGIBLE'
    FOR UPDATE
  `;
}
