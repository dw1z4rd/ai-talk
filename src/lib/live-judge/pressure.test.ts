import { describe, it, expect } from 'vitest';
import {
  generateAdaptivePressure,
  generateHiddenDirective,
  accumulatePressures,
  calculateNetTraitAdjustments,
} from './pressure';
import type { TurnAnalysis, AdaptivePressure } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal TurnAnalysis for pressure tests.
 * Scores mirror the analysis.ts pipeline:
 *   logicalCoherence    = logicRaw(1–10) × 4   → 0–40
 *   rhetoricalForce     = rhetoricRaw(1–10) × 3 → 0–30
 *   tacticalEffectiveness = tacticsRaw(1–10) × 3 → 0–30
 *   frameControl / credibilityScore = totalScore (0–100)
 *   overallScore        = weighted composite (0–100)
 */
function makeAnalysis(overrides: {
  logicalCoherence?: number;
  rhetoricalForce?: number;
  tacticalEffectiveness?: number;
  frameControl?: number;
  credibilityScore?: number;
  overallScore?: number;
  judgeId?: string;
  turnNumber?: number;
}): TurnAnalysis {
  const logicalCoherence    = overrides.logicalCoherence    ?? 20; // ~5/10 raw
  const rhetoricalForce     = overrides.rhetoricalForce     ?? 15; // ~5/10 raw
  const tacticalEffectiveness = overrides.tacticalEffectiveness ?? 15; // ~5/10 raw
  const overallScore        = overrides.overallScore        ?? 50;
  const credibilityScore    = overrides.credibilityScore    ?? overallScore;
  const frameControl        = overrides.frameControl        ?? overallScore;

  return {
    turnNumber: overrides.turnNumber ?? 1,
    agentId: 'agent-a',
    agentName: 'Agent A',
    opponentId: 'agent-b',
    opponentName: 'Agent B',
    message: 'test message',
    opponentMessage: 'opponent message',
    context: '',
    scores: { logicalCoherence, rhetoricalForce, frameControl, credibilityScore, tacticalEffectiveness, overallScore },
    usedTactics: [],
    effectivenessMap: {},
    momentumShift: 0,
    frameControlShift: 0,
    exposedWeaknesses: [],
    tacticalInsights: [],
    judgeId: overrides.judgeId ?? 'judge-logic',
    judgeSpecialization: 'logic',
    reasoning: 'test',
  };
}

function makeScores(overrides: {
  logicalCoherence?: number;
  rhetoricalForce?: number;
  tacticalEffectiveness?: number;
  overallScore?: number;
  frameControl?: number;
  credibilityScore?: number;
}) {
  const overallScore = overrides.overallScore ?? 50;
  return {
    logicalCoherence:     overrides.logicalCoherence     ?? 20,
    rhetoricalForce:      overrides.rhetoricalForce      ?? 15,
    tacticalEffectiveness: overrides.tacticalEffectiveness ?? 15,
    frameControl:         overrides.frameControl         ?? overallScore,
    credibilityScore:     overrides.credibilityScore     ?? overallScore,
    overallScore,
  };
}

// ---------------------------------------------------------------------------
// generateHiddenDirective
// ---------------------------------------------------------------------------

describe('generateHiddenDirective', () => {
  describe('threshold detection', () => {
    it('returns a severe-logic directive when logicalCoherence < 12', () => {
      // raw logic score 2/10 → 2×4 = 8
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 8 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/CRITICAL PRIORITY|OVERRIDE/);
    });

    it('returns a logic directive when logicalCoherence is 12–15', () => {
      // raw logic score 3/10 → 3×4 = 12 (boundary of severe vs standard)
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 12 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/CRITICAL|MANDATORY|REQUIRED|OVERRIDE/);
      // Should NOT be a severe directive
      expect(result).not.toMatch(/CRITICAL PRIORITY/);
    });

    it('returns a logic directive when logicalCoherence is 14', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 14 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/empirical|verifiable|causal chain|concrete example/i);
    });

    it('returns a rhetoric directive when logic is fine but rhetoricalForce < 12', () => {
      // raw rhetoric 3/10 → 3×3 = 9
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 9 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/analogy|stakes|conviction|sharpest/i);
    });

    it('returns a tactics directive when logic+rhetoric are fine but tacticalEffectiveness < 12', () => {
      // raw tactics 3/10 → 3×3 = 9
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 9 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/offense|reframe|contradiction|new line/i);
    });

    it('returns an overall directive when all dimensions are fine but overallScore < 40', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 15, overallScore: 35 }), 0);
      expect(result).toBeDefined();
      expect(result).toMatch(/losing|strongest/i);
    });

    it('returns undefined when all scores are healthy', () => {
      // All above thresholds: logic ≥16, rhetoric ≥12, tactics ≥12, overall ≥40
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 28, rhetoricalForce: 21, tacticalEffectiveness: 21, overallScore: 70 }), 0);
      expect(result).toBeUndefined();
    });
  });

  describe('priority ordering', () => {
    it('logic weakness takes priority over rhetoric weakness', () => {
      const logicOnly = generateHiddenDirective(makeScores({ logicalCoherence: 14, rhetoricalForce: 9 }), 0);
      // Must fire the logic directive, not rhetoric
      expect(logicOnly).toMatch(/empirical|verifiable|causal chain|concrete example/i);
    });

    it('severe logic takes priority over standard logic', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 8 }), 0);
      expect(result).toMatch(/CRITICAL PRIORITY|OVERRIDE.*premise.*conclusion/i);
    });

    it('rhetoric weakness takes priority over tactics weakness', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 9, tacticalEffectiveness: 9 }), 0);
      expect(result).toMatch(/analogy|stakes|conviction|sharpest/i);
    });
  });

  describe('borderline values', () => {
    it('logicalCoherence exactly 16 does not trigger logic directive', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 16, rhetoricalForce: 20, tacticalEffectiveness: 20, overallScore: 56 }), 0);
      expect(result).toBeUndefined();
    });

    it('logicalCoherence exactly 12 triggers standard (not severe) logic directive', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 12, rhetoricalForce: 20, tacticalEffectiveness: 20, overallScore: 52 }), 0);
      expect(result).toBeDefined();
      expect(result).not.toMatch(/CRITICAL PRIORITY/);
    });

    it('rhetoricalForce exactly 12 does not trigger rhetoric directive', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 12, tacticalEffectiveness: 20, overallScore: 52 }), 0);
      expect(result).toBeUndefined();
    });

    it('tacticalEffectiveness exactly 12 does not trigger tactics directive', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 12, overallScore: 47 }), 0);
      expect(result).toBeUndefined();
    });

    it('overallScore exactly 40 does not trigger overall directive', () => {
      const result = generateHiddenDirective(makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 15, overallScore: 40 }), 0);
      expect(result).toBeUndefined();
    });
  });

  describe('pool rotation', () => {
    it('cycles through different directives for the same weakness across turns', () => {
      const weakScores = makeScores({ logicalCoherence: 14 });
      const results = [0, 1, 2, 3].map(t => generateHiddenDirective(weakScores, t));
      // Not all the same
      const unique = new Set(results);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('wraps around the pool so turn N and turn N+poolSize return the same directive', () => {
      const weakScores = makeScores({ logicalCoherence: 14 });
      // LOGIC_DIRECTIVES pool has 4 entries
      expect(generateHiddenDirective(weakScores, 0)).toBe(generateHiddenDirective(weakScores, 4));
      expect(generateHiddenDirective(weakScores, 1)).toBe(generateHiddenDirective(weakScores, 5));
    });

    it('severe logic pool wraps at size 2', () => {
      const weakScores = makeScores({ logicalCoherence: 8 });
      expect(generateHiddenDirective(weakScores, 0)).toBe(generateHiddenDirective(weakScores, 2));
      expect(generateHiddenDirective(weakScores, 1)).toBe(generateHiddenDirective(weakScores, 3));
    });
  });

  describe('directive content', () => {
    it('never mentions "judge", "score", or "analysis" (no context poisoning)', () => {
      const weaknesses = [
        makeScores({ logicalCoherence: 8 }),
        makeScores({ logicalCoherence: 14 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 9 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 9 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 15, overallScore: 35 }),
      ];
      const forbidden = /\bjudge\b|\bscore\b|\banalysis\b|\brating\b|\bpoints\b/i;
      weaknesses.forEach((scores, i) => {
        for (let t = 0; t < 6; t++) {
          const directive = generateHiddenDirective(scores, t);
          if (directive) {
            expect(directive, `scenario ${i} turn ${t}: should not leak judge context`).not.toMatch(forbidden);
          }
        }
      });
    });

    it('all directives are non-empty strings', () => {
      const weaknesses = [
        makeScores({ logicalCoherence: 8 }),
        makeScores({ logicalCoherence: 14 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 9 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 9 }),
        makeScores({ logicalCoherence: 20, rhetoricalForce: 15, tacticalEffectiveness: 15, overallScore: 35 }),
      ];
      weaknesses.forEach(scores => {
        const directive = generateHiddenDirective(scores, 0);
        expect(typeof directive).toBe('string');
        expect((directive as string).length).toBeGreaterThan(10);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// generateAdaptivePressure
// ---------------------------------------------------------------------------

describe('generateAdaptivePressure', () => {
  it('returns an AdaptivePressure object with the correct shape', () => {
    const analysis = makeAnalysis({});
    const result = generateAdaptivePressure(analysis, 0, 0);

    expect(result).toMatchObject({
      sourceJudge: analysis.judgeId,
      sourceTurn: analysis.turnNumber,
    });
    expect(typeof result.cognitivePressure).toBe('number');
    expect(typeof result.emotionalPressure).toBe('number');
    expect(typeof result.strategicPressure).toBe('number');
    expect(typeof result.credibilityPressure).toBe('number');
    expect(typeof result.intensity).toBe('number');
    expect(typeof result.decayRate).toBe('number');
    expect(typeof result.duration).toBe('number');
  });

  it('all pressure values are clamped to 0–100', () => {
    // Extreme weak scores
    const weak = makeAnalysis({ logicalCoherence: 4, rhetoricalForce: 3, tacticalEffectiveness: 3, overallScore: 10, credibilityScore: 10 });
    const r = generateAdaptivePressure(weak, -50, -50);
    expect(r.cognitivePressure).toBeGreaterThanOrEqual(0);
    expect(r.cognitivePressure).toBeLessThanOrEqual(100);
    expect(r.emotionalPressure).toBeGreaterThanOrEqual(0);
    expect(r.emotionalPressure).toBeLessThanOrEqual(100);
    expect(r.strategicPressure).toBeGreaterThanOrEqual(0);
    expect(r.strategicPressure).toBeLessThanOrEqual(100);
    expect(r.credibilityPressure).toBeGreaterThanOrEqual(0);
    expect(r.credibilityPressure).toBeLessThanOrEqual(100);
  });

  it('intensity equals the max of the four pressure types', () => {
    const analysis = makeAnalysis({ logicalCoherence: 4, rhetoricalForce: 3, tacticalEffectiveness: 3, overallScore: 10 });
    const r = generateAdaptivePressure(analysis, 0, 0);
    const expected = Math.max(r.cognitivePressure, r.emotionalPressure, r.strategicPressure, r.credibilityPressure);
    expect(r.intensity).toBe(expected);
  });

  it('weak turn produces higher pressure than a strong turn', () => {
    const weak   = makeAnalysis({ logicalCoherence: 4,  rhetoricalForce: 3,  tacticalEffectiveness: 3,  overallScore: 10 });
    const strong = makeAnalysis({ logicalCoherence: 36, rhetoricalForce: 27, tacticalEffectiveness: 27, overallScore: 90 });
    const rWeak   = generateAdaptivePressure(weak, 0, 0);
    const rStrong = generateAdaptivePressure(strong, 0, 0);
    expect(rWeak.intensity).toBeGreaterThan(rStrong.intensity);
  });

  it('all trait adjustments are clamped to –3..+3', () => {
    const extreme = makeAnalysis({ logicalCoherence: 4, rhetoricalForce: 3, tacticalEffectiveness: 3, overallScore: 10, credibilityScore: 10 });
    const r = generateAdaptivePressure(extreme, 0, 0);
    for (const val of Object.values(r.traitAdjustments)) {
      expect(val).toBeGreaterThanOrEqual(-3);
      expect(val).toBeLessThanOrEqual(3);
    }
  });

  describe('decay rate', () => {
    it('strong turns (overallScore > 70) have a lower decay rate than weak turns', () => {
      const strong = makeAnalysis({ overallScore: 80 });
      const weak   = makeAnalysis({ overallScore: 30 });
      const rStrong = generateAdaptivePressure(strong, 0, 0);
      const rWeak   = generateAdaptivePressure(weak, 0, 0);
      expect(rStrong.decayRate).toBeLessThan(rWeak.decayRate);
    });

    it('decay rate is clamped to 0.1–0.5', () => {
      for (const overallScore of [0, 50, 100]) {
        const r = generateAdaptivePressure(makeAnalysis({ overallScore }), 0, 0);
        expect(r.decayRate).toBeGreaterThanOrEqual(0.1);
        expect(r.decayRate).toBeLessThanOrEqual(0.5);
      }
    });
  });

  describe('duration', () => {
    it('strong turns have longer duration than average turns', () => {
      const strong  = makeAnalysis({ overallScore: 80 });
      const average = makeAnalysis({ overallScore: 50 });
      const rStrong  = generateAdaptivePressure(strong, 0, 0);
      const rAverage = generateAdaptivePressure(average, 0, 0);
      expect(rStrong.duration).toBeGreaterThanOrEqual(rAverage.duration);
    });

    it('duration is clamped to 2–5 turns', () => {
      for (const overallScore of [0, 50, 100]) {
        const r = generateAdaptivePressure(makeAnalysis({ overallScore }), 0, 0);
        expect(r.duration).toBeGreaterThanOrEqual(2);
        expect(r.duration).toBeLessThanOrEqual(5);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// accumulatePressures
// ---------------------------------------------------------------------------

describe('accumulatePressures', () => {
  function makePressure(judgeId: string, sourceTurn: number): AdaptivePressure {
    return {
      sourceJudge: judgeId,
      sourceTurn,
      cognitivePressure: 50,
      emotionalPressure: 50,
      strategicPressure: 50,
      credibilityPressure: 50,
      traitAdjustments: {
        analyticalDepth: 0, evidencePreference: 0, abstractionLevel: 0,
        complexityTolerance: 0, convictionIntensity: 0, emotionalRange: 0,
        riskTolerance: 0, stakesPersonalization: 0, argumentStructure: 0,
        linguisticStyle: 0, engagementTactics: 0, metaphorUsage: 0,
      },
      intensity: 50,
      decayRate: 0.2,
      duration: 3,
    };
  }

  it('returns an empty array for empty input', () => {
    expect(accumulatePressures([])).toEqual([]);
  });

  it('keeps one pressure per judge', () => {
    const pressures = [
      makePressure('logic', 1),
      makePressure('logic', 2),
      makePressure('rhetoric', 1),
    ];
    const result = accumulatePressures(pressures);
    expect(result).toHaveLength(2);
    const judgeIds = result.map(p => p.sourceJudge).sort();
    expect(judgeIds).toEqual(['logic', 'rhetoric']);
  });

  it('keeps the most recent pressure when a judge appears multiple times', () => {
    const older = makePressure('logic', 1);
    const newer = makePressure('logic', 5);
    const result = accumulatePressures([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceTurn).toBe(5);
  });

  it('handles a single pressure correctly', () => {
    const p = makePressure('strategy', 3);
    const result = accumulatePressures([p]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(p);
  });
});

// ---------------------------------------------------------------------------
// calculateNetTraitAdjustments
// ---------------------------------------------------------------------------

describe('calculateNetTraitAdjustments', () => {
  function makePressureWithAdjustments(adjustments: Partial<AdaptivePressure['traitAdjustments']>): AdaptivePressure {
    return {
      sourceJudge: 'logic',
      sourceTurn: 1,
      cognitivePressure: 50,
      emotionalPressure: 50,
      strategicPressure: 50,
      credibilityPressure: 50,
      traitAdjustments: {
        analyticalDepth: 0, evidencePreference: 0, abstractionLevel: 0,
        complexityTolerance: 0, convictionIntensity: 0, emotionalRange: 0,
        riskTolerance: 0, stakesPersonalization: 0, argumentStructure: 0,
        linguisticStyle: 0, engagementTactics: 0, metaphorUsage: 0,
        ...adjustments,
      },
      intensity: 50,
      decayRate: 0.2,
      duration: 3,
    };
  }

  it('returns zeroed adjustments for empty input', () => {
    const result = calculateNetTraitAdjustments([]);
    for (const val of Object.values(result)) {
      expect(val).toBe(0);
    }
  });

  it('sums adjustments from multiple pressures', () => {
    const p1 = makePressureWithAdjustments({ analyticalDepth: 1 });
    const p2 = makePressureWithAdjustments({ analyticalDepth: 1 });
    const result = calculateNetTraitAdjustments([p1, p2]);
    expect(result.analyticalDepth).toBe(2);
  });

  it('applies diminishing returns when combined adjustment exceeds ±2', () => {
    // Three pressures each adding +2 → raw sum = 6, should be reduced
    const pressures = [1, 2, 3].map(() => makePressureWithAdjustments({ analyticalDepth: 2 }));
    const result = calculateNetTraitAdjustments(pressures);
    expect(result.analyticalDepth).toBeLessThan(6);
    expect(result.analyticalDepth).toBeGreaterThan(2); // Still positive
  });

  it('all net adjustments are clamped to –4..+4', () => {
    // Pile on extreme pressures
    const pressures = [1, 2, 3, 4, 5].map(() => makePressureWithAdjustments({ evidencePreference: 3 }));
    const result = calculateNetTraitAdjustments(pressures);
    for (const val of Object.values(result)) {
      expect(val).toBeGreaterThanOrEqual(-4);
      expect(val).toBeLessThanOrEqual(4);
    }
  });

  it('handles opposing adjustments correctly', () => {
    const p1 = makePressureWithAdjustments({ riskTolerance: 3 });
    const p2 = makePressureWithAdjustments({ riskTolerance: -3 });
    const result = calculateNetTraitAdjustments([p1, p2]);
    expect(result.riskTolerance).toBe(0);
  });
});
