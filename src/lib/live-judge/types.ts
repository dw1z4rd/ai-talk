// Core Live Judge System Types

export interface ScoringWeights {
  logicalCoherence: number; // 0.2 - 0.5
  rhetoricalForce: number; // 0.2 - 0.5
  frameControl: number; // 0.1 - 0.3
  credibilityScore: number; // 0.1 - 0.3
  tacticalEffectiveness: number; // 0.2 - 0.4
}

export interface JudgeScores {
  logicalCoherence: number; // 0-100
  rhetoricalForce: number; // 0-100
  frameControl: number; // 0-100
  credibilityScore: number; // 0-100
  tacticalEffectiveness: number; // 0-100
  overallScore: number; // Weighted composite
  /**
   * Real LLM absolute Logic score (0–40), after pairwise-floor clamping.
   * Kept separate from logicalCoherence, which is the synth binary pressure
   * signal (14 loss / 22 draw / 30 win). logicQuality is the continuous
   * per-turn measurement for display and future pressure weighting.
   * Undefined for opening turns and fallback rounds.
   */
  logicQuality?: number;
}

export interface TacticAnalysis {
  tactic: string;
  effectiveness: number; // 0-100
  confidence: number; // 0-100
  context: string; // When/why this was used
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
  momentumShift: number; // -100 to +100
  frameControlShift: number; // -100 to +100
  exposedWeaknesses: string[];
  tacticalInsights: string[];

  // Judge-specific data
  judgeId: string;
  judgeSpecialization: JudgeSpecialization;
  reasoning: string;

  /** Full rubric audit trail — populated when the LLM returns structured breakdown fields. */
  breakdown?: TurnScoreBreakdown;
}

// ── Pairwise comparison types ─────────────────────────────────────────────────

export interface PairwiseTurnRef {
  turnNumber: number;
  agentId: string;
  agentName: string;
  message: string;
}

/** Result of comparing two consecutive debate turns head-to-head. */
export interface PairwiseRound {
  roundNumber: number;
  prevTurn: PairwiseTurnRef;
  curTurn: PairwiseTurnRef;
  /** agentId of the winner on each dimension */
  logicWinner: string;
  tacticsWinner: string;
  rhetoricWinner: string;
  /**
   * The original pairwise winner before any score-equality reconciliation.
   * Preserved so that when a retroactive penalty later makes previously-equal
   * scores diverge, re-reconciliation can restore the pairwise judgment rather
   * than leaving the dimension permanently stuck at "tie".
   * Set once on first reconciliation; never mutated thereafter.
   */
  logicWinnerRaw?: string;
  tacticsWinnerRaw?: string;
  rhetoricWinnerRaw?: string;
  /** 2-3 sentence justifications */
  logicDelta: string;
  tacticsDelta: string;
  rhetoricDelta: string;
  /** 1-2 sentences on mechanism quality covering both turns — cause→process→measurable consequence. */
  mechanismDelta?: string;
  /** agentNames that had a mechanism failure in this round (missing one or more chain elements). */
  mechanismFailures?: string[];
  /**
   * Concrete factual/empirical assertions the judge considered penalizing for hollow specificity
   * (whether or not a point was docked), attributed as "AgentName: claim text".
   * Empty array or undefined means no such claims appeared.
   */
  suspectClaims?: string[];
  /**
   * Subset of suspectClaims that are demonstrably false — historically inverted, causally backwards,
   * or citing a study whose conclusion is the reverse of what is claimed.
   * These receive a mandatory -2 retroactive penalty instead of -1 for unverified claims.
   * Attributed as "AgentName: claim text"; must also appear in suspectClaims.
   */
  fabricatedClaims?: string[];
  /**
   * 1-sentence non-scoring note on epistemic responsibility: did either agent make confident
   * empirical claims without acknowledging evidentiary limits? undefined/null if both performed normally.
   */
  epistemicNote?: string;
  /** Set when a turn contains a qualifying counterfactual ("no-X world" with full causal chain). */
  counterfactualDetected?: { agentId: string; summary: string };
  languageWarning?: string;
  /**
   * Harmonization flags raised for this round: dimensions where the pairwise winner
   * assignment diverged from absolute per-turn scores (including ties set to "tie").
   * Populated after reconcileRoundWinners + computeHarmonizationFlags run.
   */
  harmonizationFlags?: HarmonizationFlag[];
  /**
   * Flag IDs the judge explicitly marked as resolved in this round.
   * A flag is resolved when the current turn adequately addressed the hollow claim.
   */
  resolvedFlags?: string[];
  /**
   * Retroactive score corrections the judge issued for the previous turn (prevTurn).
   * Each entry adjusts the logic score on the originating turn, not the current one.
   */
  flagUpdates?: FlagUpdate[];
  isFallback: boolean;
}

// ── Open flag register types ──────────────────────────────────────────────────

/**
 * An unresolved hollow claim that the pairwise judge seeded from suspectClaims.
 * Persists in the register until the agent substantiates it or the debate ends.
 */
export interface OpenFlag {
  flagId: string; // e.g. "FLAG-T5-minimax"
  agentId: string;
  agentName: string;
  originTurn: number;
  claim: string; // the hollow claim text
  status: "unresolved" | "penalized" | "resolved";
  /**
   * "fabricated" = demonstrably false (historically inverted, causally backwards, inverted study conclusion).
   * "unverified" = hollow specificity without mechanism — claim may be true but is ungrounded.
   * Fabricated claims receive a mandatory -2 retroactive penalty; unverified claims receive -1.
   */
  claimType?: "unverified" | "fabricated";
}

export type ClaimFlagRegister = OpenFlag[];

/**
 * A retroactive score correction: applied to the originating turn's absolute
 * logicalCoherence score, not to the current turn being evaluated.
 */
export interface FlagUpdate {
  flagId: string;
  targetTurn: number;
  agentId: string;
  dimension: "logicalCoherence";
  /** Raw 1-10 units. Multiply by 4 to get the 0-40 scale delta. Negative = penalty, positive = partial restore. */
  deltaRaw: number;
  reason: string;
  updateType: "penalty" | "partial_restore";
}

// ── Rubric transparency types ─────────────────────────────────────────────────

/** A single step in the rubric scoring process, for audit trail display. */
export interface ScoreStep {
  /** Human-readable rule name, e.g. "base", "Hollow specificity: 'studies in Finland'", "Complete causal chain" */
  rule: string;
  /** Point delta on the 1–10 scale, e.g. 6 (base), +1 (bonus), -1 (deduction) */
  delta: number;
}

/**
 * Four-component rhetoric breakdown, mirroring the 4-component SCORING METHOD
 * in the judge system prompt. rhetoric_score = 5 + aboveCount − belowCount.
 */
export interface RhetoricalComponents {
  expression: "above" | "average" | "below"; // Component 1: expression quality
  structure: "above" | "average" | "below"; // Component 2: structural clarity
  audience: "above" | "average" | "below"; // Component 3: audience awareness
  framing: "above" | "average" | "below"; // Component 4: framing quality
}

/**
 * Full rubric audit trail for one turn's absolute score.
 * Lets users inspect exactly why a turn received, say, 28/40 on Logic.
 * Populated by parseJudgeAnalysis from structured fields the LLM returns alongside scores.
 */
export interface TurnScoreBreakdown {
  // Logic audit trail
  logicSteps: ScoreStep[]; // e.g. [{rule:"base",delta:6},{rule:"Hollow specificity: 'X'",delta:-1}]
  logicRaw: number; // 1–10 LLM score before ×4 mapping

  // Rhetoric audit trail
  rhetoricalComponents: RhetoricalComponents;
  rhetoricalAboveCount: number; // A in formula: 5 + A − B
  rhetoricalBelowCount: number; // B in formula: 5 + A − B
  rhetoricalRaw: number; // 1–10 LLM score before ×3

  // Tactics audit trail
  tacticsNote: string; // one-sentence reason for the tactics score
  tacticsRaw: number; // 1–10 LLM score before ×3

  // Pairwise floor adjustment (populated in core.ts after floor enforcement)
  pairwiseFloorApplied?: boolean;
  pairwiseFloorNote?: string; // e.g. "Logic floored to WIN band [24–40]: 16 → 24"

  // Post-penalty gap re-enforcement (populated in core.ts after evidence gating + artifact cap)
  postPenaltyGapNote?: string; // e.g. "Post-penalty gap re-enforced — Logic: 34→38"

  // Evidence gating (populated in analyzeTurn before prompt construction)
  evidenceDetected?: boolean;
  evidenceCitations?: string[]; // citation strings found in the turn text
  evidenceGatingNote?: string; // note shown in the audit panel

  // Evidence enforcement (code-level; populated in core.ts post-scoring)
  empiricalClaimsWithoutCitations?: boolean; // true when empirical patterns present but no citations
  empiricalClaimsList?: string[]; // matched empirical-claim phrases (for audit)
  evidenceEnforcementNote?: string; // describes the Logic penalty applied

  // Artifact remediation (populated in analyzeTurn before prompt construction)
  artifactRepairApplied?: boolean;
  artifactRepairNote?: string; // what was repaired and how
  artifactSeverity?: "none" | "minor" | "moderate" | "severe"; // severity of detected artifacts

  // Rhetoric cap (populated in core.ts when severe artifacts prevent reliable assessment)
  rhetoricalScoreCapped?: boolean;
  rhetoricalCapNote?: string; // reason for the cap
}

/** Running win tally for one agent across all pairwise rounds. */
export interface AgentWinTally {
  agentName: string;
  logic: number;
  tactics: number;
  rhetoric: number;
  total: number;
}

/** Accumulated scorecard for the full debate. */
export interface DebateScorecard {
  rounds: PairwiseRound[];
  winTallies: { [agentId: string]: AgentWinTally };
  overallWinner: string | null; // agentId, or null if draw
  /** Tracks which agents have submitted at least one qualifying counterfactual. */
  counterfactualTrack?: { [agentId: string]: boolean };
}

/**
 * Flagged when a per-round pairwise winner assignment diverges significantly from
 * the absolute per-turn scores for the same dimension. Computed synchronously — no LLM call.
 */
export interface HarmonizationFlag {
  roundNumber: number;
  dimension: "logic" | "tactics" | "rhetoric" | "overall";
  /** agentId that won the dimension according to pairwise comparison. */
  pairwiseWinner: string;
  /** agentId that had the higher absolute score on that dimension. */
  absoluteScoreLeader: string;
  /** Raw score gap on the dimension's native scale (logic: 0-40, tactics/rhetoric: 0-30, overall: 0-100). */
  divergenceMagnitude: number;
  note: string;
}

/**
 * Positional convergence analysis: detects when both debaters have converged
 * toward similar positions by late turns, collapsing the ostensible opposition
 * into a definitional or degree dispute. Only computed for debates ≥ 10 turns.
 */
export interface PositionalConvergenceAnalysis {
  detected: boolean;
  /** Turn range where convergence first became apparent, e.g. "Turns 5-6". Null when not detected. */
  convergenceTurnRange: string | null;
  /** The debater A position as expressed in the early turns (T1-T2). */
  coreClaimAgentA_early: string;
  /** The debater A position as expressed in the late turns (T(n-1)-Tn). */
  coreClaimAgentA_late: string;
  /** The debater B position as expressed in the early turns (T1-T2). */
  coreClaimAgentB_early: string;
  /** The debater B position as expressed in the late turns (T(n-1)-Tn). */
  coreClaimAgentB_late: string;
  /** Plain-language description of what the debaters still genuinely disagree about, if anything. */
  positionalGapDescription: string;
  remainingDisagreementType: "substantive" | "definitional" | "degree" | "none";
  motionViability: "viable" | "degenerate_convergence" | "inconclusive";
}

/** Full-debate narrative verdict written after all pairwise rounds. */
export interface NarrativeVerdict {
  text: string;
  favouredAgentId: string | null;
  agreesWithScorecard: boolean;
  /**
   * Whether the win-count leader and the cumulative-points leader are the same agent.
   * False means the two ways of reading the scorecard disagree — diagnostic of a
   * "won exchanges but lost arc" pattern. Populated whenever a single leader can be
   * identified in both dimensions (i.e., no tie in either round-count or points totals);
   * `undefined` only when there is a tie in one or both dimensions.
   * Independent of `agreesWithScorecard` — the split can exist even when the narrative
   * agrees with the round-count winner.
   */
  scorecardInternallyConsistent?: boolean;
  /** Exactly 3 sentence adjudication explaining why scorecard and narrative diverged, populated only when agreesWithScorecard is false. */
  conflictResolution?: string;
  /** Exactly 3 sentence meta-judge report on whether scoring standards were applied consistently across rounds; flags rubric drift if detected. */
  rubricConsistency?: string;
  /** Positional convergence analysis. Only present for debates ≥ 10 turns. */
  convergence?: PositionalConvergenceAnalysis;
  /**
   * Score corrections applied by the end-of-debate Logic gap enforcement pass.
   * Each entry is a downward adjustment to a loser turn's logicalCoherence.
   * Emitted as scoreUpdate SSE events so the client UI and exports stay in sync.
   */
  gapAdjustments?: Array<{
    targetTurn: number;
    agentId: string;
    deltaLogic: number;
    roundNumber: number;
  }>;
}

// ── Existing types kept for adaptive pressure system ─────────────────────────

export interface JudgeBias {
  preferenceComplexity: number; // -1 to 1 (prefers simple to complex)
  preferenceEmotion: number; // -1 to 1 (prefers detached to passionate)
  preferenceAggression: number; // -1 to 1 (prefers cautious to aggressive)
  preferenceEvidence: number; // -1 to 1 (prefers intuitive to data-driven)
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

export type JudgeSpecialization = "logic" | "rhetoric" | "strategy" | "balance";

export interface AgentScores {
  agentId: string;
  agentName: string;
  totalScore: number;
  turnScores: JudgeScores[];
  momentumScore: number;
  frameControlScore: number;
  tacticalEffectiveness: number;
  lastTurnAnalysis: TurnAnalysis | null;
  // Pairwise win tallies
  logicWins: number;
  tacticsWins: number;
  rhetoricWins: number;
}

export interface MomentumTracker {
  currentMomentum: { [agentId: string]: number };
  momentumHistory: { [turnNumber: number]: { [agentId: string]: number } };
  lastMomentumShift: { [agentId: string]: number };
  momentumTrend: { [agentId: string]: "rising" | "falling" | "stable" };
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
  cognitivePressure: number; // 0-100 (affects analytical traits)
  emotionalPressure: number; // 0-100 (affects emotional traits)
  strategicPressure: number; // 0-100 (affects risk/aggression traits)
  credibilityPressure: number; // 0-100 (affects evidence/personal traits)

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
  intensity: number; // Overall pressure strength 0-100
  decayRate: number; // How quickly pressure fades 0-1
  duration: number; // How long pressure lasts (turns)
}

export interface LiveJudgePanel {
  judges: LiveJudge[];
  currentScores: { [agentId: string]: AgentScores };
  momentumTracker: MomentumTracker;
  frameControlTracker: FrameControlTracker;
  turnCount: number;
  isActive: boolean;
  scorecard: DebateScorecard;
  /** The most recently completed turn, stored so the next processTurn can run pairwise. */
  previousTurn: PairwiseTurnRef | null;
  /** Most recent per-turn absolute scores per agent, used for harmonization checks. */
  lastAbsoluteScores: { [agentId: string]: JudgeScores };
  /**
   * Per-turn absolute scores indexed by turn number (not overwritten).
   * Used for retroactive re-reconciliation: when a claim penalty changes a turn's
   * absolute score, we re-evaluate the pairwise round winners for that turn with
   * the corrected score rather than leaving the scorecard in a stale state.
   */
  absoluteScoreHistory: { [turnNumber: number]: JudgeScores };
  /** Running register of open (unresolved / partially-penalized) hollow claims. */
  claimFlagRegister: ClaimFlagRegister;
  /** Per-turn retroactive score adjustments accumulated across all rounds. */
  retroactiveDeltas: { [turnNumber: number]: Partial<JudgeScores> };
  /**
   * Turn number where mid-debate convergence was first detected (heuristic).
   * Set once; never reset. The next processTurn call after this is set will
   * emit a convergenceWarning in JudgeAnalysisResult.
   */
  convergenceDetectedTurn?: number;
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
  /** Pairwise round result if this was not the opening turn. */
  pairwiseRound?: PairwiseRound;
  /** Running scorecard after this turn pair. */
  scorecard?: DebateScorecard;
  /** Raw per-turn absolute scores from analyzeTurn().
   *  Best-effort: intended to be populated for every analyzed turn, but may be undefined
   *  if per-turn analysis fails or is skipped. Consumers must handle the undefined case.
   *  Subscales (logicalCoherence / rhetoricalForce / tacticalEffectiveness) come from a
   *  1–10 model scale mapped to 4–40 / 3–30 / 3–30, making them comparable across debates.
   *  frameControl and credibilityScore are on the same 0–100 scale as JudgeScores, and
   *  overallScore is the corresponding weighted composite of these absolute per-turn scores.
   *  rhetoricalForce and tacticalEffectiveness from absoluteScores are merged into
   *  aggregatedScores (replacing the binary floor/ceiling from synthScoresFromPairwise)
   *  so they do feed the display and pressure pipeline for those two dimensions. */
  absoluteScores?: JudgeScores;
  /** Rounds where pairwise winner assignment diverged significantly from absolute per-turn scores. */
  harmonizationFlags?: HarmonizationFlag[];
  /**
   * Retroactive score adjustments that should be applied to previously-emitted turn results.
   * Keyed by turn number; values are partial JudgeScores deltas (not absolute values).
   */
  retroactiveDeltas?: { [turnNumber: number]: Partial<JudgeScores> };
  /**
   * Set when mid-debate convergence is suspected: both debaters appear to have
   * converged toward the same position, collapsing the motion into a definitional
   * dispute. Consumers should surface this message prominently and may use it to
   * signal the debate should re-anchor or conclude.
   */
  convergenceWarning?: string;
  /**
   * Full rubric audit trail for the current turn's absolute score.
   * Mirrors absoluteScores but with per-step breakdowns and pre-scoring metadata
   * (evidence gating, artifact repair) so users can audit every scoring decision.
   */
  scoreBreakdown?: TurnScoreBreakdown;
  /**
   * Retroactive Logic gap adjustment for prevTurn.  Set when curTurn wins Logic
   * but prevTurn's logicalCoherence was pulled down to open a MIN_LOGIC_WIN_GAP.
   * deltaLogic is negative (the amount subtracted).  Consumers should emit a
   * scoreUpdate SSE so the client display reflects the retroactive change.
   */
  logicGapAdjustment?: {
    targetTurn: number;
    targetAgentId: string;
    deltaLogic: number;
    roundNumber: number;
  };
}

// Judge specialization configurations
export const JUDGE_SPECIALIZATION_CONFIGS: Record<
  JudgeSpecialization,
  {
    name: string;
    scoringWeights: ScoringWeights;
    typicalBias: JudgeBias;
    description: string;
  }
> = {
  logic: {
    name: "Logic Judge",
    scoringWeights: {
      logicalCoherence: 0.4,
      rhetoricalForce: 0.2,
      frameControl: 0.15,
      credibilityScore: 0.1,
      tacticalEffectiveness: 0.15,
    },
    typicalBias: {
      preferenceComplexity: 0.3,
      preferenceEmotion: -0.2,
      preferenceAggression: -0.1,
      preferenceEvidence: 0.4,
    },
    description: "Values rigorous reasoning and logical consistency above all",
  },
  rhetoric: {
    name: "Rhetoric Judge",
    scoringWeights: {
      logicalCoherence: 0.15,
      rhetoricalForce: 0.4,
      frameControl: 0.25,
      credibilityScore: 0.15,
      tacticalEffectiveness: 0.05,
    },
    typicalBias: {
      preferenceComplexity: -0.2,
      preferenceEmotion: 0.4,
      preferenceAggression: 0.2,
      preferenceEvidence: -0.1,
    },
    description: "Focuses on persuasive power and emotional resonance",
  },
  strategy: {
    name: "Strategy Judge",
    scoringWeights: {
      logicalCoherence: 0.2,
      rhetoricalForce: 0.15,
      frameControl: 0.2,
      credibilityScore: 0.1,
      tacticalEffectiveness: 0.35,
    },
    typicalBias: {
      preferenceComplexity: 0.1,
      preferenceEmotion: 0.0,
      preferenceAggression: 0.3,
      preferenceEvidence: 0.2,
    },
    description: "Evaluates tactical brilliance and strategic effectiveness",
  },
  balance: {
    name: "Balance Judge",
    scoringWeights: {
      logicalCoherence: 0.2,
      rhetoricalForce: 0.2,
      frameControl: 0.2,
      credibilityScore: 0.2,
      tacticalEffectiveness: 0.2,
    },
    typicalBias: {
      preferenceComplexity: 0.0,
      preferenceEmotion: 0.0,
      preferenceAggression: 0.0,
      preferenceEvidence: 0.0,
    },
    description: "Provides balanced assessment across all debate aspects",
  },
};

// Tactic types for analysis
export const DEBATE_TACTICS = [
  "logical_refutation",
  "evidence_citation",
  "emotional_appeal",
  "frame_redefinition",
  "questioning",
  "contradiction",
  "ridicule",
  "authority_appeal",
  "analogy",
  "redirection",
  "concession",
  "escalation",
  "de_escalation",
  "personal_attack",
  "strategic_silence",
] as const;

export type DebateTactic = (typeof DEBATE_TACTICS)[number];
