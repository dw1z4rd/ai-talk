import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateScorecard,
  synthScoresFromPairwise,
  applyPairwiseFloors,
  calculateMomentumShift,
  calculateFrameControlShift,
  detectLanguageMismatch,
  generatePairwisePrompt,
  generatePairwiseSystemPrompt,
  generateJudgeSystemPrompt,
  classifyDebateDomain,
  createFallbackAnalysis,
  parseJudgeAnalysis,
  generateRubricHarmonization,
  computeHarmonizationFlags,
  reconcileRoundWinners,
  detectPositionalConvergence,
  generateNarrativeVerdictText,
} from "./analysis";
import type {
  DebateScorecard,
  PairwiseRound,
  MomentumTracker,
  FrameControlTracker,
  LiveJudge,
} from "./types";
import type { Message } from "$lib/agents";
import { JUDGE_SPECIALIZATION_CONFIGS } from "./types";

// ---------------------------------------------------------------------------
// Mock $lib/agents for generateRubricHarmonization tests
// ---------------------------------------------------------------------------

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn<[string, Record<string, unknown>], Promise<string>>(),
}));

vi.mock("$lib/agents", async (importOriginal) => {
  const original = await importOriginal<typeof import("$lib/agents")>();
  return {
    ...original,
    MODEL_CATALOG: {
      ...original.MODEL_CATALOG,
      "gpt-oss:120b-cloud": {
        name: "Test Model",
        color: "#000",
        makeProvider: () => ({ generateText: mockGenerateText }),
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRound(
  prevAgentId: string,
  prevAgentName: string,
  curAgentId: string,
  curAgentName: string,
  logicWinner: string,
  tacticsWinner: string,
  rhetoricWinner: string,
  opts: { roundNumber?: number; isFallback?: boolean } = {},
): PairwiseRound {
  return {
    roundNumber: opts.roundNumber ?? 1,
    prevTurn: {
      turnNumber: 1,
      agentId: prevAgentId,
      agentName: prevAgentName,
      message: "prev msg",
    },
    curTurn: {
      turnNumber: 2,
      agentId: curAgentId,
      agentName: curAgentName,
      message: "cur msg",
    },
    logicWinner,
    tacticsWinner,
    rhetoricWinner,
    logicDelta: "logic delta",
    tacticsDelta: "tactics delta",
    rhetoricDelta: "rhetoric delta",
    isFallback: opts.isFallback ?? false,
  };
}

function emptyScorecard(): DebateScorecard {
  return { rounds: [], winTallies: {}, overallWinner: null };
}

function makeMomentumTracker(
  agentId: string,
  current: number,
): MomentumTracker {
  return {
    currentMomentum: { [agentId]: current },
    momentumHistory: {},
    lastMomentumShift: {},
    momentumTrend: {},
  };
}

function makeFrameControlTracker(
  agentId: string,
  current: number,
): FrameControlTracker {
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

describe("updateScorecard", () => {
  it("adds the round to the rounds array", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toBe(round);
  });

  it("increments win tallies when one agent sweeps all three dimensions", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.winTallies["a"].logic).toBe(1);
    expect(result.winTallies["a"].tactics).toBe(1);
    expect(result.winTallies["a"].rhetoric).toBe(1);
    expect(result.winTallies["a"].total).toBe(3);
    expect(result.winTallies["b"].total).toBe(0);
  });

  it("increments win tallies for a split round", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "b");
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.winTallies["a"].logic).toBe(1);
    expect(result.winTallies["b"].tactics).toBe(1);
    expect(result.winTallies["b"].rhetoric).toBe(1);
    expect(result.winTallies["a"].total).toBe(1);
    expect(result.winTallies["b"].total).toBe(2);
  });

  it("accumulates tallies across multiple rounds", () => {
    const round1 = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "b", {
      roundNumber: 1,
    });
    const round2 = makeRound("b", "Agent B", "a", "Agent A", "a", "b", "a", {
      roundNumber: 2,
    });

    let sc = updateScorecard(
      emptyScorecard(),
      round1,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    sc = updateScorecard(sc, round2, "a", "Agent A", "b", "Agent B");

    // Round 1: a wins logic+tactics, b wins rhetoric → a=2, b=1
    // Round 2: a wins logic+rhetoric, b wins tactics   → a=2, b=1
    // Cumulative: a=4, b=2
    expect(sc.winTallies["a"].total).toBe(4);
    expect(sc.winTallies["b"].total).toBe(2);
    expect(sc.rounds).toHaveLength(2);
  });

  it("sets overallWinner when one agent has more total wins", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.overallWinner).toBe("a");
  });

  it("leaves overallWinner null on a draw", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "a");
    let sc = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    // Round 2: b wins 2, a wins 1 → cumulative tie (a=2, b=2 is not achievable with 3 dims)
    // Use a second round where b sweeps to equalize totals
    const round2 = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "a", {
      roundNumber: 2,
    });
    sc = updateScorecard(sc, round2, "a", "Agent A", "b", "Agent B");
    // a total = 2 (logic R1 + rhetoric R2), b total = 4... not a draw with 6 points
    // Let's directly test a=3, b=3 by adding a round that balances
    const round3 = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "b", {
      roundNumber: 3,
    });
    sc = updateScorecard(sc, round3, "a", "Agent A", "b", "Agent B");
    // After 3 rounds: a=(2+1+1)=4 wins? Let's just verify null is possible
    // The easiest draw test: two rounds, a sweeps one, b sweeps another
    let sc2 = updateScorecard(
      emptyScorecard(),
      makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a"),
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    sc2 = updateScorecard(
      sc2,
      makeRound("a", "Agent A", "b", "Agent B", "b", "b", "b"),
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(sc2.winTallies["a"].total).toBe(3);
    expect(sc2.winTallies["b"].total).toBe(3);
    expect(sc2.overallWinner).toBeNull();
  });

  it("handles fallback rounds correctly (same logic as normal rounds)", () => {
    const fallback = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a", {
      isFallback: true,
    });
    const result = updateScorecard(
      emptyScorecard(),
      fallback,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.winTallies["a"].total).toBe(3);
    expect(result.rounds[0].isFallback).toBe(true);
  });

  it("preserves existing win tallies from prior scorecard", () => {
    const existing: DebateScorecard = {
      rounds: [],
      winTallies: {
        a: {
          agentName: "Agent A",
          logic: 2,
          tactics: 1,
          rhetoric: 0,
          total: 3,
        },
        b: {
          agentName: "Agent B",
          logic: 0,
          tactics: 1,
          rhetoric: 2,
          total: 3,
        },
      },
      overallWinner: null,
    };
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const result = updateScorecard(
      existing,
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.winTallies["a"].total).toBe(6);
    expect(result.winTallies["b"].total).toBe(3);
    expect(result.overallWinner).toBe("a");
  });

  it("records a detected counterfactual to counterfactualTrack", () => {
    const round: PairwiseRound = {
      ...makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a"),
      counterfactualDetected: {
        agentId: "a",
        summary: "A no-X world argument",
      },
    };
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.counterfactualTrack?.["a"]).toBe(true);
    expect(result.counterfactualTrack?.["b"]).toBeUndefined();
  });

  it("marks the correct agent when counterfactual is submitted by the curTurn agent", () => {
    const round: PairwiseRound = {
      ...makeRound("a", "Agent A", "b", "Agent B", "b", "b", "b"),
      counterfactualDetected: { agentId: "b", summary: "B counterfactual" },
    };
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.counterfactualTrack?.["b"]).toBe(true);
    expect(result.counterfactualTrack?.["a"]).toBeUndefined();
  });

  it("persists counterfactualTrack across multiple rounds", () => {
    const round1: PairwiseRound = {
      ...makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a", {
        roundNumber: 1,
      }),
      counterfactualDetected: {
        agentId: "a",
        summary: "A counterfactual Round 1",
      },
    };
    const round2 = makeRound("b", "Agent B", "a", "Agent A", "b", "b", "b", {
      roundNumber: 2,
    });

    let sc = updateScorecard(
      emptyScorecard(),
      round1,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    sc = updateScorecard(sc, round2, "a", "Agent A", "b", "Agent B");

    // a's counterfactual from round 1 must still be present after round 2
    expect(sc.counterfactualTrack?.["a"]).toBe(true);
    expect(sc.counterfactualTrack?.["b"]).toBeUndefined();
  });

  it("does not set counterfactualTrack entry when no counterfactual is detected", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const result = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(result.counterfactualTrack).toBeDefined();
    expect(Object.keys(result.counterfactualTrack!)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// synthScoresFromPairwise
// ---------------------------------------------------------------------------

describe("synthScoresFromPairwise", () => {
  it("returns high scores on all dimensions when agent wins all three", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "b");
    const scores = synthScoresFromPairwise(round, "b");
    // Thresholds from pressure.ts: logicalCoherence high > 28, rhetoricalForce high > 21, tacticalEffectiveness high > 21
    expect(scores.logicalCoherence).toBeGreaterThan(28);
    expect(scores.rhetoricalForce).toBeGreaterThan(21);
    expect(scores.tacticalEffectiveness).toBeGreaterThan(21);
    expect(scores.overallScore).toBeGreaterThan(70); // reinforcement level
  });

  it("returns low scores on all dimensions when agent loses all three", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const scores = synthScoresFromPairwise(round, "b");
    expect(scores.logicalCoherence).toBeLessThan(16);
    expect(scores.rhetoricalForce).toBeLessThan(12);
    expect(scores.tacticalEffectiveness).toBeLessThan(12);
    expect(scores.overallScore).toBeLessThan(40);
  });

  it("produces higher overallScore for more wins (monotonic)", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "a");
    const twoWins = synthScoresFromPairwise(round, "b");
    const allWins = synthScoresFromPairwise(
      makeRound("a", "A", "b", "B", "b", "b", "b"),
      "b",
    );
    const noWins = synthScoresFromPairwise(
      makeRound("a", "A", "b", "B", "a", "a", "a"),
      "b",
    );
    expect(allWins.overallScore).toBeGreaterThan(twoWins.overallScore);
    expect(twoWins.overallScore).toBeGreaterThan(noWins.overallScore);
  });

  it("all returned scores are numbers", () => {
    const round = makeRound("a", "A", "b", "B", "a", "b", "a");
    const scores = synthScoresFromPairwise(round, "a");
    for (const v of Object.values(scores)) {
      expect(typeof v).toBe("number");
    }
  });

  // ── Tie (Draw) mapping ──────────────────────────────────────────────────

  it("returns neutral-zone scores when all three dimensions are draws", () => {
    const round = makeRound(
      "a",
      "Agent A",
      "b",
      "Agent B",
      "tie",
      "tie",
      "tie",
    );
    const scoresB = synthScoresFromPairwise(round, "b");
    // Logic draw → 22 (neutral zone: 16 < 22 < 28)
    expect(scoresB.logicalCoherence).toBe(22);
    expect(scoresB.logicalCoherence).toBeGreaterThan(16); // above low threshold
    expect(scoresB.logicalCoherence).toBeLessThan(28); // below high threshold
    // Tactics/Rhetoric draw → 17 (neutral zone: 12 < 17 < 21)
    expect(scoresB.tacticalEffectiveness).toBe(17);
    expect(scoresB.tacticalEffectiveness).toBeGreaterThan(12);
    expect(scoresB.tacticalEffectiveness).toBeLessThan(21);
    expect(scoresB.rhetoricalForce).toBe(17);
    expect(scoresB.rhetoricalForce).toBeGreaterThan(12);
    expect(scoresB.rhetoricalForce).toBeLessThan(21);
  });

  it("produces identical neutral scores for both agents on all-tie round", () => {
    const round = makeRound(
      "a",
      "Agent A",
      "b",
      "Agent B",
      "tie",
      "tie",
      "tie",
    );
    const forA = synthScoresFromPairwise(round, "a");
    const forB = synthScoresFromPairwise(round, "b");
    expect(forA.logicalCoherence).toBe(forB.logicalCoherence);
    expect(forA.tacticalEffectiveness).toBe(forB.tacticalEffectiveness);
    expect(forA.rhetoricalForce).toBe(forB.rhetoricalForce);
  });

  it("draw Logic is strictly between win and loss Logic values", () => {
    const winRound = makeRound("a", "A", "b", "B", "b", "b", "b");
    const drawRound = makeRound("a", "A", "b", "B", "tie", "b", "b");
    const lossRound = makeRound("a", "A", "b", "B", "a", "b", "b");
    const winScore = synthScoresFromPairwise(winRound, "b").logicalCoherence;
    const drawScore = synthScoresFromPairwise(drawRound, "b").logicalCoherence;
    const lossScore = synthScoresFromPairwise(lossRound, "b").logicalCoherence;
    expect(winScore).toBeGreaterThan(drawScore);
    expect(drawScore).toBeGreaterThan(lossScore);
  });

  it("draw Tactics/Rhetoric is strictly between win and loss values", () => {
    const winRound = makeRound("a", "A", "b", "B", "b", "b", "b");
    const drawRound = makeRound("a", "A", "b", "B", "b", "tie", "tie");
    const lossRound = makeRound("a", "A", "b", "B", "b", "a", "a");
    const winT = synthScoresFromPairwise(winRound, "b").tacticalEffectiveness;
    const drawT = synthScoresFromPairwise(drawRound, "b").tacticalEffectiveness;
    const lossT = synthScoresFromPairwise(lossRound, "b").tacticalEffectiveness;
    expect(winT).toBeGreaterThan(drawT);
    expect(drawT).toBeGreaterThan(lossT);
  });

  it("overallScore is still monotonic over win count with draws treated correctly", () => {
    // overallScore uses win count (0-3); draw dimensions don't count as wins
    const allWin = makeRound("a", "A", "b", "B", "b", "b", "b");
    const twoWin = makeRound("a", "A", "b", "B", "b", "b", "tie");
    const oneWin = makeRound("a", "A", "b", "B", "b", "tie", "tie");
    const noWin = makeRound("a", "A", "b", "B", "a", "a", "a");
    const s3 = synthScoresFromPairwise(allWin, "b").overallScore;
    const s2 = synthScoresFromPairwise(twoWin, "b").overallScore;
    const s1 = synthScoresFromPairwise(oneWin, "b").overallScore;
    const s0 = synthScoresFromPairwise(noWin, "b").overallScore;
    expect(s3).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThan(s0);
  });
});

// ---------------------------------------------------------------------------
// applyPairwiseFloors
// ---------------------------------------------------------------------------

describe("applyPairwiseFloors", () => {
  const makeScores = (
    l: number,
    t: number,
    r: number,
  ): import("./types").JudgeScores => ({
    logicalCoherence: l,
    tacticalEffectiveness: t,
    rhetoricalForce: r,
    frameControl: 50,
    credibilityScore: 50,
    overallScore: l + t + r,
  });

  it("returns same reference when curVal is already within all bands", () => {
    // WIN bands: Logic [24,40], Tactics [18,30], Rhetoric [18,30]
    const cur = makeScores(28, 22, 20);
    const result = applyPairwiseFloors("b", "b", "b", "b", "a", cur);
    expect(result).toBe(cur); // same reference — no mutation
  });

  it("WIN path: raises Logic below winFloor (24) to 24", () => {
    const cur = makeScores(20, 22, 20);
    const result = applyPairwiseFloors("b", "b", "b", "b", "a", cur);
    expect(result.logicalCoherence).toBe(24);
  });

  it("WIN path: Logic at exactly scaleCeil (40) is preserved, never exceeds 40", () => {
    const cur = makeScores(40, 22, 20);
    const result = applyPairwiseFloors("b", "b", "b", "b", "a", cur);
    expect(result.logicalCoherence).toBe(40);
  });

  it("WIN path consecutive: three successive WIN clamps never lock at scaleCeil", () => {
    // Each call is independent — no prevVal to accumulate — so the result
    // is exactly what the LLM returned (or winFloor if too low).
    const scores = [
      makeScores(26, 20, 20), // round 1 — LLM gave 26
      makeScores(28, 22, 21), // round 2 — LLM gave 28
      makeScores(24, 19, 18), // round 3 — LLM gave 24 (minimum)
    ];
    const results = scores.map((s) =>
      applyPairwiseFloors("b", "b", "b", "b", "a", s),
    );
    // None should be locked at the same value due to accumulation
    expect(results[0].logicalCoherence).toBe(26);
    expect(results[1].logicalCoherence).toBe(28);
    expect(results[2].logicalCoherence).toBe(24); // floor, not ceiling
    // All unique — no counter-lock
    const unique = new Set(results.map((r) => r.logicalCoherence));
    expect(unique.size).toBeGreaterThan(1);
  });

  it("DRAW path: Logic above drawCeil (30) is clamped down to 30", () => {
    // LLM returned 36 on a draw — that would contradict a win result, clamp it
    const cur = makeScores(36, 17, 17);
    const result = applyPairwiseFloors("tie", "tie", "tie", "b", "a", cur);
    expect(result.logicalCoherence).toBe(30);
  });

  it("DRAW path: Logic below drawFloor (18) is raised to 18", () => {
    const cur = makeScores(10, 17, 17);
    const result = applyPairwiseFloors("tie", "tie", "tie", "b", "a", cur);
    expect(result.logicalCoherence).toBe(18);
  });

  it("DRAW path: any curVal lands in [drawFloor, drawCeil] regardless of starting value", () => {
    const lowCur = makeScores(0, 13, 13);
    const highCur = makeScores(40, 30, 30);
    const midCur = makeScores(24, 18, 18);
    for (const cur of [lowCur, highCur, midCur]) {
      const r = applyPairwiseFloors("tie", "tie", "tie", "b", "a", cur);
      expect(r.logicalCoherence).toBeGreaterThanOrEqual(18); // drawFloor
      expect(r.logicalCoherence).toBeLessThanOrEqual(30); // drawCeil
    }
  });

  it("LOSS path: Logic above lossCeil (22) is clamped down to 22", () => {
    const cur = makeScores(32, 14, 14);
    const result = applyPairwiseFloors("a", "a", "a", "b", "a", cur);
    expect(result.logicalCoherence).toBe(22);
  });

  it("LOSS path: Logic below lossFloor (10) is raised to 10", () => {
    const cur = makeScores(4, 10, 10);
    const result = applyPairwiseFloors("a", "a", "a", "b", "a", cur);
    expect(result.logicalCoherence).toBe(10);
  });

  it("LOSS path: any curVal lands in [lossFloor, lossCeil] regardless of starting value", () => {
    for (const v of [0, 5, 22, 30, 40]) {
      const cur = makeScores(v, 10, 10);
      const r = applyPairwiseFloors("a", "a", "a", "b", "a", cur);
      expect(r.logicalCoherence).toBeGreaterThanOrEqual(10); // lossFloor
      expect(r.logicalCoherence).toBeLessThanOrEqual(22); // lossCeil
    }
  });

  it("WIN band floor > LOSS band ceil (non-overlapping invariant NOT required, but WIN must never be ≤ LOSS max)", () => {
    // The win floor (24) must be above the loss ceil (22) for Logic — validate constants
    // by exercising both ends.
    const atLossMax = makeScores(22, 16, 16);
    const atWinMin = makeScores(24, 18, 18);
    const lossResult = applyPairwiseFloors("a", "a", "a", "b", "a", atLossMax);
    const winResult = applyPairwiseFloors("b", "b", "b", "b", "a", atWinMin);
    expect(winResult.logicalCoherence).toBeGreaterThanOrEqual(
      lossResult.logicalCoherence,
    );
  });

  it("dimensions are clamped independently — one WIN, one DRAW, one LOSS", () => {
    const cur = makeScores(36, 26, 8);
    // Logic WIN (b wins), Tactics DRAW, Rhetoric LOSS (a wins)
    const result = applyPairwiseFloors("b", "tie", "a", "b", "a", cur);
    // Logic 36: WIN band [24,40] → 36 (unchanged)
    expect(result.logicalCoherence).toBe(36);
    // Tactics 26: DRAW band [13,22] → clamped down to 22
    expect(result.tacticalEffectiveness).toBe(22);
    // Rhetoric 8: LOSS band [7,16] → 8 (unchanged, within band)
    expect(result.rhetoricalForce).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// computeHarmonizationFlags
// ---------------------------------------------------------------------------

function makeAbsScores(
  overrides: Partial<import("./types").JudgeScores> = {},
): import("./types").JudgeScores {
  return {
    logicalCoherence: 20,
    rhetoricalForce: 15,
    tacticalEffectiveness: 15,
    frameControl: 50,
    credibilityScore: 50,
    overallScore: 50,
    ...overrides,
  };
}

describe("computeHarmonizationFlags", () => {
  it("returns empty array when either absolute score set is missing", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    expect(computeHarmonizationFlags(round, undefined, undefined)).toHaveLength(
      0,
    );
    expect(
      computeHarmonizationFlags(round, makeAbsScores(), undefined),
    ).toHaveLength(0);
    expect(
      computeHarmonizationFlags(round, undefined, makeAbsScores()),
    ).toHaveLength(0);
  });

  it("returns no flags when pairwise winner matches absolute score leader", () => {
    // curTurn agent 'b' wins logic pairwise; cur also has higher logicalCoherence
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "b");
    const prev = makeAbsScores({
      logicalCoherence: 10,
      rhetoricalForce: 10,
      tacticalEffectiveness: 10,
      overallScore: 30,
    });
    const cur = makeAbsScores({
      logicalCoherence: 30,
      rhetoricalForce: 25,
      tacticalEffectiveness: 25,
      overallScore: 75,
    });
    expect(computeHarmonizationFlags(round, cur, prev)).toHaveLength(0);
  });

  it("flags logic divergence when gap meets threshold (5) and winner is wrong", () => {
    // Pairwise says 'a' (prevTurn) wins logic, but cur has higher logicalCoherence
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "b");
    // gap = 30 - 10 = 20, threshold = 5 → should flag
    const prev = makeAbsScores({ logicalCoherence: 10 });
    const cur = makeAbsScores({ logicalCoherence: 30 });
    const flags = computeHarmonizationFlags(round, cur, prev);
    const logicFlag = flags.find((f) => f.dimension === "logic");
    expect(logicFlag).toBeDefined();
    expect(logicFlag?.pairwiseWinner).toBe("a");
    expect(logicFlag?.absoluteScoreLeader).toBe("b");
    expect(logicFlag?.divergenceMagnitude).toBe(20);
  });

  it("does NOT flag logic divergence when gap is below threshold (5)", () => {
    // gap = 4, below the 5 threshold
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "b");
    const prev = makeAbsScores({ logicalCoherence: 10 });
    const cur = makeAbsScores({ logicalCoherence: 14 });
    const flags = computeHarmonizationFlags(round, cur, prev);
    expect(flags.find((f) => f.dimension === "logic")).toBeUndefined();
  });

  it("flags tactics divergence when gap meets threshold (3) and winner is wrong", () => {
    // gap = 10 ≥ 3, pairwise gives 'a' but cur has higher tacticalEffectiveness
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "a", "b");
    const prev = makeAbsScores({ tacticalEffectiveness: 8 });
    const cur = makeAbsScores({ tacticalEffectiveness: 18 });
    const flags = computeHarmonizationFlags(round, cur, prev);
    const tacticsFlag = flags.find((f) => f.dimension === "tactics");
    expect(tacticsFlag).toBeDefined();
    expect(tacticsFlag?.divergenceMagnitude).toBe(10);
  });

  it("flags rhetoric divergence when gap meets threshold (3) and winner is wrong", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "a");
    const prev = makeAbsScores({ rhetoricalForce: 8 });
    const cur = makeAbsScores({ rhetoricalForce: 20 });
    const flags = computeHarmonizationFlags(round, cur, prev);
    const rhetoricFlag = flags.find((f) => f.dimension === "rhetoric");
    expect(rhetoricFlag).toBeDefined();
    expect(rhetoricFlag?.divergenceMagnitude).toBe(12);
  });

  it("always flags when absolute scores are exactly equal and a winner was assigned", () => {
    // Both agents score identically on tactics — assigning a winner is arbitrary
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "b");
    const scores = makeAbsScores({ tacticalEffectiveness: 20 });
    const flags = computeHarmonizationFlags(round, scores, scores);
    const tacticsFlag = flags.find((f) => f.dimension === "tactics");
    expect(tacticsFlag).toBeDefined();
    expect(tacticsFlag?.absoluteScoreLeader).toBe("tie");
    expect(tacticsFlag?.divergenceMagnitude).toBe(0);
  });

  it("does NOT flag a tie dimension when the winner is already 'tie'", () => {
    // After reconcileRoundWinners the tactics winner is set to 'tie'; no redundant flag
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "tie", "b");
    const scores = makeAbsScores({ tacticalEffectiveness: 20 });
    const flags = computeHarmonizationFlags(round, scores, scores);
    expect(flags.find((f) => f.dimension === "tactics")).toBeUndefined();
  });

  it("flags overall divergence when majority pairwise winner mismatches absolute overall leader", () => {
    // Pairwise: 'a' wins all 3 → overall majority winner = 'a'
    // Absolute: cur ('b') has much higher overallScore → gap ≥ 15
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const prev = makeAbsScores({ overallScore: 80 }); // prevTurn = 'a'
    const cur = makeAbsScores({ overallScore: 30 }); // curTurn  = 'b'
    // gap = 50, cur < prev → absoluteScoreLeader = 'a' (prev) which matches pairwise winner 'a' → no flag
    // Use the opposite: pairwise says 'a' wins but cur has higher score
    const round2 = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const prevLow = makeAbsScores({ overallScore: 30 });
    const curHigh = makeAbsScores({ overallScore: 80 });
    // pairwise winner = 'a' (prev), absoluteLeader = 'b' (cur), gap = 50 ≥ 15 → flag
    const flags = computeHarmonizationFlags(round2, curHigh, prevLow);
    const overallFlag = flags.find((f) => f.dimension === "overall");
    expect(overallFlag).toBeDefined();
    expect(overallFlag?.pairwiseWinner).toBe("a");
    expect(overallFlag?.absoluteScoreLeader).toBe("b");
  });

  it("does NOT emit overall flag when pairwise winner matches the absolute overall leader", () => {
    // 'b' (curTurn) wins 2 of 3 dimensions → majority winner = 'b'
    // Absolute: cur ('b') has higher overallScore → pairwise winner matches absolute leader → no flag
    const roundBWins = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "a"); // b wins 2 → majority b
    const prevScore = makeAbsScores({ overallScore: 30 });
    const curScore = makeAbsScores({ overallScore: 80 }); // cur='b' has higher score, matches majority winner 'b'
    const flags = computeHarmonizationFlags(roundBWins, curScore, prevScore);
    expect(flags.find((f) => f.dimension === "overall")).toBeUndefined();
  });

  it("does NOT emit overall flag when gap is below threshold (15)", () => {
    // pairwise 'a' wins all, but overall gap is only 14 → below threshold
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const prev = makeAbsScores({ overallScore: 30 });
    const cur = makeAbsScores({ overallScore: 44 }); // gap = 14 < 15
    const flags = computeHarmonizationFlags(round, cur, prev);
    expect(flags.find((f) => f.dimension === "overall")).toBeUndefined();
  });

  it("returns multiple flags when several dimensions diverge simultaneously", () => {
    // Pairwise: 'a' wins all 3 (and overall majority = 'a')
    // Absolute: cur ('b') higher on logic and tactics
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    const prev = makeAbsScores({
      logicalCoherence: 10,
      tacticalEffectiveness: 8,
      overallScore: 30,
    });
    const cur = makeAbsScores({
      logicalCoherence: 30,
      tacticalEffectiveness: 22,
      overallScore: 80,
    });
    const flags = computeHarmonizationFlags(round, cur, prev);
    const dims = flags.map((f) => f.dimension);
    expect(dims).toContain("logic");
    expect(dims).toContain("tactics");
    expect(dims).toContain("overall");
  });

  it("re-computation with post-penalty scores clears a stale pre-penalty flag", () => {
    // Scenario: at round-processing time, prev agent ('a') had absolute logic=30
    // and cur agent ('b') had absolute logic=22. Pairwise awarded 'b' the win.
    // A flag fires: 'a' leads absolutely (gap 8), diverging from the pairwise result.
    //
    // Later, a retroactive penalty reduces 'a's stored score from 30→22 AND a
    // retroactive restore raises 'b's score from 22→30. The re-reconciliation loop
    // calls computeHarmonizationFlags again with the updated scores. The flag
    // should now be cleared: post-penalty 'b' (cur) leads absolutely (30 > 22),
    // which matches the pairwise winner — no discrepancy.
    const round = makeRound("a", "Agent A", "b", "Agent B", "b", "b", "b");

    // Pre-penalty scores: 'a' (prev) leads on logic
    const prePenaltyPrev = makeAbsScores({
      logicalCoherence: 30,
      overallScore: 60,
    });
    const prePenaltyCur = makeAbsScores({
      logicalCoherence: 22,
      overallScore: 52,
    });
    const prePenaltyFlags = computeHarmonizationFlags(
      round,
      prePenaltyCur,
      prePenaltyPrev,
    );
    const prePenaltyLogicFlag = prePenaltyFlags.find(
      (f) => f.dimension === "logic",
    );
    expect(prePenaltyLogicFlag).toBeDefined();
    expect(prePenaltyLogicFlag?.absoluteScoreLeader).toBe("a"); // 'a' led before penalty

    // Post-penalty scores: 'b' (cur) now leads on logic
    const postPenaltyPrev = makeAbsScores({
      logicalCoherence: 22,
      overallScore: 52,
    });
    const postPenaltyCur = makeAbsScores({
      logicalCoherence: 30,
      overallScore: 60,
    });
    const postPenaltyFlags = computeHarmonizationFlags(
      round,
      postPenaltyCur,
      postPenaltyPrev,
    );
    // 'b' wins pairwise AND 'b' leads absolutely → no logic flag
    expect(
      postPenaltyFlags.find((f) => f.dimension === "logic"),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reconcileRoundWinners
// ---------------------------------------------------------------------------

describe("reconcileRoundWinners", () => {
  it("returns the round unchanged when absolute scores are missing", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    expect(reconcileRoundWinners(round, undefined, undefined)).toBe(round);
    expect(reconcileRoundWinners(round, makeAbsScores(), undefined)).toBe(
      round,
    );
    expect(reconcileRoundWinners(round, undefined, makeAbsScores())).toBe(
      round,
    );
  });

  it("sets winner to 'tie' when both turns have equal absolute scores on a dimension", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "a");
    // All three dimensions equal → all winners should be 'tie'
    const scores = makeAbsScores();
    const reconciled = reconcileRoundWinners(round, scores, scores);
    expect(reconciled.logicWinner).toBe("tie");
    expect(reconciled.tacticsWinner).toBe("tie");
    expect(reconciled.rhetoricWinner).toBe("tie");
  });

  it("preserves *WinnerRaw from the original pairwise winner", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "a");
    const scores = makeAbsScores(); // equal → all forced to "tie"
    const reconciled = reconcileRoundWinners(round, scores, scores);
    expect(reconciled.logicWinner).toBe("tie");
    expect(reconciled.logicWinnerRaw).toBe("a"); // original preserved
    expect(reconciled.tacticsWinnerRaw).toBe("b");
    expect(reconciled.rhetoricWinnerRaw).toBe("a");
  });

  it("preserves the existing pairwise winner when absolute scores differ", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "b", "a");
    const prev = makeAbsScores({
      logicalCoherence: 10,
      tacticalEffectiveness: 20,
      rhetoricalForce: 10,
    });
    const cur = makeAbsScores({
      logicalCoherence: 30,
      tacticalEffectiveness: 10,
      rhetoricalForce: 25,
    });
    const reconciled = reconcileRoundWinners(round, cur, prev);
    // Scores differ on all dims → pairwise winners unchanged
    expect(reconciled.logicWinner).toBe("a");
    expect(reconciled.tacticsWinner).toBe("b");
    expect(reconciled.rhetoricWinner).toBe("a");
  });

  it("only overrides the tied dimension, leaving others intact", () => {
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "a", "b");
    // tactics tied, logic and rhetoric differ
    const prev = makeAbsScores({
      logicalCoherence: 10,
      tacticalEffectiveness: 15,
      rhetoricalForce: 20,
    });
    const cur = makeAbsScores({
      logicalCoherence: 30,
      tacticalEffectiveness: 15,
      rhetoricalForce: 10,
    });
    const reconciled = reconcileRoundWinners(round, cur, prev);
    expect(reconciled.logicWinner).toBe("a"); // unchanged
    expect(reconciled.tacticsWinner).toBe("tie"); // overridden
    expect(reconciled.rhetoricWinner).toBe("b"); // unchanged
  });

  it("restores the original pairwise winner when a retroactive penalty makes previously-equal scores diverge", () => {
    // Initial state: round was already reconciled to 'tie' on all dims (equal scores).
    // logicWinnerRaw preserved the original pairwise winner 'a'.
    const tiedRound: PairwiseRound = {
      ...makeRound("a", "Agent A", "b", "Agent B", "tie", "tie", "tie"),
      logicWinnerRaw: "a",
      tacticsWinnerRaw: "a",
      rhetoricWinnerRaw: "b",
    };
    // After a retroactive penalty, cur (Agent B) logic score drops: no longer equal.
    const prev = makeAbsScores({
      logicalCoherence: 26,
      tacticalEffectiveness: 15,
      rhetoricalForce: 20,
    });
    const cur = makeAbsScores({
      logicalCoherence: 14,
      tacticalEffectiveness: 15,
      rhetoricalForce: 20,
    });
    const reconciled = reconcileRoundWinners(tiedRound, cur, prev);
    // Logic diverged → restore to raw pairwise winner
    expect(reconciled.logicWinner).toBe("a");
    // Tactics/rhetoric still equal → remain "tie"
    expect(reconciled.tacticsWinner).toBe("tie");
    expect(reconciled.rhetoricWinner).toBe("tie");
    // Raw values must be preserved
    expect(reconciled.logicWinnerRaw).toBe("a");
    expect(reconciled.tacticsWinnerRaw).toBe("a");
    expect(reconciled.rhetoricWinnerRaw).toBe("b");
  });

  it("does not allow a 'tie' logicWinner to become a real winner for that dim if it had an explicit 'tie' pairwise call", () => {
    // Here the round was explicitly set to 'tie' from the start (no raw field),
    // meaning the LLM literally returned a draw on that dim. Diverged scores
    // should NOT restore to 'tie' as the raw winner (it would just stay 'tie').
    const round: PairwiseRound = {
      ...makeRound("a", "Agent A", "b", "Agent B", "tie", "a", "a"),
      // No logicWinnerRaw — raw is inferred as "tie"
    };
    const prev = makeAbsScores({ logicalCoherence: 26 });
    const cur = makeAbsScores({ logicalCoherence: 14 });
    const reconciled = reconcileRoundWinners(round, cur, prev);
    // The raw was 'tie', so unequal scores → winner stays 'tie' (raw is returned)
    expect(reconciled.logicWinner).toBe("tie");
  });

  it("scorecard tally skips 'tie' winners (updateScorecard integration)", () => {
    // A round where tactics is 'tie' should not increment either agent's tally
    const round = makeRound("a", "Agent A", "b", "Agent B", "a", "tie", "b");
    const sc = updateScorecard(
      emptyScorecard(),
      round,
      "a",
      "Agent A",
      "b",
      "Agent B",
    );
    expect(sc.winTallies["a"].tactics).toBe(0);
    expect(sc.winTallies["b"].tactics).toBe(0);
    expect(sc.winTallies["a"].total).toBe(1); // only logic
    expect(sc.winTallies["b"].total).toBe(1); // only rhetoric
  });
});

// ---------------------------------------------------------------------------
// calculateMomentumShift (corrected baselines)
// ---------------------------------------------------------------------------

describe("calculateMomentumShift", () => {
  it("returns a positive shift for strong scores", () => {
    // overallScore 82, tacticalEffectiveness 24 (both above midpoints 50 and 15)
    const tracker = makeMomentumTracker("a", 0);
    const shift = calculateMomentumShift(
      {
        logicalCoherence: 30,
        rhetoricalForce: 24,
        frameControl: 82,
        credibilityScore: 82,
        tacticalEffectiveness: 24,
        overallScore: 82,
      },
      tracker,
      "a",
    );
    expect(shift).toBeGreaterThan(0);
  });

  it("returns a negative shift for weak scores", () => {
    const tracker = makeMomentumTracker("a", 0);
    const shift = calculateMomentumShift(
      {
        logicalCoherence: 14,
        rhetoricalForce: 10,
        frameControl: 30,
        credibilityScore: 30,
        tacticalEffectiveness: 10,
        overallScore: 30,
      },
      tracker,
      "a",
    );
    expect(shift).toBeLessThan(0);
  });

  it("returns near-zero shift for exactly-midpoint scores", () => {
    // overallScore=50 (midpoint), tacticalEffectiveness=15 (midpoint), credibilityScore=50 (midpoint)
    const tracker = makeMomentumTracker("a", 0);
    const shift = calculateMomentumShift(
      {
        logicalCoherence: 20,
        rhetoricalForce: 15,
        frameControl: 50,
        credibilityScore: 50,
        tacticalEffectiveness: 15,
        overallScore: 50,
      },
      tracker,
      "a",
    );
    expect(shift).toBeCloseTo(0, 5);
  });

  it("is clamped to −25..+25", () => {
    const tracker = makeMomentumTracker("a", 0);
    const high = calculateMomentumShift(
      {
        logicalCoherence: 40,
        rhetoricalForce: 30,
        frameControl: 100,
        credibilityScore: 100,
        tacticalEffectiveness: 30,
        overallScore: 100,
      },
      tracker,
      "a",
    );
    const low = calculateMomentumShift(
      {
        logicalCoherence: 0,
        rhetoricalForce: 0,
        frameControl: 0,
        credibilityScore: 0,
        tacticalEffectiveness: 0,
        overallScore: 0,
      },
      tracker,
      "a",
    );
    expect(high).toBeLessThanOrEqual(25);
    expect(low).toBeGreaterThanOrEqual(-25);
  });
});

// ---------------------------------------------------------------------------
// calculateFrameControlShift (corrected baselines)
// ---------------------------------------------------------------------------

describe("calculateFrameControlShift", () => {
  it("returns a positive shift for strong scores", () => {
    const tracker = makeFrameControlTracker("a", 0);
    const shift = calculateFrameControlShift(
      {
        logicalCoherence: 30,
        rhetoricalForce: 24,
        frameControl: 82,
        credibilityScore: 82,
        tacticalEffectiveness: 24,
        overallScore: 82,
      },
      tracker,
      "a",
    );
    expect(shift).toBeGreaterThan(0);
  });

  it("returns a negative shift for weak scores", () => {
    const tracker = makeFrameControlTracker("a", 0);
    const shift = calculateFrameControlShift(
      {
        logicalCoherence: 14,
        rhetoricalForce: 10,
        frameControl: 30,
        credibilityScore: 30,
        tacticalEffectiveness: 10,
        overallScore: 30,
      },
      tracker,
      "a",
    );
    expect(shift).toBeLessThan(0);
  });

  it("returns near-zero shift for exactly-midpoint scores", () => {
    // logicalCoherence=20 (midpoint of 0-40), rhetoricalForce=15 (midpoint of 0-30),
    // tacticalEffectiveness=15 (midpoint of 0-30) → baseControl=0, tacticalModifier=0
    const tracker = makeFrameControlTracker("a", 0);
    const shift = calculateFrameControlShift(
      {
        logicalCoherence: 20,
        rhetoricalForce: 15,
        frameControl: 50,
        credibilityScore: 50,
        tacticalEffectiveness: 15,
        overallScore: 50,
      },
      tracker,
      "a",
    );
    expect(shift).toBeCloseTo(0, 5);
  });

  it("is clamped to −20..+20", () => {
    const tracker = makeFrameControlTracker("a", 0);
    const high = calculateFrameControlShift(
      {
        logicalCoherence: 40,
        rhetoricalForce: 30,
        frameControl: 100,
        credibilityScore: 100,
        tacticalEffectiveness: 30,
        overallScore: 100,
      },
      tracker,
      "a",
    );
    const low = calculateFrameControlShift(
      {
        logicalCoherence: 0,
        rhetoricalForce: 0,
        frameControl: 0,
        credibilityScore: 0,
        tacticalEffectiveness: 0,
        overallScore: 0,
      },
      tracker,
      "a",
    );
    expect(high).toBeLessThanOrEqual(20);
    expect(low).toBeGreaterThanOrEqual(-20);
  });
});

// ---------------------------------------------------------------------------
// detectLanguageMismatch
// ---------------------------------------------------------------------------

describe("detectLanguageMismatch", () => {
  it("reports consistent when both messages are Latin-script", () => {
    const result = detectLanguageMismatch("Hello world", "Goodbye world");
    expect(result.isConsistent).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("reports inconsistent when one message is heavily CJK and the other is not", () => {
    const cjk = "这是一个关于意识的哲学辩论。我认为意识是不可还原的主观体验。";
    const latin =
      "Consciousness is simply a product of complex information processing.";
    const result = detectLanguageMismatch(cjk, latin);
    expect(result.isConsistent).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it("reports consistent when both messages are heavily CJK", () => {
    const cjkA = "这是一个关于意识的哲学辩论。我认为意识是不可还原的主观体验。";
    const cjkB = "我不同意。意识可以用物理过程来解释，不需要非物质的元素。";
    const result = detectLanguageMismatch(cjkA, cjkB);
    expect(result.isConsistent).toBe(true);
  });

  it("handles empty strings without throwing", () => {
    expect(() => detectLanguageMismatch("", "")).not.toThrow();
    const result = detectLanguageMismatch("", "");
    expect(result.isConsistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyDebateDomain
// ---------------------------------------------------------------------------

describe("classifyDebateDomain", () => {
  it("classifies consciousness debate as philosophical", () => {
    expect(
      classifyDebateDomain(
        "Does consciousness require qualia that are irreducibly subjective?",
      ),
    ).toBe("philosophical");
  });

  it("classifies climate policy debate as empirical", () => {
    expect(
      classifyDebateDomain(
        "Is the scientific evidence for anthropogenic climate change conclusive?",
      ),
    ).toBe("empirical");
  });

  it("classifies AI regulation debate as policy", () => {
    expect(
      classifyDebateDomain(
        "Should governments ban autonomous weapons through international legislation?",
      ),
    ).toBe("policy");
  });

  it("returns mixed for unrecognized topics", () => {
    expect(classifyDebateDomain("Cats are better than dogs")).toBe("mixed");
  });
});

// ---------------------------------------------------------------------------
// opener penalty verification
// ---------------------------------------------------------------------------

describe("opener penalty verification", () => {
  it("injects OPENING STATEMENT note when isOpeningRound is true", () => {
    const prompt = generatePairwisePrompt(
      "Alice",
      "Opening argument text",
      1,
      "Bob",
      "Response text",
      2,
      "Is AI conscious?",
      true,
    );
    expect(prompt).toContain("[NOTE: Turn 1 is the OPENING statement");
    expect(prompt).toContain("Apply OPENING TURN rules");
  });

  it("does NOT inject opening note for non-opening rounds", () => {
    const prompt = generatePairwisePrompt(
      "Alice",
      "Turn 3 argument",
      3,
      "Bob",
      "Turn 4 argument",
      4,
      "Is AI conscious?",
      false,
    );
    expect(prompt).not.toContain("OPENING statement");
  });

  it("system prompt contains OPENING TURN framing rubric in TACTICS section", () => {
    const sp = generatePairwiseSystemPrompt("Alice", "Bob");
    expect(sp).toContain("OPENING TURN");
    expect(sp).toContain("framing quality");
  });

  it("system prompt contains four-component rhetoric rubric", () => {
    const sp = generatePairwiseSystemPrompt("Alice", "Bob");
    expect(sp).toContain("Expression quality");
    expect(sp).toContain("Structural clarity");
    expect(sp).toContain("Audience awareness");
    expect(sp).toContain("Framing quality");
    expect(sp).toContain("ONE component");
  });

  it("system prompt contains symmetric evidence standard language", () => {
    const sp = generatePairwiseSystemPrompt("Alice", "Bob");
    expect(sp).toContain("Hollow specificity");
    expect(sp).toContain("Citation ≠ Correctness");
  });

  it("opener who wins all three dimensions gets high scores (no opener handicap)", () => {
    const round = makeRound(
      "alice",
      "Alice",
      "bob",
      "Bob",
      "alice",
      "alice",
      "alice",
      { roundNumber: 1 },
    );
    const scores = synthScoresFromPairwise(round, "alice");
    expect(scores.logicalCoherence).toBeGreaterThan(28);
    expect(scores.rhetoricalForce).toBeGreaterThan(21);
    expect(scores.tacticalEffectiveness).toBeGreaterThan(21);
  });

  it("opener who loses all three dimensions gets low scores (no opener protection)", () => {
    const round = makeRound(
      "alice",
      "Alice",
      "bob",
      "Bob",
      "bob",
      "bob",
      "bob",
      { roundNumber: 1 },
    );
    const scores = synthScoresFromPairwise(round, "alice");
    expect(scores.logicalCoherence).toBeLessThan(16);
    expect(scores.rhetoricalForce).toBeLessThan(12);
    expect(scores.tacticalEffectiveness).toBeLessThan(12);
  });
});

// ---------------------------------------------------------------------------
// createFallbackAnalysis score ranges (Issue 6 regression guard)
// ---------------------------------------------------------------------------

describe("createFallbackAnalysis score ranges", () => {
  it("returns scores within valid dimension ranges", () => {
    const config = JUDGE_SPECIALIZATION_CONFIGS["balance"];
    const judge: LiveJudge = {
      id: "j",
      name: "Judge",
      modelId: "gpt-oss:120b-cloud",
      specialization: "balance",
      scoringWeights: config.scoringWeights,
      biasProfile: config.typicalBias,
      lastAnalysis: null,
      analysisCount: 0,
    };
    const agent = { id: "a", name: "Agent A" } as any;
    const opponent = { id: "b", name: "Agent B" } as any;

    const result = createFallbackAnalysis(
      judge,
      agent,
      opponent,
      1,
      "test message",
      "",
      "",
    );

    expect(result.scores.logicalCoherence).toBeGreaterThanOrEqual(4);
    expect(result.scores.logicalCoherence).toBeLessThanOrEqual(40);
    expect(result.scores.rhetoricalForce).toBeGreaterThanOrEqual(3);
    expect(result.scores.rhetoricalForce).toBeLessThanOrEqual(30);
    expect(result.scores.tacticalEffectiveness).toBeGreaterThanOrEqual(3);
    expect(result.scores.tacticalEffectiveness).toBeLessThanOrEqual(30);
    expect(result.scores.overallScore).toBeGreaterThanOrEqual(10);
    expect(result.scores.overallScore).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// parseJudgeAnalysis bounds (Issue 9 regression guard)
// ---------------------------------------------------------------------------

describe("parseJudgeAnalysis bounds", () => {
  const config = JUDGE_SPECIALIZATION_CONFIGS["balance"];
  const mockJudge: LiveJudge = {
    id: "j",
    name: "Test Judge",
    modelId: "gpt-oss:120b-cloud",
    specialization: "balance",
    scoringWeights: config.scoringWeights,
    biasProfile: config.typicalBias,
    lastAnalysis: null,
    analysisCount: 0,
  };
  const mockAgent = { id: "a", name: "Agent A" } as any;
  const mockOpponent = { id: "b", name: "Agent B" } as any;

  it("model returning 10/10/10 maps to exactly 40/30/30 (ceiling enforced)", () => {
    const result = parseJudgeAnalysis(
      '{"logic_score":10,"rhetoric_score":10,"tactics_score":10,"analysis":"Perfect turn."}',
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(40);
    expect(result.scores.rhetoricalForce).toBe(30);
    expect(result.scores.tacticalEffectiveness).toBe(30);
    expect(result.scores.overallScore).toBe(100);
  });

  it("model returning 1/1/1 maps to 4/3/3", () => {
    const result = parseJudgeAnalysis(
      '{"logic_score":1,"rhetoric_score":1,"tactics_score":1,"analysis":"Weak turn."}',
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(4);
    expect(result.scores.rhetoricalForce).toBe(3);
    expect(result.scores.tacticalEffectiveness).toBe(3);
  });

  it("returns fallback scores for invalid JSON", () => {
    const result = parseJudgeAnalysis(
      "not valid json at all",
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(20);
    expect(result.scores.rhetoricalForce).toBe(15);
    expect(result.scores.tacticalEffectiveness).toBe(15);
  });

  it("returns fallback for null input", () => {
    const result = parseJudgeAnalysis(
      null,
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// generatePairwisePrompt with previousLogicDelta
// ---------------------------------------------------------------------------

describe("generatePairwisePrompt previousLogicDelta injection", () => {
  it("injects PREVIOUS ROUND JUDGE NOTE when previousLogicDelta is provided", () => {
    const prompt = generatePairwisePrompt(
      "Alice",
      "Argument A",
      3,
      "Bob",
      "Argument B",
      4,
      "Is AI conscious?",
      false,
      "Alice failed to address the hard problem of consciousness.",
    );
    expect(prompt).toContain("PREVIOUS ROUND JUDGE NOTE");
    expect(prompt).toContain("Alice failed to address the hard problem");
  });

  it("does NOT inject PREVIOUS ROUND JUDGE NOTE when previousLogicDelta is omitted", () => {
    const prompt = generatePairwisePrompt(
      "Alice",
      "Argument A",
      3,
      "Bob",
      "Argument B",
      4,
      "Is AI conscious?",
      false,
    );
    expect(prompt).not.toContain("PREVIOUS ROUND JUDGE NOTE");
  });
});

// ---------------------------------------------------------------------------
// generateRubricHarmonization — deterministic behaviour
// ---------------------------------------------------------------------------

function makeJudge(): LiveJudge {
  const config = JUDGE_SPECIALIZATION_CONFIGS["logic"];
  return {
    id: "j",
    name: "Test Judge",
    modelId: "gpt-oss:120b-cloud",
    specialization: "logic",
    scoringWeights: config.scoringWeights,
    biasProfile: config.typicalBias,
    lastAnalysis: null,
    analysisCount: 0,
  };
}

/** Returns the prompt argument from the most recent mockGenerateText call. */
function lastPromptArg(): string {
  const calls = mockGenerateText.mock.calls;
  return calls[calls.length - 1][0];
}

describe("generateRubricHarmonization", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
    mockGenerateText.mockResolvedValue(
      "Round 1 was consistent. Arc matches. No significant drift detected.",
    );
  });

  // ── Early-return conditions ───────────────────────────────────────────────

  it("returns empty string when rounds array is empty", async () => {
    const result = await generateRubricHarmonization(
      makeJudge(),
      [],
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns empty string when fewer than 3 rounds provided (1 round)", async () => {
    const rounds = [
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: 1 }),
    ];
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns empty string when fewer than 3 rounds provided (2 rounds)", async () => {
    const rounds = [1, 2].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  // ── isFallback filtering ──────────────────────────────────────────────────

  it("returns empty string when all rounds are fallbacks (even with 3+ rounds)", async () => {
    const rounds = [1, 2, 3, 4].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: n,
        isFallback: true,
      }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns empty string when fewer than 3 non-fallback rounds remain after filtering", async () => {
    const rounds = [
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: 1,
        isFallback: true,
      }),
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: 2,
        isFallback: false,
      }),
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: 3,
        isFallback: true,
      }),
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: 4,
        isFallback: false,
      }),
    ];
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("proceeds when at least 3 non-fallback rounds exist amid fallbacks", async () => {
    const rounds = [1, 2, 3, 4, 5].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: n,
        isFallback: n % 2 === 0,
      }),
    );
    // rounds 1, 3, 5 are non-fallback (3 rounds → threshold met)
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).not.toBe("");
    expect(mockGenerateText).toHaveBeenCalled();
  });

  // ── Last-N limiting (slice(-8)) ───────────────────────────────────────────

  it("uses only the last 8 non-fallback rounds when more than 8 are provided", async () => {
    // 10 non-fallback rounds numbered 1–10
    const rounds = Array.from({ length: 10 }, (_, i) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: i + 1,
        isFallback: false,
      }),
    );
    await generateRubricHarmonization(makeJudge(), rounds, "Alice", "Bob");
    const promptArg = lastPromptArg();
    // Rounds 1 and 2 should be excluded (only last 8 = rounds 3–10)
    expect(promptArg).not.toContain("Round 1 ");
    expect(promptArg).not.toContain("Round 2 ");
    expect(promptArg).toContain("Round 3 ");
    expect(promptArg).toContain("Round 10 ");
  });

  it("uses all rounds when 8 or fewer non-fallback rounds are provided", async () => {
    const rounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", {
        roundNumber: i + 1,
        isFallback: false,
      }),
    );
    await generateRubricHarmonization(makeJudge(), rounds, "Alice", "Bob");
    const promptArg = lastPromptArg();
    expect(promptArg).toContain("Round 1 ");
    expect(promptArg).toContain("Round 5 ");
  });

  // ── Trimming / empty-string output behaviour ──────────────────────────────

  it("trims leading and trailing whitespace from provider output", async () => {
    mockGenerateText.mockResolvedValue("  consistency report  ");
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("consistency report");
  });

  it("strips <thinking> blocks from provider output", async () => {
    mockGenerateText.mockResolvedValue(
      "<thinking>internal monologue</thinking>The rubric was applied consistently.",
    );
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("The rubric was applied consistently.");
    expect(result).not.toContain("internal monologue");
  });

  it("strips <think> blocks from provider output", async () => {
    mockGenerateText.mockResolvedValue(
      "<think>step-by-step</think>No significant drift detected.",
    );
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("No significant drift detected.");
  });

  it("returns empty string when provider returns an empty string", async () => {
    mockGenerateText.mockResolvedValue("");
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
  });

  it("returns empty string when provider returns whitespace-only output", async () => {
    mockGenerateText.mockResolvedValue("   ");
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
  });

  it("returns empty string when provider throws", async () => {
    mockGenerateText.mockRejectedValue(new Error("network error"));
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    const result = await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
    );
    expect(result).toBe("");
  });

  // ── narrativeVerdictText injection ───────────────────────────────────────

  it("injects narrative verdict excerpt (up to 400 chars) into the prompt when provided", async () => {
    const narrative =
      "Alice clearly dominated all three rounds by delivering precise evidence.";
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
      narrative,
    );
    const promptArg = lastPromptArg();
    expect(promptArg).toContain("NARRATIVE VERDICT");
    expect(promptArg).toContain("Alice clearly dominated");
  });

  it("does NOT inject NARRATIVE VERDICT block when narrativeVerdictText is omitted", async () => {
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    await generateRubricHarmonization(makeJudge(), rounds, "Alice", "Bob");
    const promptArg = lastPromptArg();
    expect(promptArg).not.toContain("NARRATIVE VERDICT");
  });

  it("truncates narrative excerpt to 400 characters in the prompt", async () => {
    const longNarrative = "X".repeat(600);
    const rounds = [1, 2, 3].map((n) =>
      makeRound("a", "Alice", "b", "Bob", "a", "a", "a", { roundNumber: n }),
    );
    await generateRubricHarmonization(
      makeJudge(),
      rounds,
      "Alice",
      "Bob",
      longNarrative,
    );
    const promptArg = lastPromptArg();
    const narrativeStart = promptArg.indexOf("NARRATIVE VERDICT");
    const excerpt = promptArg.slice(narrativeStart);
    // The full 600-char string should not appear; only the first 400 chars
    expect(excerpt).not.toContain("X".repeat(600));
    expect(excerpt).toContain("X".repeat(400));
  });
});

// ---------------------------------------------------------------------------
// generateJudgeSystemPrompt — prompt content (Issues 3–9)
// ---------------------------------------------------------------------------

describe("generateJudgeSystemPrompt — prompt content", () => {
  it('contains per-turn independence instruction ("recalibrates to zero")', () => {
    expect(generateJudgeSystemPrompt("")).toContain("recalibrates to zero");
  });

  it("contains grounded precision reward rule", () => {
    expect(generateJudgeSystemPrompt("")).toContain("Grounded precision");
  });

  it("contains phenomenological claim type", () => {
    expect(generateJudgeSystemPrompt("")).toContain("Phenomenological");
  });

  it("contains HIGH calibration anchor with score range", () => {
    expect(generateJudgeSystemPrompt("")).toContain("HIGH (9–10)");
  });

  it("contains MID calibration anchor", () => {
    expect(generateJudgeSystemPrompt("")).toContain("MID (6–7)");
  });

  it("contains LOW calibration anchor", () => {
    expect(generateJudgeSystemPrompt("")).toContain("LOW (4–5)");
  });

  it("contains SERVICE TEST instruction for rhetoric", () => {
    expect(generateJudgeSystemPrompt("")).toContain("SERVICE TEST");
  });

  it("contains EXPRESSION CAP rule", () => {
    expect(generateJudgeSystemPrompt("")).toContain("EXPRESSION CAP");
  });
});

// ---------------------------------------------------------------------------
// generatePairwiseSystemPrompt — new rubric rules (Issues 4–9)
// ---------------------------------------------------------------------------

describe("generatePairwiseSystemPrompt — new rubric rules", () => {
  it("contains grounded precision reward in LOGIC section", () => {
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "Grounded precision",
    );
  });

  it("contains positional consistency drift penalty in TACTICS section", () => {
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "Positional consistency",
    );
  });

  it("restricts thesis-drift Logic penalty to contradiction only", () => {
    // Drift alone should be Tactics-only; Logic applies only on contradiction
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "Drift alone = −1 Tactics only",
    );
  });

  it("contains BOTH turns superlative scan instruction", () => {
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "BOTH turns",
    );
  });

  it("contains phenomenological claim type", () => {
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "Phenomenological",
    );
  });

  it("contains SERVICE TEST instruction for rhetoric", () => {
    expect(generatePairwiseSystemPrompt("Alice", "Bob")).toContain(
      "SERVICE TEST",
    );
  });
});

// ---------------------------------------------------------------------------
// parseJudgeAnalysis — out-of-range raw score clamping (Issue 1)
// ---------------------------------------------------------------------------

describe("parseJudgeAnalysis — out-of-range raw score clamping", () => {
  const config = JUDGE_SPECIALIZATION_CONFIGS["balance"];
  const mockJudge: LiveJudge = {
    id: "j",
    name: "Test Judge",
    modelId: "gpt-oss:120b-cloud",
    specialization: "balance",
    scoringWeights: config.scoringWeights,
    biasProfile: config.typicalBias,
    lastAnalysis: null,
    analysisCount: 0,
  };
  const mockAgent = { id: "a", name: "Agent A" } as any;
  const mockOpponent = { id: "b", name: "Agent B" } as any;

  it("clamps logic to 40 when raw score × multiplier exceeds 40", () => {
    // raw logic_score: 15 → 15×4 = 60, clamped to 40
    const result = parseJudgeAnalysis(
      '{"logic_score":15,"rhetoric_score":5,"tactics_score":5,"analysis":"Out of range."}',
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(40);
  });

  it("clamps rhetoric to 30 when raw score × multiplier exceeds 30", () => {
    // raw rhetoric_score: 15 → 15×3 = 45, clamped to 30
    const result = parseJudgeAnalysis(
      '{"logic_score":5,"rhetoric_score":15,"tactics_score":5,"analysis":"Out of range."}',
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.rhetoricalForce).toBe(30);
  });

  it("clamps tactics to 30 when raw score × multiplier exceeds 30", () => {
    // raw tactics_score: 15 → 15×3 = 45, clamped to 30
    const result = parseJudgeAnalysis(
      '{"logic_score":5,"rhetoric_score":5,"tactics_score":15,"analysis":"Out of range."}',
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.tacticalEffectiveness).toBe(30);
  });

  it("fallback scores are 20/15/15 (neutral neutral-scale values, not 50/50/50)", () => {
    const result = parseJudgeAnalysis(
      null,
      mockJudge,
      mockAgent,
      mockOpponent,
      1,
      "msg",
      "opp",
      "ctx",
    );
    expect(result.scores.logicalCoherence).toBe(20);
    expect(result.scores.rhetoricalForce).toBe(15);
    expect(result.scores.tacticalEffectiveness).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// detectPositionalConvergence (Issue 10)
// ---------------------------------------------------------------------------

describe("detectPositionalConvergence", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  function makeTranscript(count: number): Message[] {
    return Array.from({ length: count }, (_, i) => ({
      agentId: i % 2 === 0 ? "a" : "b",
      agentName: i % 2 === 0 ? "Alice" : "Bob",
      text: `Turn ${i + 1} argument text.`,
    }));
  }

  const testJudge: LiveJudge = (() => {
    const config = JUDGE_SPECIALIZATION_CONFIGS["balance"];
    return {
      id: "j",
      name: "Test Judge",
      modelId: "gpt-oss:120b-cloud",
      specialization: "balance",
      scoringWeights: config.scoringWeights,
      biasProfile: config.typicalBias,
      lastAnalysis: null,
      analysisCount: 0,
    };
  })();

  it("returns detected:false without calling LLM when transcript has fewer than 10 turns", async () => {
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(9),
      "Alice",
      "Bob",
      "Is AI conscious?",
    );
    expect(result.detected).toBe(false);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns detected:false without calling LLM for an empty transcript", async () => {
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(0),
      "Alice",
      "Bob",
      "topic",
    );
    expect(result.detected).toBe(false);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("calls LLM and parses JSON when transcript has exactly 10 turns", async () => {
    mockGenerateText.mockResolvedValue(
      JSON.stringify({
        detected: true,
        convergenceTurnRange: "Turns 7-8",
        coreClaimAgentA_early: "AI is deterministic.",
        coreClaimAgentA_late: "AI operates deterministically.",
        coreClaimAgentB_early: "AI is probabilistic.",
        coreClaimAgentB_late: "AI uses probability but outcomes converge.",
        positionalGapDescription:
          "Both now agree on deterministic foundations.",
        remainingDisagreementType: "definitional",
        motionViability: "degenerate_convergence",
      }),
    );
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(10),
      "Alice",
      "Bob",
      "Is AI conscious?",
    );
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result.detected).toBe(true);
    expect(result.motionViability).toBe("degenerate_convergence");
    expect(result.remainingDisagreementType).toBe("definitional");
    expect(result.convergenceTurnRange).toBe("Turns 7-8");
  });

  it("returns fallback with detected:false on malformed LLM response", async () => {
    mockGenerateText.mockResolvedValue("not valid json at all");
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(10),
      "Alice",
      "Bob",
      "topic",
    );
    expect(result.detected).toBe(false);
    expect(result.motionViability).toBe("inconclusive");
  });

  it("returns fallback with detected:false when LLM throws", async () => {
    mockGenerateText.mockRejectedValue(new Error("network error"));
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(10),
      "Alice",
      "Bob",
      "topic",
    );
    expect(result.detected).toBe(false);
  });

  it('sanitises unknown remainingDisagreementType to "substantive"', async () => {
    mockGenerateText.mockResolvedValue(
      JSON.stringify({
        detected: false,
        convergenceTurnRange: null,
        coreClaimAgentA_early: "",
        coreClaimAgentA_late: "",
        coreClaimAgentB_early: "",
        coreClaimAgentB_late: "",
        positionalGapDescription: "",
        remainingDisagreementType: "unknown_garbage",
        motionViability: "viable",
      }),
    );
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(10),
      "Alice",
      "Bob",
      "topic",
    );
    expect(result.remainingDisagreementType).toBe("substantive");
  });

  it('sanitises unknown motionViability to "inconclusive"', async () => {
    mockGenerateText.mockResolvedValue(
      JSON.stringify({
        detected: false,
        convergenceTurnRange: null,
        coreClaimAgentA_early: "",
        coreClaimAgentA_late: "",
        coreClaimAgentB_early: "",
        coreClaimAgentB_late: "",
        positionalGapDescription: "",
        remainingDisagreementType: "substantive",
        motionViability: "totally_valid",
      }),
    );
    const result = await detectPositionalConvergence(
      testJudge,
      makeTranscript(10),
      "Alice",
      "Bob",
      "topic",
    );
    expect(result.motionViability).toBe("inconclusive");
  });
});

// ---------------------------------------------------------------------------
// parseNarrativeVerdict — last-VERDICT-wins regression (false-positive bug)
// ---------------------------------------------------------------------------

describe("generateNarrativeVerdictText — VERDICT extraction uses last match", () => {
  const config = JUDGE_SPECIALIZATION_CONFIGS["balance"];
  const narrativeJudge: LiveJudge = {
    id: "j",
    name: "Test Judge",
    modelId: "gpt-oss:120b-cloud",
    specialization: "balance",
    scoringWeights: config.scoringWeights,
    biasProfile: config.typicalBias,
    lastAnalysis: null,
    analysisCount: 0,
  };

  function makeMinimalScorecard(
    agentAId: string,
    agentAName: string,
    agentBId: string,
    agentBName: string,
    winner: string,
  ): DebateScorecard {
    return {
      rounds: [
        makeRound(
          agentAId,
          agentAName,
          agentBId,
          agentBName,
          winner,
          winner,
          winner,
        ),
      ],
      winTallies: {
        [agentAId]: {
          agentId: agentAId,
          agentName: agentAName,
          logic: agentAId === winner ? 1 : 0,
          tactics: agentAId === winner ? 1 : 0,
          rhetoric: agentAId === winner ? 1 : 0,
          total: agentAId === winner ? 3 : 0,
        },
        [agentBId]: {
          agentId: agentBId,
          agentName: agentBName,
          logic: agentBId === winner ? 1 : 0,
          tactics: agentBId === winner ? 1 : 0,
          rhetoric: agentBId === winner ? 1 : 0,
          total: agentBId === winner ? 3 : 0,
        },
      },
      overallWinner: winner,
    };
  }

  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  it("picks the terminal VERDICT line when an earlier mid-prose mention names a different agent", async () => {
    // The LLM writes "VERDICT: GLM-4.6 had more round wins" in body prose,
    // then the true terminal line says "VERDICT: GPT-OSS 120B".
    mockGenerateText.mockResolvedValue(
      `GLM-4.6 constructed a coherent opening but faltered in later exchanges.\n` +
        `GPT-OSS 120B pressed the functional-competence gap effectively.\n` +
        `Despite the scorecard suggesting VERDICT: GLM-4.6 had more wins, the arc-level reading favours the other side.\n` +
        `VERDICT: GPT-OSS 120B`,
    );

    const transcript: Message[] = [
      { agentId: "a", agentName: "GLM-4.6", text: "Opening argument." },
      { agentId: "b", agentName: "GPT-OSS 120B", text: "Counter argument." },
    ];
    const scorecard = makeMinimalScorecard(
      "a",
      "GLM-4.6",
      "b",
      "GPT-OSS 120B",
      "a",
    );

    const result = await generateNarrativeVerdictText(
      narrativeJudge,
      transcript,
      "a",
      "GLM-4.6",
      "b",
      "GPT-OSS 120B",
      "topic",
      scorecard,
    );

    expect(result.favouredAgentId).toBe("b"); // terminal VERDICT: GPT-OSS 120B
    // Display text must not contain any raw VERDICT: token
    expect(result.text).not.toMatch(/^VERDICT:/im);
  });

  it("correctly identifies the winner when there is only one VERDICT line at the end", async () => {
    mockGenerateText.mockResolvedValue(
      `Both debaters engaged the core tension.\nGLM-4.6 held position better across the arc.\nVERDICT: GLM-4.6`,
    );
    const transcript: Message[] = [
      { agentId: "a", agentName: "GLM-4.6", text: "Arg." },
      { agentId: "b", agentName: "GPT-OSS 120B", text: "Counter." },
    ];
    const scorecard = makeMinimalScorecard(
      "a",
      "GLM-4.6",
      "b",
      "GPT-OSS 120B",
      "a",
    );

    const result = await generateNarrativeVerdictText(
      narrativeJudge,
      transcript,
      "a",
      "GLM-4.6",
      "b",
      "GPT-OSS 120B",
      "topic",
      scorecard,
    );

    expect(result.favouredAgentId).toBe("a");
    expect(result.text).not.toMatch(/^VERDICT:/im);
  });
});
