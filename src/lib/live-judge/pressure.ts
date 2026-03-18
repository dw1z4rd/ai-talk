import {
  type TurnAnalysis,
  type AdaptivePressure,
  type JudgeScores,
} from "./types";

/**
 * Generate adaptive pressure based on judge analysis and debate dynamics
 */
export function generateAdaptivePressure(
  analysis: TurnAnalysis,
  momentumShift: number,
  frameControlShift: number,
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
    analysis,
  );

  // Calculate overall intensity and decay
  const intensity = Math.max(
    cognitivePressure,
    emotionalPressure,
    strategicPressure,
    credibilityPressure,
  );
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
    duration,
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
  analysis: TurnAnalysis,
): AdaptivePressure["traitAdjustments"] {
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
    metaphorUsage: 0,
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
  Object.keys(adjustments).forEach((key) => {
    adjustments[key as keyof typeof adjustments] = Math.max(
      -3,
      Math.min(3, adjustments[key as keyof typeof adjustments]),
    );
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

// Directive pools by weakness category
const LOGIC_DIRECTIVES = [
  "CRITICAL: Your previous arguments lacked empirical grounding. You MUST cite a concrete historical or scientific example in this turn.",
  "MANDATORY: Build your argument around a specific, verifiable fact or documented case — no abstract assertions allowed.",
  "REQUIRED: Present a tightly reasoned causal chain this turn. Show exactly how A leads to B leads to C with no logical leaps.",
  "OVERRIDE: Ground every claim you make this turn in a concrete example or proof. No bare assertions.",
];

const LOGIC_SEVERE_DIRECTIVES = [
  "CRITICAL PRIORITY: Do not make a single claim you cannot immediately support with a specific example or documented evidence. One tight argument beats three vague ones.",
  "OVERRIDE: Your argument structure this turn must move from a concrete premise to an airtight conclusion. Eliminate all speculative language.",
];

const RHETORIC_DIRECTIVES = [
  "MANDATORY: Open with a vivid, concrete image or analogy before making your point — your delivery needs to land harder.",
  "REQUIRED: Connect the stakes of this debate to something real and human. Make the audience feel what is actually at risk.",
  "CRITICAL: State your position with unambiguous conviction this turn. Cut every hedge, every qualification, every 'perhaps'.",
  "MANDATORY: Your last turn was too flat. This turn, find the one sharpest thing you could say and lead with it.",
];

const TACTICS_DIRECTIVES = [
  "REQUIRED: Stop defending your position and go on offense. Identify a specific weakness in your opponent's last argument and attack it directly.",
  "CRITICAL: Change your approach entirely this turn. Use a reframe, a pointed question, or a concession that pivots to a stronger attack.",
  "MANDATORY: Your opponent left a contradiction in their last argument. Expose it before making your own point.",
  "REQUIRED: Do not reiterate any claim you have already made. Introduce a completely new line of attack.",
];

const OVERALL_DIRECTIVES = [
  "PRIORITY OVERRIDE: You are losing this exchange. Do not repeat anything you have said before — pivot to a completely new angle of attack.",
  "CRITICAL: Your last turn failed to move the debate in your favor. This turn, open with your strongest possible point and build from there.",
];

const COUNTERFACTUAL_DIRECTIVES = [
  "MANDATORY: Construct a concrete counterfactual this turn — identify a specific factor central to the debate and trace what changes if it is removed. Walk through the full mechanism: 'In a world without [X], [how the causal chain differs] → [the measurable consequence that follows].'",
  "REQUIRED: Build a 'no-X world' argument this turn. Name the factor, remove it, and explain the mechanism step by step: cause → process → measurable consequence. Bare assertions about what 'would have happened' without a causal chain earn no credit.",
  "CRITICAL: Your argument needs a counterfactual to make the causal stakes concrete. Choose a specific premise your opponent relies on, ask what the world looks like without it, and follow the chain all the way to a measurable consequence.",
  "OVERRIDE: This turn, lead with a counterfactual thought experiment — explicitly name what you are removing, state the mechanism by which the absence changes outcomes, and name the measurable consequence. This is the single most effective way to test whether your position holds up to scrutiny.",
];

const MECHANISM_DIRECTIVES = [
  "CRITICAL: Your last argument was missing a mechanism step. This turn, for every causal claim, write one sentence that names EXACTLY how the cause produces the effect AND what measurable consequence follows. The pattern is: '[cause] → [how it operates in context] → [measurable consequence].'",
  "MANDATORY: Complete your causal chains this turn. Stating that 'X leads to Y' is insufficient — you must also explain the process by which X produces Y and the observable consequence. Drop any claim you cannot chain all three steps for.",
  "REQUIRED: Mechanism gap detected in your last turn. Before making any new claims, close the gap: name the missing element (cause, process, or measurable consequence) from your previous argument and supply it now, then build forward.",
  "OVERRIDE: Your arguments are being penalized for hollow causal leaps. This turn: no claim without all three elements — what causes it, through what mechanism it occurs, and what you would measure as evidence. One tight mechanistic argument beats three incomplete ones.",
];

const CONVERGENCE_DIRECTIVES = [
  "DEBATE CONVERGENCE ALERT: The judge has detected that both debaters have converged toward similar positions, collapsing the motion into a definitional dispute. This turn, you must either (a) return explicitly to your original position on the core motion and defend it directly, or (b) acknowledge the convergence and concede the definitional ground while staking a substantive claim the motion still requires. Do not continue arguing tangential sub-questions.",
  "POSITIONAL CONVERGENCE DETECTED: Both debaters are now arguing the same side of the core motion. The motion cannot be resolved if neither side defends it. This turn is your final opportunity to either re-anchor your position to the original motion or formally concede. The judges will score a failure to do either as a forfeit of the affected rounds.",
  "JUDGE ALERT — MOTION COLLAPSE: The debate has drifted into a definitional dispute that does not resolve the original motion. Your next turn must directly address the core question — not reframe it, not concede sub-claims, but answer it. Name your position on the motion explicitly in your first sentence.",
];

function pickDirective(pool: string[], turnNumber: number): string {
  return pool[turnNumber % pool.length];
}

/**
 * Generate a hidden behavioral directive based on aggregated judge scores.
 * Returns a one-turn imperative injected silently into the debater's system prompt.
 * Thresholds mirror pressure.ts calibration: logicalCoherence 0-40, rhetoricalForce 0-30,
 * tacticalEffectiveness 0-30, overallScore 0-100.
 *
 * @param opts.noCounterfactualYet        - Agent has not submitted a counterfactual and turn >= 4
 * @param opts.mechanismFailureLastRound  - Agent was in mechanismFailures array last round
 * @param opts.convergenceDetected        - Mid-debate convergence heuristic fired
 */
export function generateHiddenDirective(
  scores: JudgeScores,
  turnNumber: number,
  opts?: {
    noCounterfactualYet?: boolean;
    mechanismFailureLastRound?: boolean;
    convergenceDetected?: boolean;
  },
): string | undefined {
  // Severe logic weakness — highest priority
  // Convergence detected — highest priority, overrides all other directives
  if (opts?.convergenceDetected) {
    return pickDirective(CONVERGENCE_DIRECTIVES, turnNumber);
  }
  // Severe logic weakness — highest remaining priority
  if (scores.logicalCoherence < 12) {
    return pickDirective(LOGIC_SEVERE_DIRECTIVES, turnNumber);
  }
  // Logic weakness
  if (scores.logicalCoherence < 16) {
    return pickDirective(LOGIC_DIRECTIVES, turnNumber);
  }
  // Mechanism failure (co-fires with counterfactual only when logic is healthy but mechanism is broken)
  if (opts?.mechanismFailureLastRound && scores.logicalCoherence < 20) {
    return pickDirective(MECHANISM_DIRECTIVES, turnNumber);
  }
  // Rhetoric weakness
  if (scores.rhetoricalForce < 12) {
    return pickDirective(RHETORIC_DIRECTIVES, turnNumber);
  }
  // No counterfactual submitted yet — nudge from Turn 4 onward
  if (opts?.noCounterfactualYet && turnNumber >= 4) {
    return pickDirective(COUNTERFACTUAL_DIRECTIVES, turnNumber);
  }
  // Tactics weakness
  if (scores.tacticalEffectiveness < 12) {
    return pickDirective(TACTICS_DIRECTIVES, turnNumber);
  }
  // General weak turn
  if (scores.overallScore < 40) {
    return pickDirective(OVERALL_DIRECTIVES, turnNumber);
  }
  return undefined;
}

/**
 * Apply multiple adaptive pressures to an agent (accumulation)
 */
export function accumulatePressures(
  pressures: AdaptivePressure[],
): AdaptivePressure[] {
  // Group pressures by source judge
  const pressuresByJudge = new Map<string, AdaptivePressure[]>();

  pressures.forEach((pressure) => {
    if (!pressuresByJudge.has(pressure.sourceJudge)) {
      pressuresByJudge.set(pressure.sourceJudge, []);
    }
    pressuresByJudge.get(pressure.sourceJudge)!.push(pressure);
  });

  // For each judge, keep only the most recent pressure
  const accumulatedPressures: AdaptivePressure[] = [];

  pressuresByJudge.forEach((judgePressures) => {
    const mostRecent = judgePressures.reduce((most, current) =>
      current.sourceTurn > most.sourceTurn ? current : most,
    );
    accumulatedPressures.push(mostRecent);
  });

  return accumulatedPressures;
}

/**
 * Calculate net trait adjustments from multiple pressures
 */
export function calculateNetTraitAdjustments(
  pressures: AdaptivePressure[],
): AdaptivePressure["traitAdjustments"] {
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
    metaphorUsage: 0,
  };

  pressures.forEach((pressure) => {
    Object.keys(pressure.traitAdjustments).forEach((trait) => {
      netAdjustments[trait as keyof typeof netAdjustments] +=
        pressure.traitAdjustments[
          trait as keyof typeof pressure.traitAdjustments
        ];
    });
  });

  // Apply diminishing returns for strong adjustments
  Object.keys(netAdjustments).forEach((key) => {
    const adjustment = netAdjustments[key as keyof typeof netAdjustments];
    if (Math.abs(adjustment) > 2) {
      netAdjustments[key as keyof typeof netAdjustments] =
        Math.sign(adjustment) * (2 + Math.abs(adjustment - 2) * 0.5);
    }
  });

  // Clamp to reasonable bounds
  Object.keys(netAdjustments).forEach((key) => {
    netAdjustments[key as keyof typeof netAdjustments] = Math.max(
      -4,
      Math.min(4, netAdjustments[key as keyof typeof netAdjustments]),
    );
  });

  return netAdjustments;
}
