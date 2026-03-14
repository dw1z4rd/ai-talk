// Adaptive Personality System Types

export interface PersonalityParameters {
  // Cognitive Style
  analyticalDepth: number; // 1-10: Surface-level to Deep analysis
  evidencePreference: number; // 1-10: Intuitive to Data-driven
  abstractionLevel: number; // 1-10: Concrete to Highly abstract
  complexityTolerance: number; // 1-10: Simple to Complex

  // Emotional Stance
  convictionIntensity: number; // 1-10: Tentative to Absolute
  emotionalRange: number; // 1-10: Detached to Passionate
  riskTolerance: number; // 1-10: Conservative to Aggressive
  stakesPersonalization: number; // 1-10: Impersonal to Deeply personal

  // Rhetorical Approach
  argumentStructure: number; // 1-10: Loose to Highly structured
  linguisticStyle: number; // 1-10: Plain to Ornate
  engagementTactics: number; // 1-10: Passive to Aggressive
  metaphorUsage: number; // 1-10: Literal to Highly metaphorical
}

export interface ContinuousPersonality {
  id: string;
  baseTraits: PersonalityParameters; // Starting point
  currentTraits: PersonalityParameters; // Dynamic state
  pressureModifiers: PersonalityParameters; // Current pressure effects
  traitElasticity: number; // How quickly traits shift (0.1-2.0)
  
  // State tracking
  activePressures: string[]; // IDs of active pressures
  lastUpdated: number; // Turn number of last update
  evolutionHistory: PersonalityEvolution[];
}

export interface PersonalityEvolution {
  turnNumber: number;
  sourceJudge: string;
  sourcePressure: string;
  traitChanges: Partial<PersonalityParameters>;
  reasoning: string;
  intensity: number;
}

export interface AdaptiveAgentState {
  agentId: string;
  personality: ContinuousPersonality;
  currentGoals: MetaGoal[];
  goalHistory: GoalEvolution[];
  tacticalMemory: TacticMemory;
  adaptationMetrics: AdaptationMetrics;
}

export interface MetaGoal {
  id: string;
  type: 'frame_control' | 'contradiction_mining' | 'ethos_undermining' | 'destabilization' | 'defensive' | 'dominance';
  priority: number; // 0-1, changes dynamically
  successMetric: string; // How to measure success
  tacticalPreferences: TacticPreference[];
  isActive: boolean;
  activationTurn: number;
}

export interface TacticPreference {
  tactic: string;
  weight: number; // How much this tactic serves the goal
  triggerConditions: string[];
  effectivenessScore: number; // Historical effectiveness
}

export interface GoalEvolution {
  turnNumber: number;
  goalId: string;
  oldPriority: number;
  newPriority: number;
  triggerEvent: string;
  reasoning: string;
}

export interface TacticMemory {
  usedTactics: TacticUsage[];
  effectiveTactics: string[]; // Tactics that worked well
  ineffectiveTactics: string[]; // Tactics that failed
  situationalSuccess: Map<string, number>; // Context -> success rate
}

export interface TacticUsage {
  turnNumber: number;
  tactic: string;
  effectiveness: number;
  context: string;
  goalId: string;
  opponentResponse: string;
}

export interface AdaptationMetrics {
  adaptationRate: number; // How quickly personality adapts
  consistencyScore: number; // How consistent personality remains
  responsivenessScore: number; // How well it responds to pressure
  strategicAlignment: number; // How well tactics align with goals
}

// Goal system configurations
export const GOAL_TYPE_CONFIGS = Record<string, {
  name: string;
  description: string;
  preferredTactics: string[];
  successMetrics: string[];
  personalityTriggers: Partial<PersonalityParameters>;
}>;

// Trait interaction matrix
export interface TraitInteractionMatrix {
  // How traits amplify/dampen each other (-1 to 1)
  analyticalDepth_evidencePreference: number;
  riskTolerance_emotionalRange: number;
  convictionIntensity_stakesPersonalization: number;
  engagementTactics_riskTolerance: number;
  abstractionLevel_complexityTolerance: number;
  // ... more interactions as needed
}

export interface SynthesisRule {
  trait: keyof PersonalityParameters;
  value: number;
  synthesis: (context: string, opponent: string, topic: string) => string;
}

export interface PersonalitySynthesis {
  cognitiveStyle: string;
  emotionalStance: string;
  rhetoricalApproach: string;
  behavioralTendencies: string[];
  bannedTactics: string[];
}