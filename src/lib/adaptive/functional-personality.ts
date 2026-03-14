// Functional and declarative personality adaptation system

import type { 
  PersonalityParameters, 
  ContinuousPersonality, 
  PersonalityEvolution,
  AdaptiveAgentState,
  MetaGoal,
  TacticMemory,
  TacticUsage,
  AdaptationMetrics
} from './types';
import type { AdaptivePressure } from '$lib/live-judge/types';

// Pure functions for personality operations

export const createPersonalityParameters = (
  analyticalDepth: number,
  evidencePreference: number,
  abstractionLevel: number,
  complexityTolerance: number,
  convictionIntensity: number,
  emotionalRange: number,
  riskTolerance: number,
  stakesPersonalization: number,
  argumentStructure: number,
  linguisticStyle: number,
  engagementTactics: number,
  metaphorUsage: number
): PersonalityParameters => ({
  analyticalDepth,
  evidencePreference,
  abstractionLevel,
  complexityTolerance,
  convictionIntensity,
  emotionalRange,
  riskTolerance,
  stakesPersonalization,
  argumentStructure,
  linguisticStyle,
  engagementTactics,
  metaphorUsage
});

export const clampTrait = (value: number): number => Math.max(1, Math.min(10, value));

export const applyTraitAdjustment = (
  base: PersonalityParameters,
  adjustment: Partial<PersonalityParameters>
): PersonalityParameters => {
  const result = { ...base };
  Object.entries(adjustment).forEach(([trait, value]) => {
    const traitKey = trait as keyof PersonalityParameters;
    result[traitKey] = clampTrait((result[traitKey] || 0) + value);
  });
  return result;
};

export const applyPressureToTraits = (
  personality: ContinuousPersonality,
  pressure: AdaptivePressure,
  elasticity: number
): ContinuousPersonality => {
  const adjustedTraits = applyTraitAdjustment(
    personality.baseTraits,
    Object.entries(pressure.traitAdjustments).reduce(
      (acc, [trait, adjustment]) => ({
        ...acc,
        [trait]: adjustment * elasticity
      }),
      {}
    ) as Partial<PersonalityParameters>
  );

  return {
    ...personality,
    currentTraits: adjustedTraits,
    pressureModifiers: pressure.traitAdjustments,
    activePressures: [...personality.activePressures, `${pressure.sourceJudge}-${pressure.sourceTurn}`],
    lastUpdated: pressure.sourceTurn
  };
};

export const decayPersonalityPressure = (
  personality: ContinuousPersonality,
  decayRate: number
): ContinuousPersonality => ({
  ...personality,
  pressureModifiers: Object.entries(personality.pressureModifiers).reduce(
    (acc, [trait, value]) => ({
      ...acc,
      [trait]: value * (1 - decayRate)
    }),
    {} as Partial<PersonalityParameters>
  ) as PersonalityParameters
});

// Immutable state operations

export const updatePersonalityWithPressures = (
  personality: ContinuousPersonality,
  pressures: AdaptivePressure[],
  turnNumber: number
): ContinuousPersonality => {
  const updatedPersonality = pressures.reduce(
    (acc, pressure) => applyPressureToTraits(acc, pressure, acc.traitElasticity),
    personality
  );

  return {
    ...updatedPersonality,
    lastUpdated: turnNumber,
    activePressures: pressures.map(p => `${p.sourceJudge}-${p.sourceTurn}`)
  };
};

export const addEvolutionToHistory = (
  personality: ContinuousPersonality,
  evolution: PersonalityEvolution
): ContinuousPersonality => ({
  ...personality,
  evolutionHistory: [...personality.evolutionHistory, evolution]
});

// Functional trait interactions

export const applyTraitInteractions = (traits: PersonalityParameters): PersonalityParameters => {
  const interactions = {
    analyticalDepth_evidencePreference: 0.3,
    riskTolerance_emotionalRange: 0.2,
    convictionIntensity_stakesPersonalization: 0.4,
    engagementTactics_riskTolerance: 0.3,
    abstractionLevel_complexityTolerance: 0.5
  };

  return {
    ...traits,
    evidencePreference: traits.evidencePreference + traits.analyticalDepth * interactions.analyticalDepth_evidencePreference,
    emotionalRange: traits.emotionalRange + traits.riskTolerance * interactions.riskTolerance_emotionalRange,
    stakesPersonalization: traits.stakesPersonalization + traits.convictionIntensity * interactions.convictionIntensity_stakesPersonalization,
    engagementTactics: traits.engagementTactics + traits.riskTolerance * interactions.engagementTactics_riskTolerance,
    complexityTolerance: traits.complexityTolerance + traits.abstractionLevel * interactions.abstractionLevel_complexityTolerance
  };
};

// Functional goal operations

export const createMetaGoal = (
  id: string,
  type: MetaGoal['type'],
  priority: number,
  successMetric: string,
  tactics: string[],
  turnNumber: number
): MetaGoal => ({
  id,
  type,
  priority,
  successMetric,
  tacticalPreferences: tactics.map(tactic => ({
    tactic,
    weight: 0.7,
    triggerConditions: [],
    effectivenessScore: 0
  })),
  isActive: true,
  activationTurn: turnNumber
});

export const updateGoalPriority = (
  goals: MetaGoal[],
  goalId: string,
  newPriority: number,
  turnNumber: number
): MetaGoal[] => 
  goals.map(goal => 
    goal.id === goalId 
      ? { ...goal, priority: newPriority }
      : goal
  );

export const filterActiveGoals = (goals: MetaGoal[]): MetaGoal[] =>
  goals.filter(goal => goal.isActive);

export const getHighestPriorityGoal = (goals: MetaGoal[]): MetaGoal | null => {
  const activeGoals = filterActiveGoals(goals);
  return activeGoals.reduce(
    (highest: MetaGoal | null, goal) => goal.priority > (highest?.priority || 0) ? goal : highest,
    null
  );
};

// Functional tactical memory

export const addTacticUsage = (
  memory: TacticMemory,
  usage: TacticUsage
): TacticMemory => ({
  ...memory,
  usedTactics: [...memory.usedTactics, usage],
  effectiveTactics: usage.effectiveness > 70 
    ? [...new Set([...memory.effectiveTactics, usage.tactic])]
    : memory.effectiveTactics,
  ineffectiveTactics: usage.effectiveness < 40
    ? [...new Set([...memory.ineffectiveTactics, usage.tactic])]
    : memory.ineffectiveTactics,
  situationalSuccess: new Map([
    ...memory.situationalSuccess.entries(),
    [usage.context, ((memory.situationalSuccess.get(usage.context) || 0) + usage.effectiveness) / 2]
  ])
});

export const getTacticEffectiveness = (
  memory: TacticMemory,
  tactic: string,
  context?: string
): number => {
  const tacticUsages = memory.usedTactics.filter(u => u.tactic === tactic);
  if (tacticUsages.length === 0) return 50;
  
  if (context && memory.situationalSuccess.has(context)) {
    return memory.situationalSuccess.get(context)!;
  }
  
  return tacticUsages.reduce((sum, usage) => sum + usage.effectiveness, 0) / tacticUsages.length;
};

// Functional metrics

export const calculateAdaptationRate = (evolutions: PersonalityEvolution[]): number => {
  if (evolutions.length === 0) return 1.0;
  const avgIntensity = evolutions.reduce((sum, e) => sum + e.intensity, 0) / evolutions.length;
  return Math.min(2.0, avgIntensity / 50);
};

export const calculateConsistencyScore = (personality: ContinuousPersonality): number => {
  const traits = Object.values(personality.currentTraits);
  const mean = traits.reduce((sum, val) => sum + val, 0) / traits.length;
  const variance = traits.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / traits.length;
  return Math.max(0.1, 1.0 - variance / 100);
};

export const calculateResponsivenessScore = (personality: ContinuousPersonality): number => {
  return Math.min(1.0, personality.activePressures.length / 3);
};

export const calculateStrategicAlignment = (goals: MetaGoal[]): number => {
  const activeGoals = filterActiveGoals(goals);
  if (activeGoals.length <= 1) return 1.0;
  
  const priorities = activeGoals.map(g => g.priority);
  const maxPriority = Math.max(...priorities);
  const avgPriority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length;
  
  return avgPriority / maxPriority;
};

export const updateAdaptationMetrics = (
  state: AdaptiveAgentState,
  recentEvolutions: PersonalityEvolution[]
): AdaptiveAgentState => ({
  ...state,
  adaptationMetrics: {
    adaptationRate: calculateAdaptationRate(recentEvolutions),
    consistencyScore: calculateConsistencyScore(state.personality),
    responsivenessScore: calculateResponsivenessScore(state.personality),
    strategicAlignment: calculateStrategicAlignment(state.currentGoals)
  }
});

// Functional composition helpers

export const composePersonalityTransformations = (
  ...transformations: Array<(p: PersonalityParameters) => PersonalityParameters>
) => (initial: PersonalityParameters): PersonalityParameters =>
  transformations.reduce((acc, transform) => transform(acc), initial);

export const pipePersonalityTransformations = (
  ...transformations: Array<(p: PersonalityParameters) => PersonalityParameters>
) => (initial: PersonalityParameters): PersonalityParameters =>
  transformations.reduce((acc, transform) => transform(acc), initial);

// Common transformation pipelines

export const standardPersonalityPipeline = pipePersonalityTransformations(
  applyTraitInteractions,
  (traits) => Object.entries(traits).reduce(
    (acc, [trait, value]) => ({ ...acc, [trait]: clampTrait(value) }),
    {} as Partial<PersonalityParameters>
  ) as PersonalityParameters
);

// Curried functions for flexible composition

export const withTraitElasticity = (elasticity: number) => 
  (pressure: AdaptivePressure) => 
  (personality: ContinuousPersonality): ContinuousPersonality =>
    applyPressureToTraits(personality, pressure, elasticity);

export const withDecayRate = (decayRate: number) =>
  (personality: ContinuousPersonality): ContinuousPersonality =>
    decayPersonalityPressure(personality, decayRate);

export const withTraitBounds = (min: number, max: number) =>
  (traits: PersonalityParameters): PersonalityParameters =>
    Object.entries(traits).reduce(
      (acc, [trait, value]) => ({ ...acc, [trait]: Math.max(min, Math.min(max, value)) }),
      {} as Partial<PersonalityParameters>
    ) as PersonalityParameters;

// Functional validation

export const validatePersonalityParameters = (params: PersonalityParameters): boolean => {
  const values = Object.values(params);
  return values.every(value => typeof value === 'number' && value >= 1 && value <= 10);
};

export const validateContinuousPersonality = (personality: ContinuousPersonality): boolean => {
  return (
    personality.id.length > 0 &&
    validatePersonalityParameters(personality.baseTraits) &&
    validatePersonalityParameters(personality.currentTraits) &&
    personality.traitElasticity >= 0.1 &&
    personality.traitElasticity <= 2.0
  );
};

export const validateMetaGoal = (goal: MetaGoal): boolean => {
  return (
    goal.id.length > 0 &&
    goal.priority >= 0 &&
    goal.priority <= 1 &&
    goal.successMetric.length > 0 &&
    Array.isArray(goal.tacticalPreferences)
  );
};

// Functional state management utilities

export const createPersonalityState = (
  baseTraits: PersonalityParameters,
  elasticity: number = 1.0
): ContinuousPersonality => ({
  id: `personality-${Date.now()}`,
  baseTraits,
  currentTraits: baseTraits,
  pressureModifiers: createPersonalityParameters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  traitElasticity: elasticity,
  activePressures: [],
  lastUpdated: 0,
  evolutionHistory: []
});

export const processAdaptivePressures = (
  personality: ContinuousPersonality,
  pressures: AdaptivePressure[],
  turnNumber: number,
  elasticity: number = personality.traitElasticity
): ContinuousPersonality => {
  const withPressure = updatePersonalityWithPressures(personality, pressures, turnNumber);
  const withInteractions = {
    ...withPressure,
    currentTraits: applyTraitInteractions(withPressure.currentTraits)
  };
  
  return withInteractions;
};

// Functional comparison utilities

export const comparePersonalities = (
  p1: ContinuousPersonality,
  p2: ContinuousPersonality
): number => {
  const traits1 = Object.values(p1.currentTraits);
  const traits2 = Object.values(p2.currentTraits);
  const diff = traits1.reduce((sum, val, i) => sum + Math.abs(val - traits2[i]), 0);
  return diff / traits1.length;
};

export const personalityDistance = (
  p1: ContinuousPersonality,
  p2: ContinuousPersonality
): 'identical' | 'similar' | 'different' | 'very-different' => {
  const distance = comparePersonalities(p1, p2);
  if (distance < 0.5) return 'identical';
  if (distance < 1.5) return 'similar';
  if (distance < 3.0) return 'different';
  return 'very-different';
};

export const findMostSimilarPersonality = (
  target: ContinuousPersonality,
  candidates: ContinuousPersonality[]
): ContinuousPersonality | null => {
  if (candidates.length === 0) return null;
  
  return candidates.reduce((mostSimilar, candidate) => 
    comparePersonalities(target, candidate) < comparePersonalities(target, mostSimilar)
      ? candidate
      : mostSimilar
  );
};