import { describe, it, expect } from 'vitest';
import {
  updateScorecard,
  synthScoresFromPairwise,
  calculateMomentumShift,
  calculateFrameControlShift,
  detectLanguageMismatch,
} from './analysis';
import type { DebateScorecard, PairwiseRound, MomentumTracker, FrameControlTracker } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRound(
  prevAgentId: string, prevAgentName: string,
  curAgentId: string, curAgentName: string,
  logicWinner: string,
  tacticsWinner: string,
  rhetoricWinner: string,
  opts: { roundNumber?: number; isFallback?: boolean } = {}
): PairwiseRound {
  return {
    roundNumber: opts.roundNumber ?? 1,
    prevTurn: { turnNumber: 1, agentId: prevAgentId, agentName: prevAgentName, message: 'prev msg' },
    curTurn: { turnNumber: 2, agentId: curAgentId, agentName: curAgentName, message: 'cur msg' },
    logicWinner,
    tacticsWinner,
    rhetoricWinner,
    logicDelta: 'logic delta',
    tacticsDelta: 'tactics delta',
    rhetoricDelta: 'rhetoric delta',
    isFallback: opts.isFallback ?? false,
  };
}

function emptyScorecard(): DebateScorecard {
  return { rounds: [], winTallies: {}, overallWinner: null };
}

function makeMomentumTracker(agentId: string, current: number): MomentumTracker {
  return {
    currentMomentum: { [agentId]: current },
    momentumHistory: {},
    lastMomentumShift: {},
    momentumTrend: {},
  };
}

function makeFrameControlTracker(agentId: string, current: number): FrameControlTracker {
  return {
    currentControl: { [agentId]: current },
    controlHistory: {},
    lastControlShift: {},
    dominantFrame: null,
  };
}

// ---------------------------------------------------------------------------
// updateScorecard
// ---------------------------------------------------------------------------

describe('updateScorecard', () => {
  it('adds the round to the rounds array', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a');
    const result = updateScorecard(emptyScorecard(), round, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toBe(round);
  });

  it('increments win tallies when one agent sweeps all three dimensions', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a');
    const result = updateScorecard(emptyScorecard(), round, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.winTallies['a'].logic).toBe(1);
    expect(result.winTallies['a'].tactics).toBe(1);
    expect(result.winTallies['a'].rhetoric).toBe(1);
    expect(result.winTallies['a'].total).toBe(3);
    expect(result.winTallies['b'].total).toBe(0);
  });

  it('increments win tallies for a split round', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'b', 'b');
    const result = updateScorecard(emptyScorecard(), round, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.winTallies['a'].logic).toBe(1);
    expect(result.winTallies['b'].tactics).toBe(1);
    expect(result.winTallies['b'].rhetoric).toBe(1);
    expect(result.winTallies['a'].total).toBe(1);
    expect(result.winTallies['b'].total).toBe(2);
  });

  it('accumulates tallies across multiple rounds', () => {
    const round1 = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'b', { roundNumber: 1 });
    const round2 = makeRound('b', 'Agent B', 'a', 'Agent A', 'a', 'b', 'a', { roundNumber: 2 });

    let sc = updateScorecard(emptyScorecard(), round1, 'a', 'Agent A', 'b', 'Agent B');
    sc = updateScorecard(sc, round2, 'a', 'Agent A', 'b', 'Agent B');

    // Round 1: a wins logic+tactics, b wins rhetoric → a=2, b=1
    // Round 2: a wins logic+rhetoric, b wins tactics   → a=2, b=1
    // Cumulative: a=4, b=2
    expect(sc.winTallies['a'].total).toBe(4);
    expect(sc.winTallies['b'].total).toBe(2);
    expect(sc.rounds).toHaveLength(2);
  });

  it('sets overallWinner when one agent has more total wins', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a');
    const result = updateScorecard(emptyScorecard(), round, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.overallWinner).toBe('a');
  });

  it('leaves overallWinner null on a draw', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'b', 'a');
    let sc = updateScorecard(emptyScorecard(), round, 'a', 'Agent A', 'b', 'Agent B');
    // Round 2: b wins 2, a wins 1 → cumulative tie (a=2, b=2 is not achievable with 3 dims)
    // Use a second round where b sweeps to equalize totals
    const round2 = makeRound('a', 'Agent A', 'b', 'Agent B', 'b', 'b', 'a', { roundNumber: 2 });
    sc = updateScorecard(sc, round2, 'a', 'Agent A', 'b', 'Agent B');
    // a total = 2 (logic R1 + rhetoric R2), b total = 4... not a draw with 6 points
    // Let's directly test a=3, b=3 by adding a round that balances
    const round3 = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'b', 'b', { roundNumber: 3 });
    sc = updateScorecard(sc, round3, 'a', 'Agent A', 'b', 'Agent B');
    // After 3 rounds: a=(2+1+1)=4 wins? Let's just verify null is possible
    // The easiest draw test: two rounds, a sweeps one, b sweeps another
    let sc2 = updateScorecard(emptyScorecard(),
      makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a'), 'a', 'Agent A', 'b', 'Agent B');
    sc2 = updateScorecard(sc2,
      makeRound('a', 'Agent A', 'b', 'Agent B', 'b', 'b', 'b'), 'a', 'Agent A', 'b', 'Agent B');
    expect(sc2.winTallies['a'].total).toBe(3);
    expect(sc2.winTallies['b'].total).toBe(3);
    expect(sc2.overallWinner).toBeNull();
  });

  it('handles fallback rounds correctly (same logic as normal rounds)', () => {
    const fallback = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a', { isFallback: true });
    const result = updateScorecard(emptyScorecard(), fallback, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.winTallies['a'].total).toBe(3);
    expect(result.rounds[0].isFallback).toBe(true);
  });

  it('preserves existing win tallies from prior scorecard', () => {
    const existing: DebateScorecard = {
      rounds: [],
      winTallies: {
        a: { agentName: 'Agent A', logic: 2, tactics: 1, rhetoric: 0, total: 3 },
        b: { agentName: 'Agent B', logic: 0, tactics: 1, rhetoric: 2, total: 3 },
      },
      overallWinner: null,
    };
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a');
    const result = updateScorecard(existing, round, 'a', 'Agent A', 'b', 'Agent B');
    expect(result.winTallies['a'].total).toBe(6);
    expect(result.winTallies['b'].total).toBe(3);
    expect(result.overallWinner).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// synthScoresFromPairwise
// ---------------------------------------------------------------------------

describe('synthScoresFromPairwise', () => {
  it('returns high scores on all dimensions when agent wins all three', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'b', 'b', 'b');
    const scores = synthScoresFromPairwise(round, 'b');
    // Thresholds from pressure.ts: logicalCoherence high > 28, rhetoricalForce high > 21, tacticalEffectiveness high > 21
    expect(scores.logicalCoherence).toBeGreaterThan(28);
    expect(scores.rhetoricalForce).toBeGreaterThan(21);
    expect(scores.tacticalEffectiveness).toBeGreaterThan(21);
    expect(scores.overallScore).toBeGreaterThan(70); // reinforcement level
  });

  it('returns low scores on all dimensions when agent loses all three', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'a', 'a', 'a');
    const scores = synthScoresFromPairwise(round, 'b');
    expect(scores.logicalCoherence).toBeLessThan(16);
    expect(scores.rhetoricalForce).toBeLessThan(12);
    expect(scores.tacticalEffectiveness).toBeLessThan(12);
    expect(scores.overallScore).toBeLessThan(40);
  });

  it('produces higher overallScore for more wins (monotonic)', () => {
    const round = makeRound('a', 'Agent A', 'b', 'Agent B', 'b', 'b', 'a');
    const twoWins = synthScoresFromPairwise(round, 'b');
    const allWins = synthScoresFromPairwise(makeRound('a', 'A', 'b', 'B', 'b', 'b', 'b'), 'b');
    const noWins = synthScoresFromPairwise(makeRound('a', 'A', 'b', 'B', 'a', 'a', 'a'), 'b');
    expect(allWins.overallScore).toBeGreaterThan(twoWins.overallScore);
    expect(twoWins.overallScore).toBeGreaterThan(noWins.overallScore);
  });

  it('all returned scores are numbers', () => {
    const round = makeRound('a', 'A', 'b', 'B', 'a', 'b', 'a');
    const scores = synthScoresFromPairwise(round, 'a');
    for (const v of Object.values(scores)) {
      expect(typeof v).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// calculateMomentumShift (corrected baselines)
// ---------------------------------------------------------------------------

describe('calculateMomentumShift', () => {
  it('returns a positive shift for strong scores', () => {
    // overallScore 82, tacticalEffectiveness 24 (both above midpoints 50 and 15)
    const tracker = makeMomentumTracker('a', 0);
    const shift = calculateMomentumShift(
      { logicalCoherence: 30, rhetoricalForce: 24, frameControl: 82, credibilityScore: 82, tacticalEffectiveness: 24, overallScore: 82 },
      tracker, 'a'
    );
    expect(shift).toBeGreaterThan(0);
  });

  it('returns a negative shift for weak scores', () => {
    const tracker = makeMomentumTracker('a', 0);
    const shift = calculateMomentumShift(
      { logicalCoherence: 14, rhetoricalForce: 10, frameControl: 30, credibilityScore: 30, tacticalEffectiveness: 10, overallScore: 30 },
      tracker, 'a'
    );
    expect(shift).toBeLessThan(0);
  });

  it('returns near-zero shift for exactly-midpoint scores', () => {
    // overallScore=50 (midpoint), tacticalEffectiveness=15 (midpoint), credibilityScore=50 (midpoint)
    const tracker = makeMomentumTracker('a', 0);
    const shift = calculateMomentumShift(
      { logicalCoherence: 20, rhetoricalForce: 15, frameControl: 50, credibilityScore: 50, tacticalEffectiveness: 15, overallScore: 50 },
      tracker, 'a'
    );
    expect(shift).toBeCloseTo(0, 5);
  });

  it('is clamped to −25..+25', () => {
    const tracker = makeMomentumTracker('a', 0);
    const high = calculateMomentumShift(
      { logicalCoherence: 40, rhetoricalForce: 30, frameControl: 100, credibilityScore: 100, tacticalEffectiveness: 30, overallScore: 100 },
      tracker, 'a'
    );
    const low = calculateMomentumShift(
      { logicalCoherence: 0, rhetoricalForce: 0, frameControl: 0, credibilityScore: 0, tacticalEffectiveness: 0, overallScore: 0 },
      tracker, 'a'
    );
    expect(high).toBeLessThanOrEqual(25);
    expect(low).toBeGreaterThanOrEqual(-25);
  });
});

// ---------------------------------------------------------------------------
// calculateFrameControlShift (corrected baselines)
// ---------------------------------------------------------------------------

describe('calculateFrameControlShift', () => {
  it('returns a positive shift for strong scores', () => {
    const tracker = makeFrameControlTracker('a', 0);
    const shift = calculateFrameControlShift(
      { logicalCoherence: 30, rhetoricalForce: 24, frameControl: 82, credibilityScore: 82, tacticalEffectiveness: 24, overallScore: 82 },
      tracker, 'a'
    );
    expect(shift).toBeGreaterThan(0);
  });

  it('returns a negative shift for weak scores', () => {
    const tracker = makeFrameControlTracker('a', 0);
    const shift = calculateFrameControlShift(
      { logicalCoherence: 14, rhetoricalForce: 10, frameControl: 30, credibilityScore: 30, tacticalEffectiveness: 10, overallScore: 30 },
      tracker, 'a'
    );
    expect(shift).toBeLessThan(0);
  });

  it('returns near-zero shift for exactly-midpoint scores', () => {
    // logicalCoherence=20 (midpoint of 0-40), rhetoricalForce=15 (midpoint of 0-30),
    // tacticalEffectiveness=15 (midpoint of 0-30) → baseControl=0, tacticalModifier=0
    const tracker = makeFrameControlTracker('a', 0);
    const shift = calculateFrameControlShift(
      { logicalCoherence: 20, rhetoricalForce: 15, frameControl: 50, credibilityScore: 50, tacticalEffectiveness: 15, overallScore: 50 },
      tracker, 'a'
    );
    expect(shift).toBeCloseTo(0, 5);
  });

  it('is clamped to −20..+20', () => {
    const tracker = makeFrameControlTracker('a', 0);
    const high = calculateFrameControlShift(
      { logicalCoherence: 40, rhetoricalForce: 30, frameControl: 100, credibilityScore: 100, tacticalEffectiveness: 30, overallScore: 100 },
      tracker, 'a'
    );
    const low = calculateFrameControlShift(
      { logicalCoherence: 0, rhetoricalForce: 0, frameControl: 0, credibilityScore: 0, tacticalEffectiveness: 0, overallScore: 0 },
      tracker, 'a'
    );
    expect(high).toBeLessThanOrEqual(20);
    expect(low).toBeGreaterThanOrEqual(-20);
  });
});

// ---------------------------------------------------------------------------
// detectLanguageMismatch
// ---------------------------------------------------------------------------

describe('detectLanguageMismatch', () => {
  it('reports consistent when both messages are Latin-script', () => {
    const result = detectLanguageMismatch('Hello world', 'Goodbye world');
    expect(result.isConsistent).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('reports inconsistent when one message is heavily CJK and the other is not', () => {
    const cjk = '这是一个关于意识的哲学辩论。我认为意识是不可还原的主观体验。';
    const latin = 'Consciousness is simply a product of complex information processing.';
    const result = detectLanguageMismatch(cjk, latin);
    expect(result.isConsistent).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it('reports consistent when both messages are heavily CJK', () => {
    const cjkA = '这是一个关于意识的哲学辩论。我认为意识是不可还原的主观体验。';
    const cjkB = '我不同意。意识可以用物理过程来解释，不需要非物质的元素。';
    const result = detectLanguageMismatch(cjkA, cjkB);
    expect(result.isConsistent).toBe(true);
  });

  it('handles empty strings without throwing', () => {
    expect(() => detectLanguageMismatch('', '')).not.toThrow();
    const result = detectLanguageMismatch('', '');
    expect(result.isConsistent).toBe(true);
  });
});
