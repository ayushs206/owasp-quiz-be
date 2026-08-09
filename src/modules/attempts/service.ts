

/**
 * @param ids 
 * @param random 
 */
export function shuffleIds(ids: readonly string[], random: () => number): string[] {
  const result = ids.slice(); // copy — never mutate the source
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));

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

  let score = 0;
  let maximumScore = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  for (const question of snapshot) {
    maximumScore += question.positiveMark;

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
      score += question.positiveMark;
      correctCount += 1;
    } else {
      score -= question.negativeMark;
      incorrectCount += 1;
    }
  }

  return { score, maximumScore, correctCount, incorrectCount, unansweredCount };
}
