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

  // High logical coherence reduces cognitive pressure (confidence)
  if (scores.logicalCoherence > 80) {
    pressure -= 20;
  } else if (scores.logicalCoherence < 40) {
    pressure += 30; // Low logic increases pressure to think more
  }

  // Frame control affects cognitive pressure
  if (analysis.frameControlShift > 10) {
    pressure -= 10; // Good frame control reduces cognitive stress
  } else if (analysis.frameControlShift < -10) {
    pressure += 15; // Losing frame control increases pressure
  }

  // Exposed weaknesses increase cognitive pressure
  pressure += analysis.exposedWeaknesses.length * 5;

  // Tactic effectiveness influences pressure
  if (scores.tacticalEffectiveness > 75) {
    pressure -= 10; // Effective tactics reduce pressure
  } else if (scores.tacticalEffectiveness < 50) {
    pressure += 20; // Ineffective tactics increase pressure
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate emotional pressure based on rhetorical and credibility performance
 */
function calculateEmotionalPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // Rhetorical force affects emotional state
  if (scores.rhetoricalForce > 85) {
    pressure -= 15; // Strong rhetoric reduces emotional pressure
  } else if (scores.rhetoricalForce < 45) {
    pressure += 25; // Weak rhetoric increases emotional pressure
  }

  // Credibility impacts emotional pressure
  if (scores.credibilityScore > 80) {
    pressure -= 15; // High credibility reduces pressure
  } else if (scores.credibilityScore < 40) {
    pressure += 30; // Low credibility increases emotional pressure
  }

  // Momentum affects emotional state
  if (analysis.momentumShift > 15) {
    pressure -= 10; // Positive momentum reduces emotional pressure
  } else if (analysis.momentumShift < -15) {
    pressure += 20; // Negative momentum increases emotional pressure
  }

  // Check for emotional tactics used
  const emotionalTactics = analysis.usedTactics.filter(t => 
    ['emotional_appeal', 'personal_attack', 'ridicule'].includes(t.tactic)
  );
  
  if (emotionalTactics.length > 0) {
    const avgEffectiveness = emotionalTactics.reduce((sum, t) => sum + t.effectiveness, 0) / emotionalTactics.length;
    if (avgEffectiveness > 70) {
      pressure -= 10; // Effective emotional tactics reduce pressure
    } else {
      pressure += 15; // Ineffective emotional tactics increase pressure
    }
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate strategic pressure based on tactical effectiveness and control
 */
function calculateStrategicPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // Tactical effectiveness is primary driver
  if (scores.tacticalEffectiveness > 80) {
    pressure -= 25; // Very effective tactics reduce strategic pressure
  } else if (scores.tacticalEffectiveness < 40) {
    pressure += 35; // Poor tactics increase strategic pressure
  }

  // Frame control affects strategic calculations
  if (analysis.frameControlShift > 12) {
    pressure -= 15; // Gaining frame control reduces strategic pressure
  } else if (analysis.frameControlShift < -12) {
    pressure += 25; // Losing frame control increases strategic pressure
  }

  // Momentum affects strategic options
  if (analysis.momentumShift > 20) {
    pressure -= 10; // Strong momentum opens strategic options
  } else if (analysis.momentumShift < -20) {
    pressure += 20; // Poor momentum limits strategic options
  }

  // Complex tactics affect strategic pressure
  const complexTactics = analysis.usedTactics.filter(t => 
    ['frame_redefinition', 'contradiction', 'strategic_silence'].includes(t.tactic)
  );
  
  if (complexTactics.length > 0) {
    const avgEffectiveness = complexTactics.reduce((sum, t) => sum + t.effectiveness, 0) / complexTactics.length;
    if (avgEffectiveness > 75) {
      pressure -= 10; // Effective complex tactics reduce strategic pressure
    } else {
      pressure += 15; // Failed complex tactics increase strategic pressure
    }
  }

  return Math.max(0, Math.min(100, 50 + pressure));
}

/**
 * Calculate credibility pressure based on evidence and authority
 */
function calculateCredibilityPressure(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let pressure = 0;

  // Credibility score is primary driver
  if (scores.credibilityScore > 85) {
    pressure -= 30; // High credibility significantly reduces pressure
  } else if (scores.credibilityScore < 35) {
    pressure += 40; // Low credibility significantly increases pressure
  }

  // Logical coherence affects perceived credibility
  if (scores.logicalCoherence > 80) {
    pressure -= 10; // Strong logic supports credibility
  } else if (scores.logicalCoherence < 40) {
    pressure += 20; // Weak logic undermines credibility
  }

  // Evidence-based tactics affect credibility pressure
  const evidenceTactics = analysis.usedTactics.filter(t => 
    ['evidence_citation', 'authority_appeal'].includes(t.tactic)
  );
  
  if (evidenceTactics.length > 0) {
    const avgEffectiveness = evidenceTactics.reduce((sum, t) => sum + t.effectiveness, 0) / evidenceTactics.length;
    if (avgEffectiveness > 70) {
      pressure -= 15; // Effective evidence use reduces credibility pressure
    } else {
      pressure += 20; // Failed evidence attempts increase credibility pressure
    }
  }

  // Exposed weaknesses increase credibility pressure
  pressure += analysis.exposedWeaknesses.length * 8;

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

  // Judge specialization influences specific trait adjustments
  switch (analysis.judgeSpecialization) {
    case 'logic':
      if (cognitivePressure > 60) {
        adjustments.analyticalDepth += 1;
        adjustments.evidencePreference += 1;
      }
      break;
    case 'rhetoric':
      if (emotionalPressure > 60) {
        adjustments.emotionalRange += 1;
        adjustments.metaphorUsage += 1;
      }
      break;
    case 'strategy':
      if (strategicPressure > 60) {
        adjustments.riskTolerance += 1;
        adjustments.engagementTactics += 1;
      }
      break;
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
  let decayRate = 0.2; // Base decay rate

  // High effectiveness = slower decay (pressure lasts longer)
  if (scores.overallScore > 80) {
    decayRate -= 0.1;
  } else if (scores.overallScore < 50) {
    decayRate += 0.1;
  }

  // Strong momentum shifts affect decay
  if (Math.abs(analysis.momentumShift) > 20) {
    decayRate -= 0.05;
  }

  // Strong frame control shifts affect decay
  if (Math.abs(analysis.frameControlShift) > 15) {
    decayRate -= 0.05;
  }

  return Math.max(0.1, Math.min(0.5, decayRate));
}

/**
 * Calculate duration based on analysis characteristics
 */
function calculateDuration(analysis: TurnAnalysis): number {
  const scores = analysis.scores;
  let duration = 3; // Base duration in turns

  // High scores increase duration
  if (scores.overallScore > 80) {
    duration += 2;
  } else if (scores.overallScore > 65) {
    duration += 1;
  }

  // Significant momentum shifts extend duration
  if (Math.abs(analysis.momentumShift) > 15) {
    duration += 1;
  }

  // Significant frame control shifts extend duration
  if (Math.abs(analysis.frameControlShift) > 12) {
    duration += 1;
  }

  // Judge specialization affects duration
  if (analysis.judgeSpecialization === 'logic') {
    duration += 1; // Logic judgments tend to last longer
  }

  return Math.max(2, Math.min(6, duration));
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