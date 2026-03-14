// Functional and declarative core for live judge system

import type { LiveJudge, JudgeScores, TurnAnalysis, AdaptivePressure } from './types';
import type { Agent, Message } from '$lib/agents';

// Pure functions for judge operations

export const createJudgeScore = (
  logicalCoherence: number,
  rhetoricalForce: number,
  frameControl: number,
  credibilityScore: number,
  tacticalEffectiveness: number,
  weights: { logicalCoherence: number; rhetoricalForce: number; frameControl: number; credibilityScore: number; tacticalEffectiveness: number }
): JudgeScores => ({
  logicalCoherence,
  rhetoricalForce,
  frameControl,
  credibilityScore,
  tacticalEffectiveness,
  overallScore: Math.round(
    logicalCoherence * weights.logicalCoherence +
    rhetoricalForce * weights.rhetoricalForce +
    frameControl * weights.frameControl +
    credibilityScore * weights.credibilityScore +
    tacticalEffectiveness * weights.tacticalEffectiveness
  )
});

export const aggregateScores = (analyses: TurnAnalysis[]): JudgeScores => {
  if (analyses.length === 0) {
    return createJudgeScore(0, 0, 0, 0, 0, {
      logicalCoherence: 0.2,
      rhetoricalForce: 0.2,
      frameControl: 0.2,
      credibilityScore: 0.2,
      tacticalEffectiveness: 0.2
    });
  }

  const sum = analyses.reduce(
    (acc, analysis) => ({
      logicalCoherence: acc.logicalCoherence + analysis.scores.logicalCoherence,
      rhetoricalForce: acc.rhetoricalForce + analysis.scores.rhetoricalForce,
      frameControl: acc.frameControl + analysis.scores.frameControl,
      credibilityScore: acc.credibilityScore + analysis.scores.credibilityScore,
      tacticalEffectiveness: acc.tacticalEffectiveness + analysis.scores.tacticalEffectiveness
    }),
    { logicalCoherence: 0, rhetoricalForce: 0, frameControl: 0, credibilityScore: 0, tacticalEffectiveness: 0 }
  );

  const divisor = analyses.length;
  return createJudgeScore(
    Math.round(sum.logicalCoherence / divisor),
    Math.round(sum.rhetoricalForce / divisor),
    Math.round(sum.frameControl / divisor),
    Math.round(sum.credibilityScore / divisor),
    Math.round(sum.tacticalEffectiveness / divisor),
    { logicalCoherence: 0.2, rhetoricalForce: 0.2, frameControl: 0.2, credibilityScore: 0.2, tacticalEffectiveness: 0.2 }
  );
};

export const calculateMomentumShift = (
  scores: JudgeScores,
  currentMomentum: number,
  inertiaFactor: number = 0.1
): number => {
  const baseMomentum = (scores.overallScore - 50) * 0.4;
  const tacticalBonus = (scores.tacticalEffectiveness - 50) * 0.3;
  const credibilityPenalty = (50 - scores.credibilityScore) * 0.2;
  const momentumWithInertia = currentMomentum * inertiaFactor;
  
  const momentumShift = baseMomentum + tacticalBonus - credibilityPenalty + momentumWithInertia;
  return Math.max(-25, Math.min(25, momentumShift));
};

export const calculateFrameControlShift = (
  scores: JudgeScores,
  currentControl: number,
  inertiaFactor: number = 0.15
): number => {
  const baseControl = (scores.logicalCoherence + scores.rhetoricalForce) / 2 - 50;
  const tacticalModifier = (scores.tacticalEffectiveness - 50) * 0.3;
  const controlWithInertia = currentControl * inertiaFactor;
  
  const frameShift = (baseControl + tacticalModifier + controlWithInertia) * 0.4;
  return Math.max(-20, Math.min(20, frameShift));
};

// Immutable state updates

export const updateMomentumState = (
  currentState: { [agentId: string]: number },
  agentId: string,
  shift: number
): { [agentId: string]: number } => ({
  ...currentState,
  [agentId]: (currentState[agentId] || 0) + shift
});

export const updateFrameControlState = (
  currentState: { [agentId: string]: number },
  agentId: string,
  shift: number
): { [agentId: string]: number } => ({
  ...currentState,
  [agentId]: (currentState[agentId] || 0) + shift
});

export const updateTrend = (
  shift: number
): 'rising' | 'falling' | 'stable' => {
  if (shift > 5) return 'rising';
  if (shift < -5) return 'falling';
  return 'stable';
};

// Function composition helpers

export const compose = <T>(...fns: Array<(x: T) => T>) => (x: T): T =>
  fns.reduceRight((acc, fn) => fn(acc), x);

export const pipe = <T>(...fns: Array<(x: T) => T>) => (x: T): T =>
  fns.reduce((acc, fn) => fn(acc), x);

// Curried functions for flexible composition

export const withWeight = (weight: number) => (value: number): number => value * weight;
export const clamp = (min: number, max: number) => (value: number): number => Math.max(min, Math.min(max, value));
export const round = (precision: number = 0) => (value: number): number => {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
};

// Common pipelines

export const calculateScorePipeline = pipe(
  withWeight(0.4),
  clamp(0, 100),
  round()
);

export const calculatePressurePipeline = pipe(
  withWeight(0.5),
  clamp(0, 100),
  round(1)
);

// Functional data structures

export class ImmutableMap<K, V> {
  constructor(private readonly data: Map<K, V>) {}

  static empty<K, V>(): ImmutableMap<K, V> {
    return new ImmutableMap(new Map());
  }

  set(key: K, value: V): ImmutableMap<K, V> {
    return new ImmutableMap(new Map(this.data).set(key, value));
  }

  get(key: K): V | undefined {
    return this.data.get(key);
  }

  has(key: K): boolean {
    return this.data.has(key);
  }

  entries(): Array<[K, V]> {
    return Array.from(this.data.entries());
  }

  values(): V[] {
    return Array.from(this.data.values());
  }

  keys(): K[] {
    return Array.from(this.data.keys());
  }

  merge(other: ImmutableMap<K, V>): ImmutableMap<K, V> {
    return new ImmutableMap(new Map([...this.data, ...other.data]));
  }

  filter(predicate: (value: V, key: K) => boolean): ImmutableMap<K, V> {
    return new ImmutableMap(
      Array.from(this.data.entries()).filter(([key, value]) => predicate(value, key))
    );
  }

  map<V2>(mapper: (value: V, key: K) => V2): ImmutableMap<K, V2> {
    return new ImmutableMap(
      Array.from(this.data.entries()).reduce(
        (acc, [key, value]) => acc.set(key, mapper(value, key)),
        new Map<K, V2>()
      )
    );
  }

  size(): number {
    return this.data.size;
  }
}

// Functional state management

export interface JudgeState {
  currentScores: ImmutableMap<string, JudgeScores>;
  momentumTracker: {
    currentMomentum: ImmutableMap<string, number>;
    momentumTrend: ImmutableMap<string, 'rising' | 'falling' | 'stable'>;
  };
  frameControlTracker: {
    currentControl: ImmutableMap<string, number>;
    dominantFrame: string | null;
  };
  turnCount: number;
}

export const initialJudgeState = (): JudgeState => ({
  currentScores: ImmutableMap.empty(),
  momentumTracker: {
    currentMomentum: ImmutableMap.empty(),
    momentumTrend: ImmutableMap.empty()
  },
  frameControlTracker: {
    currentControl: ImmutableMap.empty(),
    dominantFrame: null
  },
  turnCount: 0
});

export const updateJudgeState = (
  state: JudgeState,
  analysis: TurnAnalysis
): JudgeState => {
  const newScores = state.currentScores.set(analysis.agentId, analysis.scores);
  const momentumShift = calculateMomentumShift(
    analysis.scores,
    state.momentumTracker.currentMomentum.get(analysis.agentId) || 0
  );
  const frameShift = calculateFrameControlShift(
    analysis.scores,
    state.frameControlTracker.currentControl.get(analysis.agentId) || 0
  );

  const newMomentum = updateMomentumState(
    Array.from(state.momentumTracker.currentMomentum.entries()).reduce(
      (acc, [id, value]) => ({ ...acc, [id]: value }),
      {}
    ),
    analysis.agentId,
    momentumShift
  );

  const newControl = updateFrameControlState(
    Array.from(state.frameControlTracker.currentControl.entries()).reduce(
      (acc, [id, value]) => ({ ...acc, [id]: value }),
      {}
    ),
    analysis.agentId,
    frameShift
  );

  const newMomentumTrend = state.momentumTracker.momentumTrend.set(
    analysis.agentId,
    updateTrend(momentumShift)
  );

  const dominantFrame = Object.entries(newControl).reduce(
    (max, [id, value]) => value > (max.value || 0) ? { id, value } : max,
    { id: '', value: 0 }
  ).id || null;

  return {
    ...state,
    currentScores: newScores,
    momentumTracker: {
      currentMomentum: createImmutableMap(Object.entries(newMomentum)),
      momentumTrend: newMomentumTrend
    },
    frameControlTracker: {
      currentControl: createImmutableMap(Object.entries(newControl)),
      dominantFrame
    },
    turnCount: state.turnCount + 1
  };
};

// Helper for creating ImmutableMap from entries
export const createImmutableMap = <K, V>(entries: Array<[K, V]>): ImmutableMap<K, V> =>
  new ImmutableMap(new Map(entries));

// Functional validation

export const validateScores = (scores: JudgeScores): boolean => {
  const { logicalCoherence, rhetoricalForce, frameControl, credibilityScore, tacticalEffectiveness } = scores;
  return [logicalCoherence, rhetoricalForce, frameControl, credibilityScore, tacticalEffectiveness]
    .every(score => score >= 0 && score <= 100);
};

export const validateAnalysis = (analysis: TurnAnalysis): boolean => {
  return (
    analysis.turnNumber >= 0 &&
    analysis.agentId.length > 0 &&
    analysis.agentName.length > 0 &&
    validateScores(analysis.scores)
  );
};

// Functional utilities for judge operations

export const processJudgeAnalyses = (
  analyses: TurnAnalysis[],
  initialState: JudgeState = initialJudgeState()
): JudgeState =>
  analyses.reduce(updateJudgeState, initialState);

export const getLeader = (
  scores: ImmutableMap<string, JudgeScores>
): { agentId: string; score: number } | null => {
  const entries = scores.entries();
  if (entries.length === 0) return null;
  
  return entries.reduce(
    (leader, [agentId, judgeScores]) => 
      judgeScores.overallScore > leader.score 
        ? { agentId, score: judgeScores.overallScore }
        : leader,
    { agentId: '', score: 0 }
  );
};

export const compareAgents = (
  agentAId: string,
  agentBId: string,
  scores: ImmutableMap<string, JudgeScores>
): 'A' | 'B' | 'tie' => {
  const scoreA = scores.get(agentAId)?.overallScore ?? 0;
  const scoreB = scores.get(agentBId)?.overallScore ?? 0;
  
  if (scoreA > scoreB) return 'A';
  if (scoreB > scoreA) return 'B';
  return 'tie';
};