import { 
  type PersonalityParameters,
  type ContinuousPersonality,
  type PersonalityEvolution,
  type AdaptiveAgentState,
  type MetaGoal,
  type GoalEvolution,
  type TacticMemory,
  type TacticUsage,
  type AdaptationMetrics,
  type PersonalitySynthesis,
  type TraitInteractionMatrix
} from './types';
import type { AdaptivePressure } from '$lib/live-judge/types';
import { PERSONALITY_ARCHETYPES } from '$lib/agents';

/**
 * Create a continuous personality from a base archetype
 */
export function createContinuousPersonality(
  id: string,
  archetypeKey: string,
  traitElasticity: number = 1.0
): ContinuousPersonality {
  const baseTraits = PERSONALITY_ARCHETYPES[archetypeKey] || PERSONALITY_ARCHETYPES['engineer'];
  
  return {
    id,
    baseTraits: { ...baseTraits },
    currentTraits: { ...baseTraits },
    pressureModifiers: createEmptyPersonality(),
    traitElasticity,
    activePressures: [],
    lastUpdated: 0,
    evolutionHistory: []
  };
}

/**
 * Create empty personality parameters for initialization
 */
function createEmptyPersonality(): PersonalityParameters {
  return {
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
}

/**
 * Apply adaptive pressure to personality traits
 */
export function applyAdaptivePressure(
  personality: ContinuousPersonality,
  pressures: AdaptivePressure[],
  turnNumber: number
): PersonalityEvolution[] {
  const evolutions: PersonalityEvolution[] = [];
  
  // Reset pressure modifiers (they decay each turn)
  personality.pressureModifiers = createEmptyPersonality();
  
  // Apply each pressure
  pressures.forEach(pressure => {
    const evolution = applySinglePressure(personality, pressure, turnNumber);
    if (evolution) {
      evolutions.push(evolution);
    }
  });
  
  // Apply trait interactions
  applyTraitInteractions(personality);
  
  // Update current traits with pressure modifiers
  updateCurrentTraits(personality);
  
  // Update active pressures and last updated
  personality.activePressures = pressures.map(p => `${p.sourceJudge}-${p.sourceTurn}`);
  personality.lastUpdated = turnNumber;
  
  // Store evolution history
  personality.evolutionHistory.push(...evolutions);
  
  return evolutions;
}

/**
 * Apply a single adaptive pressure to personality
 */
function applySinglePressure(
  personality: ContinuousPersonality,
  pressure: AdaptivePressure,
  turnNumber: number
): PersonalityEvolution | null {
  
  const traitChanges: Partial<PersonalityParameters> = {};
  let hasChanges = false;
  
  // Apply trait adjustments based on elasticity
  Object.entries(pressure.traitAdjustments).forEach(([trait, adjustment]) => {
    const traitKey = trait as keyof PersonalityParameters;
    const elasticAdjustment = adjustment * personality.traitElasticity;
    
    if (Math.abs(elasticAdjustment) > 0.1) {
      traitChanges[traitKey] = elasticAdjustment;
      personality.pressureModifiers[traitKey] += elasticAdjustment;
      hasChanges = true;
    }
  });
  
  if (!hasChanges) return null;
  
  return {
    turnNumber,
    sourceJudge: pressure.sourceJudge,
    sourcePressure: `${pressure.sourceJudge}-${pressure.sourceTurn}`,
    traitChanges,
    reasoning: `Applied pressure intensity: ${pressure.intensity.toFixed(1)}`,
    intensity: pressure.intensity
  };
}

/**
 * Apply trait interactions (how traits influence each other)
 */
function applyTraitInteractions(personality: ContinuousPersonality): void {
  const interactions: TraitInteractionMatrix = {
    analyticalDepth_evidencePreference: 0.3,
    riskTolerance_emotionalRange: 0.2,
    convictionIntensity_stakesPersonalization: 0.4,
    engagementTactics_riskTolerance: 0.3,
    abstractionLevel_complexityTolerance: 0.5
  };
  
  // Apply interaction effects
  personality.pressureModifiers.evidencePreference += 
    personality.pressureModifiers.analyticalDepth * interactions.analyticalDepth_evidencePreference;
  
  personality.pressureModifiers.emotionalRange += 
    personality.pressureModifiers.riskTolerance * interactions.riskTolerance_emotionalRange;
  
  personality.pressureModifiers.stakesPersonalization += 
    personality.pressureModifiers.convictionIntensity * interactions.convictionIntensity_stakesPersonalization;
  
  personality.pressureModifiers.engagementTactics += 
    personality.pressureModifiers.riskTolerance * interactions.engagementTactics_riskTolerance;
  
  personality.pressureModifiers.complexityTolerance += 
    personality.pressureModifiers.abstractionLevel * interactions.abstractionLevel_complexityTolerance;
}

/**
 * Update current traits based on base traits and pressure modifiers
 */
function updateCurrentTraits(personality: ContinuousPersonality): void {
  Object.keys(personality.currentTraits).forEach(trait => {
    const traitKey = trait as keyof PersonalityParameters;
    const baseValue = personality.baseTraits[traitKey];
    const pressureValue = personality.pressureModifiers[traitKey];
    
    // Apply pressure and clamp to valid range
    let newValue = baseValue + pressureValue;
    newValue = Math.max(1, Math.min(10, newValue));
    
    personality.currentTraits[traitKey] = newValue;
  });
}

/**
 * Decay pressure effects over time
 */
export function decayPressures(personality: ContinuousPersonality, decayRate: number): void {
  Object.keys(personality.pressureModifiers).forEach(trait => {
    const traitKey = trait as keyof PersonalityParameters;
    personality.pressureModifiers[traitKey] *= (1 - decayRate);
  });
  
  // Update current traits after decay
  updateCurrentTraits(personality);
}

/**
 * Get current personality state for system prompt generation
 */
export function getCurrentPersonalityPrompt(
  personality: ContinuousPersonality,
  opponentName: string,
  topic: string
): string {
  const traits = personality.currentTraits;
  const synthesis = synthesizePersonality(traits, opponentName, topic);
  
  return `[DYNAMIC PERSONALITY PROFILE - Turn ${personality.lastUpdated}]

COGNITIVE STYLE:
Your analytical approach: ${synthesis.cognitiveStyle}

EMOTIONAL STANCE:
You argue with ${synthesis.emotionalStance}

RHETORICAL STYLE:
Your argument structure follows ${synthesis.rhetoricalApproach}

BEHAVIORAL TENDENCIES:
${synthesis.behavioralTendencies.map(t => `• ${t}`).join('\n')}

BANNED TACTICS:
${synthesis.bannedTactics.map(t => `• ${t}`).join('\n')}

ADAPTATION STATUS:
- Trait Elasticity: ${personality.traitElasticity.toFixed(2)}
- Active Pressures: ${personality.activePressures.length}
- Evolution Events: ${personality.evolutionHistory.length}

Maintain this dynamic personality while responding to ${opponentName} on the topic: "${topic}"`;
}

/**
 * Synthesize personality traits into descriptive text
 */
function synthesizePersonality(
  traits: PersonalityParameters,
  opponentName: string,
  topic: string
): PersonalitySynthesis {
  
  // Cognitive style synthesis
  const cognitiveDescriptions = [
    "surface-level observations and basic pattern recognition",
    "moderate causal analysis with practical focus",
    "systematic mechanism exploration and structured reasoning",
    "deep structural analysis with interconnected systems thinking",
    "highly sophisticated analysis with abstract conceptual integration"
  ];
  
  const cognitiveLevel = Math.min(
    Math.floor((traits.analyticalDepth + traits.complexityTolerance) / 4),
    4
  );
  const cognitiveStyle = cognitiveDescriptions[cognitiveLevel];
  
  // Emotional stance synthesis
  const emotionalDescriptions = [
    "detached, analytical tone with minimal emotional expression",
    "measured emotional engagement with balanced reasoning",
    "confident advocacy with controlled emotional intensity",
    "passionate engagement with strong emotional commitment",
    "intense emotional expression with absolute conviction"
  ];
  
  const emotionalLevel = Math.min(
    Math.floor((traits.emotionalRange + traits.convictionIntensity) / 4),
    4
  );
  const emotionalStance = emotionalDescriptions[emotionalLevel];
  
  // Rhetorical approach synthesis
  const rhetoricalDescriptions = [
    "simple, straightforward communication with loose structure",
    "clear logical progression with balanced expression",
    "well-structured arguments with varied rhetorical techniques",
    "highly structured, formal argumentation with sophisticated style",
    "complex, multi-layered rhetoric with ornate linguistic expression"
  ];
  
  const rhetoricalLevel = Math.min(
    Math.floor((traits.argumentStructure + traits.linguisticStyle + traits.engagementTactics) / 6),
    4
  );
  const rhetoricalApproach = rhetoricalDescriptions[rhetoricalLevel];
  
  // Behavioral tendencies
  const tendencies: string[] = [];
  
  if (traits.evidencePreference > 7) {
    tendencies.push("demand rigorous evidence and data-driven reasoning");
  }
  if (traits.riskTolerance > 7) {
    tendencies.push("embrace controversial positions and bold tactics");
  }
  if (traits.stakesPersonalization > 7) {
    tendencies.push("personalize arguments with deep emotional investment");
  }
  if (traits.abstractionLevel > 7) {
    tendencies.push("operate at high conceptual levels with theoretical frameworks");
  }
  if (traits.metaphorUsage > 7) {
    tendencies.push("use rich metaphors and symbolic expression");
  }
  
  // Banned tactics based on personality
  const bannedTactics: string[] = [];
  
  if (traits.evidencePreference > 8) {
    bannedTactics.push("fabricated statistics, unverified claims");
  }
  if (traits.emotionalRange <= 3) {
    bannedTactics.push("emotional manipulation, appeals to fear");
  }
  if (traits.argumentStructure > 8) {
    bannedTactics.push("logical fallacies, circular reasoning");
  }
  if (traits.linguisticStyle <= 4) {
    bannedTactics.push("pretentious language, unnecessary jargon");
  }
  if (traits.engagementTactics > 8) {
    bannedTactics.push("evasion, subject changing");
  }
  if (bannedTactics.length === 0) {
    bannedTactics.push("personal attacks on character");
  }
  
  return {
    cognitiveStyle,
    emotionalStance,
    rhetoricalApproach,
    behavioralTendencies: tendencies,
    bannedTactics
  };
}

/**
 * Initialize adaptive agent state
 */
export function initializeAdaptiveAgent(
  agentId: string,
  archetypeKey: string,
  initialGoals: MetaGoal[]
): AdaptiveAgentState {
  
  const personality = createContinuousPersonality(`${agentId}-personality`, archetypeKey);
  
  return {
    agentId,
    personality,
    currentGoals: initialGoals,
    goalHistory: [],
    tacticalMemory: {
      usedTactics: [],
      effectiveTactics: [],
      ineffectiveTactics: [],
      situationalSuccess: new Map()
    },
    adaptationMetrics: {
      adaptationRate: 1.0,
      consistencyScore: 1.0,
      responsivenessScore: 0.5,
      strategicAlignment: 0.5
    }
  };
}

/**
 * Update adaptation metrics based on recent performance
 */
export function updateAdaptationMetrics(
  state: AdaptiveAgentState,
  recentEvolutions: PersonalityEvolution[],
  recentGoalChanges: GoalEvolution[]
): void {
  
  // Calculate adaptation rate (how much personality is changing)
  const avgIntensity = recentEvolutions.length > 0 
    ? recentEvolutions.reduce((sum, e) => sum + e.intensity, 0) / recentEvolutions.length
    : 0;
  state.adaptationMetrics.adaptationRate = Math.min(2.0, avgIntensity / 50);
  
  // Calculate consistency score (how stable personality remains)
  const traitVariance = calculateTraitVariance(state.personality);
  state.adaptationMetrics.consistencyScore = Math.max(0.1, 1.0 - traitVariance);
  
  // Calculate responsiveness (how well it responds to pressure)
  const activePressures = state.personality.activePressures.length;
  state.adaptationMetrics.responsivenessScore = Math.min(1.0, activePressures / 3);
  
  // Calculate strategic alignment (how well tactics match goals)
  state.adaptationMetrics.strategicAlignment = calculateGoalAlignment(state.currentGoals);
}

/**
 * Calculate variance in personality traits
 */
function calculateTraitVariance(personality: ContinuousPersonality): number {
  const traits = Object.values(personality.currentTraits);
  const mean = traits.reduce((sum, val) => sum + val, 0) / traits.length;
  const variance = traits.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / traits.length;
  return variance / 100; // Normalize to 0-1 range
}

/**
 * Calculate how well goals are aligned with each other
 */
function calculateGoalAlignment(goals: MetaGoal[]): number {
  if (goals.length <= 1) return 1.0;
  
  const activeGoals = goals.filter(g => g.isActive);
  if (activeGoals.length <= 1) return 1.0;
  
  const priorities = activeGoals.map(g => g.priority);
  const maxPriority = Math.max(...priorities);
  const avgPriority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length;
  
  return avgPriority / maxPriority;
}

/**
 * Record tactic usage in memory
 */
export function recordTacticUsage(
  memory: TacticMemory,
  tactic: string,
  effectiveness: number,
  context: string,
  goalId: string,
  opponentResponse: string,
  turnNumber: number
): void {
  
  const usage: TacticUsage = {
    turnNumber,
    tactic,
    effectiveness,
    context,
    goalId,
    opponentResponse
  };
  
  memory.usedTactics.push(usage);
  
  // Update effectiveness lists
  if (effectiveness > 70) {
    if (!memory.effectiveTactics.includes(tactic)) {
      memory.effectiveTactics.push(tactic);
    }
  } else if (effectiveness < 40) {
    if (!memory.ineffectiveTactics.includes(tactic)) {
      memory.ineffectiveTactics.push(tactic);
    }
  }
  
  // Update situational success
  const currentSuccess = memory.situationalSuccess.get(context) || 0;
  const newSuccess = (currentSuccess + effectiveness) / 2;
  memory.situationalSuccess.set(context, newSuccess);
}