import { describe, expect, it } from 'vitest';

import {
  type AttemptQuestionSnapshot,
  type PersistedAnswer,
  shuffleIds,
  scoreAttempt,
} from './service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AttemptQuestionSnapshot. */
function q(
  questionId: string,
  positiveMark: number,
  negativeMark: number,
): AttemptQuestionSnapshot {
  return { questionId, positiveMark, negativeMark };
}

/**
 * Build a PersistedAnswer for a correct selection.
 * Callers provide a non-null selectedOptionId.
 */
function correct(questionId: string, optionId: string): PersistedAnswer {
  return { questionId, selectedOptionId: optionId, isCorrect: true };
}

/** Build a PersistedAnswer for an incorrect selection. */
function incorrect(questionId: string, optionId: string): PersistedAnswer {
  return { questionId, selectedOptionId: optionId, isCorrect: false };
}

/** Build a PersistedAnswer tombstone: the student cleared their answer. */
function cleared(questionId: string): PersistedAnswer {
  return { questionId, selectedOptionId: null, isCorrect: false };
}

// ---------------------------------------------------------------------------
// shuffleIds
// ---------------------------------------------------------------------------

describe('shuffleIds', () => {
  it('is deterministic for the same random source', () => {
    // A seeded linear-congruential generator so the test is reproducible
    // without any third-party library.
    function makeLcg(seed: number): () => number {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0x100000000;
      };
    }

    const ids = ['q1', 'q2', 'q3', 'q4', 'q5'];

    const first = shuffleIds(ids, makeLcg(42));
    const second = shuffleIds(ids, makeLcg(42));

    expect(first).toEqual(second);
  });

  it('does not mutate the source array', () => {
    const source = ['a', 'b', 'c', 'd'];
    const original = [...source];

    shuffleIds(source, Math.random);

    expect(source).toEqual(original);
  });

  it('returns a new array instance', () => {
    const source = ['x', 'y'];
    const result = shuffleIds(source, Math.random);

    expect(result).not.toBe(source);
  });

  it('returns all original IDs exactly once', () => {
    const source = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

    // Run many times to increase confidence.
    for (let run = 0; run < 20; run++) {
      const result = shuffleIds(source, Math.random);
      expect(result).toHaveLength(source.length);
      expect(result.sort()).toEqual([...source].sort());
    }
  });

  it('handles an empty array without error', () => {
    expect(shuffleIds([], Math.random)).toEqual([]);
  });

  it('handles a single-element array without error', () => {
    expect(shuffleIds(['only'], Math.random)).toEqual(['only']);
  });

  it('produces a different order on different seeds', () => {
    // With a large-enough array, two independent shuffles almost certainly differ.
    const ids = Array.from({ length: 20 }, (_, i) => `q${String(i)}`);

    // Use Math.random for two independent calls; the chance of collision is
    // negligible (1 / 20! ≈ 0).
    const a = shuffleIds(ids, Math.random);
    const b = shuffleIds(ids, Math.random);

    // At least one position should differ. This is technically probabilistic
    // but the probability of failure is astronomically small.
    const differs = a.some((id, i) => id !== b[i]);
    expect(differs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — all-correct
// ---------------------------------------------------------------------------

describe('scoreAttempt — all correct', () => {
  it('awards full marks and sets correct count equal to total questions', () => {
    const snapshot = [q('q1', 4, 1), q('q2', 4, 1), q('q3', 4, 1)];
    const answers = [correct('q1', 'o1'), correct('q2', 'o2'), correct('q3', 'o3')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(12);
    expect(result.maximumScore).toBe(12);
    expect(result.correctCount).toBe(3);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — incorrect with negative marks
// ---------------------------------------------------------------------------

describe('scoreAttempt — incorrect answers with negative marks', () => {
  it('deducts negative marks for each wrong answer', () => {
    const snapshot = [q('q1', 4, 1), q('q2', 4, 1)];
    const answers = [incorrect('q1', 'wrong1'), incorrect('q2', 'wrong2')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(-2); // 0 - 1 - 1
    expect(result.maximumScore).toBe(8);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(2);
    expect(result.unansweredCount).toBe(0);
  });

  it('does not deduct marks when negativeMark is zero', () => {
    const snapshot = [q('q1', 3, 0), q('q2', 3, 0)];
    const answers = [incorrect('q1', 'wrong1'), incorrect('q2', 'wrong2')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(0);
    expect(result.incorrectCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — unanswered (no answer row)
// ---------------------------------------------------------------------------

describe('scoreAttempt — unanswered questions (no answer row)', () => {
  it('awards zero marks for questions with no persisted answer', () => {
    const snapshot = [q('q1', 4, 1), q('q2', 4, 1)];
    const answers: PersistedAnswer[] = []; // nothing submitted

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(0);
    expect(result.maximumScore).toBe(8);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(2);
  });

  it('treats a missing answer row the same as an explicit skip', () => {
    const snapshot = [q('q1', 4, 1), q('q2', 4, 1)];
    // Only q1 answered correctly; q2 has no row.
    const answers = [correct('q1', 'o1')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(4);
    expect(result.correctCount).toBe(1);
    expect(result.unansweredCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — cleared tombstone
// ---------------------------------------------------------------------------

describe('scoreAttempt — cleared-answer tombstone', () => {
  it('counts a null selectedOptionId as unanswered, not incorrect', () => {
    const snapshot = [q('q1', 4, 1)];
    const answers = [cleared('q1')]; // selectedOptionId is null

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(1);
  });

  it('does not deduct negative marks for a cleared answer', () => {
    const snapshot = [q('q1', 5, 2)];
    const answers = [cleared('q1')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(0); // NOT -2
    expect(result.unansweredCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — mixed answers
// ---------------------------------------------------------------------------

describe('scoreAttempt — mixed answers', () => {
  it('correctly tallies correct, incorrect, cleared, and missing answers together', () => {
    const snapshot = [
      q('q1', 4, 1), // will be answered correctly
      q('q2', 4, 1), // will be answered incorrectly
      q('q3', 4, 1), // will be cleared (tombstone)
      q('q4', 4, 1), // no answer row at all
    ];
    const answers = [
      correct('q1', 'o1'),
      incorrect('q2', 'wrong'),
      cleared('q3'),
      // q4 intentionally absent
    ];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(3); // +4 - 1
    expect(result.maximumScore).toBe(16);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(1);
    expect(result.unansweredCount).toBe(2); // cleared + missing
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — negative total score
// ---------------------------------------------------------------------------

describe('scoreAttempt — negative total score', () => {
  it('preserves a negative score and does not floor it to zero', () => {
    const snapshot = [
      q('q1', 1, 5), // small positive, large negative
      q('q2', 1, 5),
    ];
    const answers = [incorrect('q1', 'w1'), incorrect('q2', 'w2')];

    const result = scoreAttempt(snapshot, answers);

    // score = 0 - 5 - 5 = -10
    expect(result.score).toBe(-10);
    expect(result.score).toBeLessThan(0);
  });

  it('preserves a negative total when mixed correct and incorrect answers produce a net loss', () => {
    const snapshot = [
      q('q1', 1, 0), // correct, +1
      q('q2', 1, 4), // incorrect, -4
    ];
    const answers = [correct('q1', 'o1'), incorrect('q2', 'w2')];

    const result = scoreAttempt(snapshot, answers);

    // score = +1 - 4 = -3
    expect(result.score).toBe(-3);
  });
});

// ---------------------------------------------------------------------------
// scoreAttempt — maximumScore and count calculations
// ---------------------------------------------------------------------------

describe('scoreAttempt — maximumScore and count calculations', () => {
  it('computes maximumScore as the sum of all positiveMark values', () => {
    const snapshot = [q('q1', 3, 0), q('q2', 5, 0), q('q3', 2, 0)];
    const answers: PersistedAnswer[] = [];

    const result = scoreAttempt(snapshot, answers);

    expect(result.maximumScore).toBe(10); // 3 + 5 + 2
  });

  it('counts sum to the total number of questions', () => {
    const snapshot = [
      q('q1', 4, 1), // correct
      q('q2', 4, 1), // incorrect
      q('q3', 4, 1), // cleared
      q('q4', 4, 1), // missing
      q('q5', 4, 1), // missing
    ];
    const answers = [correct('q1', 'o1'), incorrect('q2', 'w2'), cleared('q3')];

    const result = scoreAttempt(snapshot, answers);

    const total = result.correctCount + result.incorrectCount + result.unansweredCount;
    expect(total).toBe(snapshot.length);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(1);
    expect(result.unansweredCount).toBe(3); // cleared + 2 missing
  });

  it('returns zero maximumScore for an empty snapshot', () => {
    const result = scoreAttempt([], []);
    expect(result.maximumScore).toBe(0);
    expect(result.score).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(0);
    expect(result.unansweredCount).toBe(0);
  });

  it('handles questions with zero positive marks', () => {
    // Edge case: a question with no positive award but a negative mark.
    const snapshot = [q('q1', 0, 2)];
    const answers = [incorrect('q1', 'wrong')];

    const result = scoreAttempt(snapshot, answers);

    expect(result.score).toBe(-2);
    expect(result.maximumScore).toBe(0);
    expect(result.incorrectCount).toBe(1);
  });
});
