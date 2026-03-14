import { type TurnAnalysis, type AdaptivePressure, type JudgeScores } from './types';

/**
 * Generate adaptive pressure based on judge analysis and debate dynamics
 */
export function generateAdaptivePressure(
  analysis: TurnAnalysis,
  momentumShift: number,
  frameControlShift: number
): AdaptivePressure {
  
  // Calculate pressure types based on analysis
  const cognitivePressure = calculateCognitivePressure(analysis);
  const emotionalPressure = calculateEmotionalPressure(analysis);
  const strategicPressure = calculateStrategicPressure(analysis);
  const credibilityPressure = calculateCredibilityPressure(analysis);

  // Calculate trait adjustments based on pressure types
  const traitAdjustments = calculateTraitAdjustments(
    cognitivePressure,
    emotionalPressure,
    strategicPressure,
    credibilityPressure,
    analysis
  );

  // Calculate overall intensity and decay
  const intensity = Math.max(cognitivePressure, emotionalPressure, strategicPressure, credibilityPressure);
  const decayRate = calculateDecayRate(analysis);
  const duration = calculateDuration(analysis);

  return {
    sourceJudge: analysis.judgeId,
    sourceTurn: analysis.turnNumber,
    cognitivePressure,
    emotionalPressure,
    strategicPressure,
    credibilityPressure,
    traitAdjustments,
    intensity,
    decayRate,
    duration
  };
}

/**
 * Calculate cognitive pressure based on logical performance
 */
function calculateCognitivePressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // logicalCoherence is 0-40 raw; high = >28 (70%), low = <16 (40%)
  if (scores.logicalCoherence > 28) {
    pressure -= 20;
  } else if (scores.logicalCoherence < 16) {
    pressure += 30;
  }

  // tacticalEffectiveness is 0-30 raw; high = >21 (70%), low = <12 (40%)
  if (scores.tacticalEffectiveness > 21) {
    pressure -= 10;
  } else if (scores.tacticalEffectiveness < 12) {
    pressure += 20;
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate emotional pressure based on rhetorical and credibility performance
 */
function calculateEmotionalPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // rhetoricalForce is 0-30 raw; high = >21 (70%), low = <12 (40%)
  if (scores.rhetoricalForce > 21) {
    pressure -= 15;
  } else if (scores.rhetoricalForce < 12) {
    pressure += 25;
  }

  // credibilityScore is proxied to totalScore (0-100); thresholds unchanged
  if (scores.credibilityScore > 70) {
    pressure -= 15;
  } else if (scores.credibilityScore < 40) {
    pressure += 30;
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate strategic pressure based on tactical effectiveness and control
 */
function calculateStrategicPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // tacticalEffectiveness is 0-30 raw; high = >21 (70%), low = <12 (40%)
  if (scores.tacticalEffectiveness > 21) {
    pressure -= 25;
  } else if (scores.tacticalEffectiveness < 12) {
    pressure += 35;
  }

  // overallScore (0-100) as a general proxy for strategic position
  if (scores.overallScore > 70) {
    pressure -= 10;
  } else if (scores.overallScore < 40) {
    pressure += 20;
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate credibility pressure based on evidence and authority
 */
function calculateCredibilityPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // credibilityScore is proxied to totalScore (0-100)
  if (scores.credibilityScore > 75) {
    pressure -= 30;
  } else if (scores.credibilityScore < 40) {
    pressure += 40;
  }

  // logicalCoherence is 0-40 raw; strong logic supports credibility
  if (scores.logicalCoherence > 28) {
    pressure -= 10;
  } else if (scores.logicalCoherence < 16) {
    pressure += 20;
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate trait adjustments based on pressure types
 */
function calculateTraitAdjustments(
  cognitivePressure: number,
  emotionalPressure: number,
  strategicPressure: number,
  credibilityPressure: number,
  analysis: TurnAnalysis
): AdaptivePressure['traitAdjustments'] {
  
  const adjustments = {
    analyticalDepth: 0,
    evidencePreference: 0,
    abstractionLevel: 0,
    complexityTolerance: 0,
    convictionIntensity: 0,
    emotionalRange: 0,
    riskTolerance: 0,
    stakesPersonalization: 0,
    argumentStructure: 0,
    linguisticStyle: 0,
    engagementTactics: 0,
    metaphorUsage: 0
  };

  // Cognitive pressure affects analytical traits
  if (cognitivePressure > 70) {
    adjustments.analyticalDepth += 2;
    adjustments.complexityTolerance += 1;
    adjustments.evidencePreference += 1;
  } else if (cognitivePressure < 30) {
    adjustments.analyticalDepth -= 1;
    adjustments.complexityTolerance -= 1;
    adjustments.abstractionLevel += 1; // Simplify under low pressure
  }

  // Emotional pressure affects emotional expression
  if (emotionalPressure > 70) {
    adjustments.emotionalRange += 2;
    adjustments.convictionIntensity += 1;
    adjustments.stakesPersonalization += 1;
    adjustments.metaphorUsage += 1;
  } else if (emotionalPressure < 30) {
    adjustments.emotionalRange -= 2;
    adjustments.convictionIntensity -= 1;
    adjustments.stakesPersonalization -= 1;
  }

  // Strategic pressure affects risk-taking and engagement
  if (strategicPressure > 70) {
    adjustments.riskTolerance += 2;
    adjustments.engagementTactics += 1;
    adjustments.argumentStructure += 1; // More structured under pressure
  } else if (strategicPressure < 30) {
    adjustments.riskTolerance -= 2;
    adjustments.engagementTactics -= 1;
    adjustments.argumentStructure -= 1;
  }

  // Credibility pressure affects evidence and personalization
  if (credibilityPressure > 70) {
    adjustments.evidencePreference += 2;
    adjustments.stakesPersonalization -= 1; // Focus on facts over personal
    adjustments.linguisticStyle -= 1; // More formal language
  } else if (credibilityPressure < 30) {
    adjustments.evidencePreference -= 1;
    adjustments.stakesPersonalization += 2; // More personal appeals
    adjustments.linguisticStyle += 1; // More expressive language
  }

  // Clamp all adjustments to reasonable bounds
  Object.keys(adjustments).forEach(key => {
    adjustments[key as keyof typeof adjustments] = Math.max(-3, Math.min(3, adjustments[key as keyof typeof adjustments]));
  });

  return adjustments;
}

/**
 * Calculate decay rate based on analysis intensity
 */
function calculateDecayRate(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let decayRate = 0.2;

  if (scores.overallScore > 70) {
    decayRate -= 0.1; // Strong turn — pressure lingers longer
  } else if (scores.overallScore < 45) {
    decayRate += 0.1; // Weak turn — pressure fades quickly
  }

  return Math.max(0.1, Math.min(0.5, decayRate));
}

/**
 * Calculate duration based on analysis characteristics
 */
function calculateDuration(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let duration = 3;

  if (scores.overallScore > 75) {
    duration += 2;
  } else if (scores.overallScore > 60) {
    duration += 1;
  }

  return Math.max(2, Math.min(5, duration));
}

/**
 * Apply multiple adaptive pressures to an agent (accumulation)
 */
export function accumulatePressures(pressures: AdaptivePressure[]): AdaptivePressure[] {
  // Group pressures by source judge
  const pressuresByJudge = new Map<string, AdaptivePressure[]>();
  
  pressures.forEach(pressure => {
    if (!pressuresByJudge.has(pressure.sourceJudge)) {
      pressuresByJudge.set(pressure.sourceJudge, []);
    }
    pressuresByJudge.get(pressure.sourceJudge)!.push(pressure);
  });

  // For each judge, keep only the most recent pressure
  const accumulatedPressures: AdaptivePressure[] = [];
  
  pressuresByJudge.forEach(judgePressures => {
    const mostRecent = judgePressures.reduce((most, current) => 
      current.sourceTurn > most.sourceTurn ? current : most
    );
    accumulatedPressures.push(mostRecent);
  });

  return accumulatedPressures;
}

/**
 * Calculate net trait adjustments from multiple pressures
 */
export function calculateNetTraitAdjustments(pressures: AdaptivePressure[]): AdaptivePressure['traitAdjustments'] {
  const netAdjustments = {
    analyticalDepth: 0,
    evidencePreference: 0,
    abstractionLevel: 0,
    complexityTolerance: 0,
    convictionIntensity: 0,
    emotionalRange: 0,
    riskTolerance: 0,
    stakesPersonalization: 0,
    argumentStructure: 0,
    linguisticStyle: 0,
    engagementTactics: 0,
    metaphorUsage: 0
  };

  pressures.forEach(pressure => {
    Object.keys(pressure.traitAdjustments).forEach(trait => {
      netAdjustments[trait as keyof typeof netAdjustments] += 
        pressure.traitAdjustments[trait as keyof typeof pressure.traitAdjustments];
    });
  });

  // Apply diminishing returns for strong adjustments
  Object.keys(netAdjustments).forEach(key => {
    const adjustment = netAdjustments[key as keyof typeof netAdjustments];
    if (Math.abs(adjustment) > 2) {
      netAdjustments[key as keyof typeof netAdjustments] = Math.sign(adjustment) * (2 + Math.abs(adjustment - 2) * 0.5);
    }
  });

  // Clamp to reasonable bounds
  Object.keys(netAdjustments).forEach(key => {
    netAdjustments[key as keyof typeof netAdjustments] = Math.max(-4, Math.min(4, netAdjustments[key as keyof typeof netAdjustments]));
  });

  return netAdjustments;
}