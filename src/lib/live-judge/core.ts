import { 
  type LiveJudge, 
  type LiveJudgePanel, 
  type JudgeAnalysisResult, 
  type JudgeSpecialization,
  type JudgeScores,
  type AgentScores,
  type MomentumTracker,
  type FrameControlTracker,
  JUDGE_SPECIALIZATION_CONFIGS 
} from './types';
import type { Agent, Message } from '$lib/agents';
import { analyzeTurn, aggregateJudgeScores, calculateMomentumShift, calculateFrameControlShift, createFallbackAnalysis } from './analysis';
import { generateAdaptivePressure } from './pressure';
import { MODEL_CATALOG } from '$lib/agents';

export class LiveJudgeSystem {
  private panel: LiveJudgePanel;

  constructor(judgeModelIds: string[] = ['gpt-oss:120b-cloud']) {
    this.panel = this.initializeJudgePanel(judgeModelIds);
  }

  private initializeJudgePanel(judgeModelIds: string[]): LiveJudgePanel {
    const specializations: JudgeSpecialization[] = ['logic', 'rhetoric', 'strategy'];
    const judges: LiveJudge[] = judgeModelIds.slice(0, 3).map((modelId, index) => {
      const specialization = specializations[index];
      const config = JUDGE_SPECIALIZATION_CONFIGS[specialization];
      const modelDef = MODEL_CATALOG[modelId];
      return {
        id: `judge-${specialization}-${index}`,
        name: config.name,
        modelId,
        specialization,
        scoringWeights: config.scoringWeights,
        biasProfile: config.typicalBias,
        lastAnalysis: null,
        analysisCount: 0
      };
    });

    return {
      judges,
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
      isActive: true
    };
  }

  /**
   * Process a single turn with live judging analysis
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

    const PER_JUDGE_TIMEOUT_MS = 45_000;

    // Run all judge analyses in parallel, each with an AbortController so the
    // underlying fetch is actually cancelled (not just abandoned) on timeout.
    const judgeAnalyses = await Promise.all(
      this.panel.judges.map(judge => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          console.warn(`[Judge] ${judge.name} (${judge.modelId}) timed out after ${PER_JUDGE_TIMEOUT_MS}ms — aborting request`);
          controller.abort();
        }, PER_JUDGE_TIMEOUT_MS);

        return this.analyzeWithJudge(judge, agent, message, opponent, opponentMessage, turnNumber, topic, referenceContext, messageHistory, controller.signal)
          .finally(() => clearTimeout(timer));
      })
    );

    // Aggregate scores across all judges
    const aggregatedScores = aggregateJudgeScores(judgeAnalyses);

    // Calculate momentum and frame control shifts
    const momentumShift = calculateMomentumShift(aggregatedScores, this.panel.momentumTracker, agent.id);
    const frameControlShift = calculateFrameControlShift(aggregatedScores, this.panel.frameControlTracker, agent.id);

    // Generate adaptive pressure from the analysis
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
      newFrameControlState: this.panel.frameControlTracker
    };
  }

  /**
   * Analyze a turn with a specific judge
   */
  private async analyzeWithJudge(
    judge: LiveJudge,
    agent: Agent,
    message: string,
    opponent: Agent,
    opponentMessage: string,
    turnNumber: number,
    topic: string,
    referenceContext: string,
    messageHistory: Message[],
    signal?: AbortSignal
  ): Promise<any> {
    const analysis = await analyzeTurn(
      judge,
      agent,
      message,
      opponent,
      opponentMessage,
      turnNumber,
      topic,
      referenceContext,
      messageHistory,
      signal
    );

    // Update judge state
    judge.lastAnalysis = analysis;
    judge.analysisCount++;

    return analysis;
  }

  /**
   * Update the judge panel state with new analysis results
   */
  private updatePanelState(
    agent: Agent,
    scores: JudgeScores,
    momentumShift: number,
    frameControlShift: number,
    judgeAnalyses: any[]
  ): void {
    // Update or create agent scores
    if (!this.panel.currentScores[agent.id]) {
      this.panel.currentScores[agent.id] = {
        agentId: agent.id,
        agentName: agent.name,
        totalScore: scores.overallScore,
        turnScores: [scores],
        momentumScore: momentumShift,
        frameControlScore: frameControlShift,
        tacticalEffectiveness: scores.tacticalEffectiveness,
        lastTurnAnalysis: judgeAnalyses[0] || null
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

    // Update momentum tracker
    const currentMomentum = this.panel.momentumTracker.currentMomentum[agent.id] || 0;
    this.panel.momentumTracker.currentMomentum[agent.id] = currentMomentum + momentumShift;
    this.panel.momentumTracker.lastMomentumShift[agent.id] = momentumShift;
    this.panel.momentumTracker.momentumHistory[this.panel.turnCount] = {
      ...this.panel.momentumTracker.momentumHistory[this.panel.turnCount],
      [agent.id]: currentMomentum + momentumShift
    };

    // Update momentum trend
    if (momentumShift > 5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'rising';
    } else if (momentumShift < -5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'falling';
    } else {
      this.panel.momentumTracker.momentumTrend[agent.id] = 'stable';
    }

    // Update frame control tracker
    const currentControl = this.panel.frameControlTracker.currentControl[agent.id] || 0;
    this.panel.frameControlTracker.currentControl[agent.id] = currentControl + frameControlShift;
    this.panel.frameControlTracker.lastControlShift[agent.id] = frameControlShift;
    this.panel.frameControlTracker.controlHistory[this.panel.turnCount] = {
      ...this.panel.frameControlTracker.controlHistory[this.panel.turnCount],
      [agent.id]: currentControl + frameControlShift
    };

    // Update dominant frame
    const allControls = this.panel.frameControlTracker.currentControl;
    const dominantAgent = Object.entries(allControls).reduce((a, b) => 
      allControls[a[0]] > allControls[b[0]] ? a : b
    , ['', 0]);
    this.panel.frameControlTracker.dominantFrame = dominantAgent[0];
  }

  /**
   * Get current leader based on total scores
   */
  getCurrentLeader(): { agentId: string; agentName: string; score: number } | null {
    const scores = Object.entries(this.panel.currentScores);
    if (scores.length === 0) return null;

    const leader = scores.reduce((a, b) => 
      a[1].totalScore > b[1].totalScore ? a : b
    );

    return {
      agentId: leader[0],
      agentName: leader[1].agentName,
      score: leader[1].totalScore
    };
  }

  /**
   * Get score differential between agents
   */
  getScoreDifferential(): { leader: string; differential: number } | null {
    const scores = Object.values(this.panel.currentScores);
    if (scores.length < 2) return null;

    scores.sort((a, b) => b.totalScore - a.totalScore);
    const leader = scores[0];
    const runnerUp = scores[1];

    return {
      leader: leader.agentName,
      differential: leader.totalScore - runnerUp.totalScore
    };
  }

  /**
   * Get momentum leader and trend
   */
  getMomentumLeader(): { agentId: string; momentum: number; trend: string } | null {
    const momentum = Object.entries(this.panel.momentumTracker.currentMomentum);
    if (momentum.length === 0) return null;

    const leader = momentum.reduce((a, b) => 
      a[1] > b[1] ? a : b
    );

    return {
      agentId: leader[0],
      momentum: leader[1],
      trend: this.panel.momentumTracker.momentumTrend[leader[0]] || 'stable'
    };
  }

  /**
   * Get frame control leader
   */
  getFrameControlLeader(): { agentId: string; control: number } | null {
    const control = Object.entries(this.panel.frameControlTracker.currentControl);
    if (control.length === 0) return null;

    const leader = control.reduce((a, b) => 
      a[1] > b[1] ? a : b
    );

    return {
      agentId: leader[0],
      control: leader[1]
    };
  }

  /**
   * Reset the judge panel for a new debate
   */
  reset(): void {
    this.panel.currentScores = {};
    this.panel.momentumTracker = {
      currentMomentum: {},
      momentumHistory: {},
      lastMomentumShift: {},
      momentumTrend: {}
    };
    this.panel.frameControlTracker = {
      currentControl: {},
      controlHistory: {},
      lastControlShift: {},
      dominantFrame: null
    };
    this.panel.turnCount = 0;
    
    // Reset judge analysis counts
    this.panel.judges.forEach(judge => {
      judge.lastAnalysis = null;
      judge.analysisCount = 0;
    });
  }

  /**
   * Get current panel state for UI updates
   */
  getPanelState(): LiveJudgePanel {
    return { ...this.panel };
  }

  /**
   * Get specific judge by ID
   */
  getJudge(judgeId: string): LiveJudge | undefined {
    return this.panel.judges.find(judge => judge.id === judgeId);
  }

  /**
   * Get all judges
   */
  getAllJudges(): LiveJudge[] {
    return [...this.panel.judges];
  }
}

// Singleton instance for the application
let liveJudgeSystem: LiveJudgeSystem | null = null;

export function getLiveJudgeSystem(): LiveJudgeSystem {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  return liveJudgeSystem;
}

export function resetLiveJudgeSystem(): void {
  if (liveJudgeSystem) {
    liveJudgeSystem.reset();
  }
}