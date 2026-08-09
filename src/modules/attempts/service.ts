/**
 * @param ids
 * @param random
 */
export function shuffleIds(ids: readonly string[], random: () => number): string[] {
  const result = ids.slice(); // copy — never mutate the source
  for (let i = result.length - 1; i > 0; i--) {
    const r = random();
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
      throw new RangeError(
        `shuffleIds: random() returned ${r}; expected a finite value in [0, 1).`,
      );
    }
    const j = Math.floor(r * (i + 1));

    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

export interface AttemptQuestionSnapshot {
  questionId: string;
  positiveMark: number;
  negativeMark: number;
}

export interface PersistedAnswer {
  questionId: string;
  selectedOptionId: string | null;
  isCorrect: boolean;
}

export interface ScoreResult {
  score: number;
  maximumScore: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
}

/**
 * Calculate the score and answer counts for a submitted attempt.
 *
 * Rules:
 * - Correct answer   → +positiveMark
 * - Incorrect answer → -negativeMark
 * - Unanswered or cleared tombstone (selectedOptionId === null) → 0 marks
 * - Negative totals are preserved; they are never floored to zero.
 *
 * Arithmetic note: all marks are accumulated as integer hundredths (×100) to
 * avoid IEEE 754 rounding errors with common decimal values such as 0.1, 0.2,
 * and 1.25. The final result is divided back to a regular number.
 *
 * @param snapshot The ordered `attempt_questions` rows for the attempt.
 * @param answers  The persisted `answers` rows. Questions with no row are
 *                 treated as unanswered (zero marks).
 */
export function scoreAttempt(
  snapshot: readonly AttemptQuestionSnapshot[],
  answers: readonly PersistedAnswer[],
): ScoreResult {
  // Index answers by questionId for O(1) lookup.
  const answerMap = new Map<string, PersistedAnswer>();
  for (const answer of answers) {
    answerMap.set(answer.questionId, answer);
  }

  // Accumulate as integer hundredths to avoid floating-point drift.
  let scoreHundredths = 0;
  let maximumScoreHundredths = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  for (const question of snapshot) {
    // Round to the nearest hundredth before converting to avoid any upstream
    // imprecision (e.g. 1.2500000001 → 125).
    const positiveHundredths = Math.round(question.positiveMark * 100);
    const negativeHundredths = Math.round(question.negativeMark * 100);

    maximumScoreHundredths += positiveHundredths;

    const answer = answerMap.get(question.questionId);

    if (answer === undefined) {
      unansweredCount += 1;
      continue;
    }

    if (answer.selectedOptionId === null) {
      unansweredCount += 1;
      continue;
    }

    if (answer.isCorrect) {
      scoreHundredths += positiveHundredths;
      correctCount += 1;
    } else {
      scoreHundredths -= negativeHundredths;
      incorrectCount += 1;
    }
  }

  return {
    score: scoreHundredths / 100,
    maximumScore: maximumScoreHundredths / 100,
    correctCount,
    incorrectCount,
    unansweredCount,
  };
}
