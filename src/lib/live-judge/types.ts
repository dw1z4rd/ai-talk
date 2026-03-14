// Core Live Judge System Types

export interface ScoringWeights {
  logicalCoherence: number;      // 0.2 - 0.5
  rhetoricalForce: number;       // 0.2 - 0.5  
  frameControl: number;          // 0.1 - 0.3
  credibilityScore: number;      // 0.1 - 0.3
  tacticalEffectiveness: number; // 0.2 - 0.4
}

export interface JudgeScores {
  logicalCoherence: number;    // 0-100
  rhetoricalForce: number;     // 0-100
  frameControl: number;        // 0-100
  credibilityScore: number;    // 0-100
  tacticalEffectiveness: number; // 0-100
  overallScore: number;        // Weighted composite
}

export interface TacticAnalysis {
  tactic: string;
  effectiveness: number;       // 0-100
  confidence: number;          // 0-100
  context: string;             // When/why this was used
}

export interface TurnAnalysis {
  turnNumber: number;
  agentId: string;
  agentName: string;
  opponentId: string;
  opponentName: string;
  message: string;
  opponentMessage: string;
  context: string;
  
  // Scoring breakdown
  scores: JudgeScores;
  
  // Tactical insights
  usedTactics: TacticAnalysis[];
  effectivenessMap: { [tactic: string]: number };
  
  // Strategic impact
  momentumShift: number;         // -100 to +100
  frameControlShift: number;     // -100 to +100
  exposedWeaknesses: string[];
  tacticalInsights: string[];
  
  // Judge-specific data
  judgeId: string;
  judgeSpecialization: JudgeSpecialization;
  reasoning: string;
}

export interface JudgeBias {
  preferenceComplexity: number;    // -1 to 1 (prefers simple to complex)
  preferenceEmotion: number;        // -1 to 1 (prefers detached to passionate)
  preferenceAggression: number;     // -1 to 1 (prefers cautious to aggressive)
  preferenceEvidence: number;       // -1 to 1 (prefers intuitive to data-driven)
}

export interface LiveJudge {
  id: string;
  name: string;
  modelId: string;
  specialization: JudgeSpecialization;
  scoringWeights: ScoringWeights;
  biasProfile: JudgeBias;
  lastAnalysis: TurnAnalysis | null;
  analysisCount: number;
}

export type JudgeSpecialization = 'logic' | 'rhetoric' | 'strategy' | 'balance';

export interface AgentScores {
  agentId: string;
  agentName: string;
  totalScore: number;
  turnScores: JudgeScores[];
  momentumScore: number;
  frameControlScore: number;
  tacticalEffectiveness: number;
  lastTurnAnalysis: TurnAnalysis | null;
}

export interface MomentumTracker {
  currentMomentum: { [agentId: string]: number };
  momentumHistory: { [turnNumber: number]: { [agentId: string]: number } };
  lastMomentumShift: { [agentId: string]: number };
  momentumTrend: { [agentId: string]: 'rising' | 'falling' | 'stable' };
}

export interface FrameControlTracker {
  currentControl: { [agentId: string]: number };
  controlHistory: { [turnNumber: number]: { [agentId: string]: number } };
  lastControlShift: { [agentId: string]: number };
  dominantFrame: string | null;
}

export interface AdaptivePressure {
  sourceJudge: string;
  sourceTurn: number;
  
  // Pressure types
  cognitivePressure: number;     // 0-100 (affects analytical traits)
  emotionalPressure: number;     // 0-100 (affects emotional traits)
  strategicPressure: number;     // 0-100 (affects risk/aggression traits)
  credibilityPressure: number;   // 0-100 (affects evidence/personal traits)
  
  // Specific trait adjustments (-5 to +5)
  traitAdjustments: {
    analyticalDepth: number;
    evidencePreference: number;
    abstractionLevel: number;
    complexityTolerance: number;
    convictionIntensity: number;
    emotionalRange: number;
    riskTolerance: number;
    stakesPersonalization: number;
    argumentStructure: number;
    linguisticStyle: number;
    engagementTactics: number;
    metaphorUsage: number;
  };
  
  // Duration and decay
  intensity: number;             // Overall pressure strength 0-100
  decayRate: number;             // How quickly pressure fades 0-1
  duration: number;             // How long pressure lasts (turns)
}

export interface LiveJudgePanel {
  judges: LiveJudge[];
  currentScores: { [agentId: string]: AgentScores };
  momentumTracker: MomentumTracker;
  frameControlTracker: FrameControlTracker;
  turnCount: number;
  isActive: boolean;
}

export interface JudgeAnalysisResult {
  turnNumber: number;
  agentId: string;
  agentScores: JudgeScores;
  aggregatedScores: JudgeScores;
  momentumShift: number;
  frameControlShift: number;
  adaptivePressures: AdaptivePressure[];
  judgeAnalyses: TurnAnalysis[];
  newMomentumState: MomentumTracker;
  newFrameControlState: FrameControlTracker;
}

// Judge specialization configurations
export const JUDGE_SPECIALIZATION_CONFIGS: Record<JudgeSpecialization, {
  name: string;
  scoringWeights: ScoringWeights;
  typicalBias: JudgeBias;
  description: string;
}> = {
  logic: {
    name: 'Logic Judge',
    scoringWeights: {
      logicalCoherence: 0.4,
      rhetoricalForce: 0.2,
      frameControl: 0.15,
      credibilityScore: 0.1,
      tacticalEffectiveness: 0.15
    },
    typicalBias: {
      preferenceComplexity: 0.3,
      preferenceEmotion: -0.2,
      preferenceAggression: -0.1,
      preferenceEvidence: 0.4
    },
    description: 'Values rigorous reasoning and logical consistency above all'
  },
  rhetoric: {
    name: 'Rhetoric Judge',
    scoringWeights: {
      logicalCoherence: 0.15,
      rhetoricalForce: 0.4,
      frameControl: 0.25,
      credibilityScore: 0.15,
      tacticalEffectiveness: 0.05
    },
    typicalBias: {
      preferenceComplexity: -0.2,
      preferenceEmotion: 0.4,
      preferenceAggression: 0.2,
      preferenceEvidence: -0.1
    },
    description: 'Focuses on persuasive power and emotional resonance'
  },
  strategy: {
    name: 'Strategy Judge',
    scoringWeights: {
      logicalCoherence: 0.2,
      rhetoricalForce: 0.15,
      frameControl: 0.2,
      credibilityScore: 0.1,
      tacticalEffectiveness: 0.35
    },
    typicalBias: {
      preferenceComplexity: 0.1,
      preferenceEmotion: 0.0,
      preferenceAggression: 0.3,
      preferenceEvidence: 0.2
    },
    description: 'Evaluates tactical brilliance and strategic effectiveness'
  },
  balance: {
    name: 'Balance Judge',
    scoringWeights: {
      logicalCoherence: 0.2,
      rhetoricalForce: 0.2,
      frameControl: 0.2,
      credibilityScore: 0.2,
      tacticalEffectiveness: 0.2
    },
    typicalBias: {
      preferenceComplexity: 0.0,
      preferenceEmotion: 0.0,
      preferenceAggression: 0.0,
      preferenceEvidence: 0.0
    },
    description: 'Provides balanced assessment across all debate aspects'
  }
};

// Tactic types for analysis
export const DEBATE_TACTICS = [
  'logical_refutation',
  'evidence_citation',
  'emotional_appeal',
  'frame_redefinition',
  'questioning',
  'contradiction',
  'ridicule',
  'authority_appeal',
  'analogy',
  'redirection',
  'concession',
  'escalation',
  'de_escalation',
  'personal_attack',
  'strategic_silence'
] as const;

export type DebateTactic = typeof DEBATE_TACTICS[number];