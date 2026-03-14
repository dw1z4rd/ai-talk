import {
  type LiveJudge,
  type LiveJudgePanel,
  type JudgeAnalysisResult,
  type JudgeSpecialization,
  type JudgeScores,
  type AgentScores,
  type MomentumTracker,
  type FrameControlTracker,
  type PairwiseRound,
  type DebateScorecard,
  type NarrativeVerdict,
  JUDGE_SPECIALIZATION_CONFIGS
} from './types';
import type { Agent, Message } from '$lib/agents';
import {
  analyzeTurn,
  calculateMomentumShift,
  calculateFrameControlShift,
  createFallbackAnalysis,
  compareTurns,
  updateScorecard,
  synthScoresFromPairwise,
  generateNarrativeVerdictText,
} from './analysis';
import { generateAdaptivePressure } from './pressure';
import { MODEL_CATALOG } from '$lib/agents';

// ── Judge model rotation ──────────────────────────────────────────────────────

/**
 * Models available as judges. Using a different model than the debaters prevents
 * systematic bias. Rotate across runs for consistency testing.
 */
const JUDGE_MODEL_POOL = [
  'kimi-k2:1t-cloud',
  'deepseek-v3.1:671b-cloud',
  'gpt-oss:120b-cloud',
  'qwen3-vl:235b-cloud',
  'deepseek-v3.2-cloud',
];

let judgeRotationIndex = 0;

/**
 * Pick a judge model that is NOT one of the debaters, rotating across runs.
 */
export function selectJudgeModel(excludeModelIds: string[]): string {
  const pool = JUDGE_MODEL_POOL.filter(m => !excludeModelIds.includes(m) && MODEL_CATALOG[m]);
  if (pool.length === 0) {
    // All pool models are debaters — fallback to first available
    const fallback = JUDGE_MODEL_POOL.find(m => MODEL_CATALOG[m]) || 'gpt-oss:120b-cloud';
    console.warn(`[Judge] All preferred judge models are debaters. Using ${fallback} as fallback.`);
    return fallback;
  }
  const selected = pool[judgeRotationIndex % pool.length];
  judgeRotationIndex++;
  console.log(`[Judge] Selected judge model: ${selected} (rotation index ${judgeRotationIndex - 1})`);
  return selected;
}

// ── LiveJudgeSystem ───────────────────────────────────────────────────────────

export class LiveJudgeSystem {
  private panel: LiveJudgePanel;

  constructor(judgeModelId: string = 'gpt-oss:120b-cloud') {
    this.panel = this.initializeJudgePanel(judgeModelId);
  }

  private initializeJudgePanel(judgeModelId: string): LiveJudgePanel {
    // Single judge handles both adaptive analysis and pairwise comparison.
    // Specialization 'balance' gives equal weight to all dimensions.
    const specialization: JudgeSpecialization = 'balance';
    const config = JUDGE_SPECIALIZATION_CONFIGS[specialization];
    const judge: LiveJudge = {
      id: 'judge-pairwise',
      name: 'Comparative Judge',
      modelId: judgeModelId,
      specialization,
      scoringWeights: config.scoringWeights,
      biasProfile: config.typicalBias,
      lastAnalysis: null,
      analysisCount: 0
    };

    return {
      judges: [judge],
      currentScores: {},
      momentumTracker: {
        currentMomentum: {},
        momentumHistory: {},
        lastMomentumShift: {},
        momentumTrend: {}
      },
      frameControlTracker: {
        currentControl: {},
        controlHistory: {},
        lastControlShift: {},
        dominantFrame: null
      },
      turnCount: 0,
      isActive: true,
      scorecard: { rounds: [], winTallies: {}, overallWinner: null },
      previousTurn: null
    };
  }

  /**
   * Process a single turn: run pairwise comparison (if not the opening turn),
   * derive adaptive pressure from the result, and update panel state.
   */
  async processTurn(
    agent: Agent,
    message: string,
    opponent: Agent,
    opponentMessage: string,
    turnNumber: number,
    topic: string = '',
    referenceContext: string = '',
    messageHistory: Message[] = []
  ): Promise<JudgeAnalysisResult> {
    this.panel.turnCount = turnNumber;
    const judge = this.panel.judges[0];
    const isOpeningTurn = !opponentMessage.trim();
    const PER_JUDGE_TIMEOUT_MS = 45_000;

    let pairwiseRound: PairwiseRound | undefined;
    let aggregatedScores: JudgeScores;
    let judgeAnalyses: any[] = [];

    if (isOpeningTurn) {
      // Turn 1: no opponent to compare against — store this turn and use neutral scores
      this.panel.previousTurn = {
        turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        message
      };
      aggregatedScores = { logicalCoherence: 50, rhetoricalForce: 50, frameControl: 50, credibilityScore: 50, tacticalEffectiveness: 50, overallScore: 50 };

      // Still run a lightweight adaptive judge on the opening turn so the
      // debater can get feedback on their framing quality for Turn 3.
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_JUDGE_TIMEOUT_MS);
        const openingAnalysis = await analyzeTurn(
          judge, agent, message, opponent, '', turnNumber, topic, referenceContext, messageHistory, controller.signal
        ).finally(() => clearTimeout(timer));
        judge.lastAnalysis = openingAnalysis;
        judge.analysisCount++;
        judgeAnalyses = [openingAnalysis];
        aggregatedScores = openingAnalysis.scores;
      } catch {
        // Opening analysis failed — leave neutral scores
      }
    } else {
      // Turn 2+: run pairwise comparison against the previous turn.
      const prev = this.panel.previousTurn;
      const prevAgentId = prev?.agentId || opponent.id;
      const prevAgentName = prev?.agentName || opponent.name;
      const prevMessage = prev?.message || opponentMessage;
      const prevTurnNumber = prev?.turnNumber || (turnNumber - 1);
      const roundNumber = turnNumber - 1;

      // Store current turn as the new "previous" before the async call
      this.panel.previousTurn = {
        turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        message
      };

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          console.warn(`[Pairwise Judge] Round ${roundNumber} timed out after ${PER_JUDGE_TIMEOUT_MS}ms`);
          controller.abort();
        }, PER_JUDGE_TIMEOUT_MS);

        pairwiseRound = await compareTurns(
          judge,
          prevAgentId, prevAgentName, prevMessage, prevTurnNumber,
          agent.id, agent.name, message, turnNumber,
          topic, roundNumber, controller.signal
        ).finally(() => clearTimeout(timer));

        judge.analysisCount++;

        // Update the scorecard using agent IDs/names from the pairwise round itself
        this.panel.scorecard = updateScorecard(
          this.panel.scorecard,
          pairwiseRound,
          pairwiseRound.prevTurn.agentId, pairwiseRound.prevTurn.agentName,
          pairwiseRound.curTurn.agentId, pairwiseRound.curTurn.agentName
        );

        // Derive synthetic adaptive scores from pairwise result
        aggregatedScores = synthScoresFromPairwise(pairwiseRound, agent.id);

        // Also create a synthetic TurnAnalysis for pressure.ts compatibility
        judgeAnalyses = [this.synthTurnAnalysis(judge, agent, opponent, message, opponentMessage, turnNumber, aggregatedScores, pairwiseRound.logicDelta)];
      } catch (error) {
        console.error('[Pairwise Judge] compareTurns threw:', error);
        aggregatedScores = { logicalCoherence: 50, rhetoricalForce: 50, frameControl: 50, credibilityScore: 50, tacticalEffectiveness: 50, overallScore: 50 };
        judgeAnalyses = [createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, referenceContext)];
      }
    }

    // Calculate momentum and frame control from adaptive scores
    const momentumShift = calculateMomentumShift(aggregatedScores, this.panel.momentumTracker, agent.id);
    const frameControlShift = calculateFrameControlShift(aggregatedScores, this.panel.frameControlTracker, agent.id);

    // Generate adaptive pressures
    const adaptivePressures = judgeAnalyses.map(analysis =>
      generateAdaptivePressure(analysis, momentumShift, frameControlShift)
    );

    // Update panel state
    this.updatePanelState(agent, aggregatedScores, momentumShift, frameControlShift, judgeAnalyses);

    return {
      turnNumber,
      agentId: agent.id,
      agentScores: aggregatedScores,
      aggregatedScores,
      momentumShift,
      frameControlShift,
      adaptivePressures,
      judgeAnalyses,
      newMomentumState: this.panel.momentumTracker,
      newFrameControlState: this.panel.frameControlTracker,
      pairwiseRound,
      scorecard: pairwiseRound ? { ...this.panel.scorecard } : undefined
    };
  }

  /**
   * Create a TurnAnalysis-compatible object from pairwise scores for pressure.ts.
   */
  private synthTurnAnalysis(
    judge: LiveJudge, agent: Agent, opponent: Agent,
    message: string, opponentMessage: string, turnNumber: number,
    scores: JudgeScores, reasoning: string
  ): any {
    return {
      turnNumber, agentId: agent.id, agentName: agent.name,
      opponentId: opponent.id, opponentName: opponent.name,
      message, opponentMessage, context: '',
      scores,
      usedTactics: [], effectivenessMap: {},
      momentumShift: 0, frameControlShift: 0,
      exposedWeaknesses: [], tacticalInsights: [],
      judgeId: judge.id, judgeSpecialization: judge.specialization,
      reasoning
    };
  }

  /**
   * Generate the full-debate narrative verdict. Call this after all turns complete.
   */
  async generateNarrativeVerdict(
    fullTranscript: Message[],
    topic: string,
    agentA: Agent,
    agentB: Agent
  ): Promise<NarrativeVerdict | null> {
    if (this.panel.scorecard.rounds.length === 0) return null;

    const judge = this.panel.judges[0];
    const VERDICT_TIMEOUT_MS = 60_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn('[Narrative Judge] Verdict timed out');
        controller.abort();
      }, VERDICT_TIMEOUT_MS);

      return await generateNarrativeVerdictText(
        judge,
        fullTranscript,
        agentA.id, agentA.name,
        agentB.id, agentB.name,
        topic,
        this.panel.scorecard,
        controller.signal
      ).finally(() => clearTimeout(timer));
    } catch (error) {
      console.error('[Narrative Judge] generateNarrativeVerdict threw:', error);
      return null;
    }
  }

  /** Get the current debate scorecard. */
  getScorecard(): DebateScorecard {
    return { ...this.panel.scorecard };
  }

  private updatePanelState(
    agent: Agent,
    scores: JudgeScores,
    momentumShift: number,
    frameControlShift: number,
    judgeAnalyses: any[]
  ): void {
    if (!this.panel.currentScores[agent.id]) {
      this.panel.currentScores[agent.id] = {
        agentId: agent.id,
        agentName: agent.name,
        totalScore: scores.overallScore,
        turnScores: [scores],
        momentumScore: momentumShift,
        frameControlScore: frameControlShift,
        tacticalEffectiveness: scores.tacticalEffectiveness,
        lastTurnAnalysis: judgeAnalyses[0] || null,
        logicWins: 0,
        tacticsWins: 0,
        rhetoricWins: 0
      };
    } else {
      const agentScore = this.panel.currentScores[agent.id];
      agentScore.totalScore += scores.overallScore;
      agentScore.turnScores.push(scores);
      agentScore.momentumScore += momentumShift;
      agentScore.frameControlScore += frameControlShift;
      agentScore.tacticalEffectiveness = (agentScore.tacticalEffectiveness + scores.tacticalEffectiveness) / 2;
      agentScore.lastTurnAnalysis = judgeAnalyses[0] || null;
    }

    // Sync pairwise win tallies into AgentScores
    const tally = this.panel.scorecard.winTallies[agent.id];
    if (tally) {
      this.panel.currentScores[agent.id].logicWins = tally.logic;
      this.panel.currentScores[agent.id].tacticsWins = tally.tactics;
      this.panel.currentScores[agent.id].rhetoricWins = tally.rhetoric;
    }

    // Update momentum tracker
    const currentMomentum = this.panel.momentumTracker.currentMomentum[agent.id] || 0;
    this.panel.momentumTracker.currentMomentum[agent.id] = currentMomentum + momentumShift;
    this.panel.momentumTracker.lastMomentumShift[agent.id] = momentumShift;
    this.panel.momentumTracker.momentumHistory[this.panel.turnCount] = {
      ...this.panel.momentumTracker.momentumHistory[this.panel.turnCount],
      [agent.id]: currentMomentum + momentumShift
    };

    if (momentumShift > 5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'rising';
    } else if (momentumShift < -5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'falling';
    } else {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'stable';
    }

    const currentControl = this.panel.frameControlTracker.currentControl[agent.id] || 0;
    this.panel.frameControlTracker.currentControl[agent.id] = currentControl + frameControlShift;
    this.panel.frameControlTracker.lastControlShift[agent.id] = frameControlShift;
    this.panel.frameControlTracker.controlHistory[this.panel.turnCount] = {
      ...this.panel.frameControlTracker.controlHistory[this.panel.turnCount],
      [agent.id]: currentControl + frameControlShift
    };

    const allControls = this.panel.frameControlTracker.currentControl;
    const entries = Object.entries(allControls);
    if (entries.length > 0) {
      const dominantAgent = entries.reduce((a, b) => allControls[a[0]] > allControls[b[0]] ? a : b);
      this.panel.frameControlTracker.dominantFrame = dominantAgent[0];
    }
  }

  getCurrentLeader(): { agentId: string; agentName: string; score: number } | null {
    const scores = Object.entries(this.panel.currentScores);
    if (scores.length === 0) return null;
    const leader = scores.reduce((a, b) => a[1].totalScore > b[1].totalScore ? a : b);
    return { agentId: leader[0], agentName: leader[1].agentName, score: leader[1].totalScore };
  }

  getScoreDifferential(): { leader: string; differential: number } | null {
    const scores = Object.values(this.panel.currentScores);
    if (scores.length < 2) return null;
    scores.sort((a, b) => b.totalScore - a.totalScore);
    return { leader: scores[0].agentName, differential: scores[0].totalScore - scores[1].totalScore };
  }

  getMomentumLeader(): { agentId: string; momentum: number; trend: string } | null {
    const momentum = Object.entries(this.panel.momentumTracker.currentMomentum);
    if (momentum.length === 0) return null;
    const leader = momentum.reduce((a, b) => a[1] > b[1] ? a : b);
    return { agentId: leader[0], momentum: leader[1], trend: this.panel.momentumTracker.momentumTrend[leader[0]] || 'stable' };
  }

  getFrameControlLeader(): { agentId: string; control: number } | null {
    const control = Object.entries(this.panel.frameControlTracker.currentControl);
    if (control.length === 0) return null;
    const leader = control.reduce((a, b) => a[1] > b[1] ? a : b);
    return { agentId: leader[0], control: leader[1] };
  }

  reset(debaterModelIds?: string[]): void {
    // Pick a new judge model if debater IDs provided
    const newJudgeModelId = debaterModelIds
      ? selectJudgeModel(debaterModelIds)
      : (this.panel.judges[0]?.modelId || 'gpt-oss:120b-cloud');

    this.panel.judges[0].modelId = newJudgeModelId;
    this.panel.judges[0].lastAnalysis = null;
    this.panel.judges[0].analysisCount = 0;

    this.panel.currentScores = {};
    this.panel.momentumTracker = {
      currentMomentum: {}, momentumHistory: {}, lastMomentumShift: {}, momentumTrend: {}
    };
    this.panel.frameControlTracker = {
      currentControl: {}, controlHistory: {}, lastControlShift: {}, dominantFrame: null
    };
    this.panel.turnCount = 0;
    this.panel.scorecard = { rounds: [], winTallies: {}, overallWinner: null };
    this.panel.previousTurn = null;
  }

  getPanelState(): LiveJudgePanel {
    return { ...this.panel };
  }

  getJudge(judgeId: string): LiveJudge | undefined {
    return this.panel.judges.find(j => j.id === judgeId);
  }

  getAllJudges(): LiveJudge[] {
    return [...this.panel.judges];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let liveJudgeSystem: LiveJudgeSystem | null = null;

export function getLiveJudgeSystem(): LiveJudgeSystem {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  return liveJudgeSystem;
}

export function resetLiveJudgeSystem(debaterModelIds?: string[]): void {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  liveJudgeSystem.reset(debaterModelIds);
}
