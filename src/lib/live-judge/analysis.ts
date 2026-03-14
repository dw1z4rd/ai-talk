import { 
  type LiveJudge, 
  type TurnAnalysis, 
  type JudgeScores, 
  type TacticAnalysis,
  type MomentumTracker,
  type FrameControlTracker,
  DEBATE_TACTICS,
  type DebateTactic,
  JUDGE_SPECIALIZATION_CONFIGS
} from './types';
import type { Agent, Message } from '$lib/agents';
import { createOllamaProvider } from '$lib/llm-agent';
import { OLLAMA_CLOUD_URL, OLLAMA_CLOUD_API_KEY } from '$env/static/private';
import { MODEL_CATALOG } from '$lib/agents';

/**
 * Analyze a single turn with a specific judge
 */
export async function analyzeTurn(
  judge: LiveJudge,
  agent: Agent,
  message: string,
  opponent: Agent,
  opponentMessage: string,
  turnNumber: number,
  context: string,
  messageHistory: Message[],
  signal?: AbortSignal
): Promise<TurnAnalysis> {

  const judgePrompt = generateJudgePrompt(
    judge,
    agent,
    message,
    opponent,
    opponentMessage,
    turnNumber,
    context,
    messageHistory
  );

  const judgeProvider = createJudgeProvider(judge.modelId || 'gpt-oss:120b-cloud');

  const start = Date.now();
  try {
    const analysisText = await judgeProvider.generateText(judgePrompt, {
      systemPrompt: generateJudgeSystemPrompt(),
      temperature: 0.3,
      maxTokens: 400,
      signal
    });

    console.log(`[Judge] ${judge.name} (${judge.modelId}) completed in ${Date.now() - start}ms`);
    return parseJudgeAnalysis(analysisText, judge, agent, opponent, turnNumber, message, opponentMessage, context);
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (error?.name === 'AbortError') {
      console.warn(`[Judge] ${judge.name} (${judge.modelId}) aborted after ${elapsed}ms`);
    } else {
      console.error(`[Judge] ${judge.name} (${judge.modelId}) failed after ${elapsed}ms:`, error);
    }
    return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
  }
}

/**
 * Generate judge prompt for turn analysis
 */
function generateJudgePrompt(
  judge: LiveJudge,
  agent: Agent,
  message: string,
  opponent: Agent,
  opponentMessage: string,
  turnNumber: number,
  context: string,
  messageHistory: Message[]
): string {
  return `TOPIC: ${context || 'General debate'}
OPPONENT (${opponent.name}): "${opponentMessage}"
DEBATER BEING SCORED (${agent.name}): "${message}"`;
}

/**
 * Generate judge system prompt
 */
function generateJudgeSystemPrompt(): string {
  return `You are the Live Scoring Matrix for an ongoing debate. You evaluate arguments objectively based on a strict mathematical rubric. You do not have personal biases or a personality.

Scoring Rubric (Total 100 Points):

Logic Score (0-40 Points):
- 40: Flawless causal links, explicitly cites evidence/examples.
- 20: Coherent but relies heavily on hypotheticals or analogies.
- 0: Logical fallacies, contradictions, or failed analogies.

Rhetoric Score (0-30 Points):
- 30: Punchy, highly persuasive, excellent use of framing without academic jargon.
- 15: Persuasive but overly dense or repetitive.
- 0: Boring, dry, or incomprehensible.

Tactics Score (0-30 Points):
- 30: Successfully executes advanced debate tactics (e.g., Concession & Pivot, Interrogation) to put the opponent on the defensive.
- 15: Successfully refutes the opponent but introduces no new tactical pressure.
- 0: Ignores the opponent's previous turn entirely.

You must evaluate the most recent turn and output your evaluation STRICTLY as a valid JSON object. Do not write introductory text, meta-commentary, or markdown blocks. Calculate total_score as the exact sum of the three scores. Keep analysis strictly to 2-3 sentences citing specific point deductions.

Output format:
{"logic_score": <integer 0-40>, "rhetoric_score": <integer 0-30>, "tactics_score": <integer 0-30>, "total_score": <integer 0-100>, "analysis": "<2-3 sentences>"}`;
}

/**
 * Parse judge analysis response
 */
function parseJudgeAnalysis(
  analysisText: string | null,
  judge: LiveJudge,
  agent: Agent,
  opponent: Agent,
  turnNumber: number,
  message: string,
  opponentMessage: string,
  context: string
): TurnAnalysis {
  try {
    if (!analysisText?.trim()) {
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }

    let jsonString = analysisText.trim();
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      console.warn(`[Judge] ${judge.name} no JSON found in response`);
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);

    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch {
      // Attempt bracket repair
      const openBrackets = (jsonString.match(/\[/g) || []).length;
      const closeBrackets = (jsonString.match(/\]/g) || []).length;
      const openBraces = (jsonString.match(/\{/g) || []).length;
      const closeBraces = (jsonString.match(/\}/g) || []).length;
      let fixed = jsonString;
      for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
      for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
      try {
        data = JSON.parse(fixed);
      } catch {
        console.warn(`[Judge] ${judge.name} JSON repair failed`);
        return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
      }
    }

    const logicScore = Math.max(0, Math.min(40, Number(data.logic_score) || 0));
    const rhetoricScore = Math.max(0, Math.min(30, Number(data.rhetoric_score) || 0));
    const tacticsScore = Math.max(0, Math.min(30, Number(data.tactics_score) || 0));
    const totalScore = Math.max(0, Math.min(100, Number(data.total_score) || (logicScore + rhetoricScore + tacticsScore)));
    const analysis = typeof data.analysis === 'string' ? data.analysis : 'No analysis provided';

    // Normalize sub-scores to 0-100 for internal consistency; UI denormalizes for display
    const scores: JudgeScores = {
      logicalCoherence: Math.round(logicScore / 40 * 100),
      rhetoricalForce: Math.round(rhetoricScore / 30 * 100),
      frameControl: totalScore,
      credibilityScore: totalScore,
      tacticalEffectiveness: Math.round(tacticsScore / 30 * 100),
      overallScore: totalScore
    };

    return {
      turnNumber,
      agentId: agent.id,
      agentName: agent.name,
      opponentId: opponent.id,
      opponentName: opponent.name,
      message,
      opponentMessage,
      context,
      scores,
      usedTactics: [],
      effectivenessMap: {},
      momentumShift: 0,
      frameControlShift: 0,
      exposedWeaknesses: [],
      tacticalInsights: [],
      judgeId: judge.id,
      judgeSpecialization: judge.specialization,
      reasoning: analysis
    };
  } catch (error) {
    console.error('[Judge] parseJudgeAnalysis threw:', error);
    return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
  }
}

/**
 * Calculate weighted score based on judge's specialization
 */
function calculateWeightedScore(scores: any, weights: any): number {
  return Math.round(
    scores.logicalCoherence * weights.logicalCoherence +
    scores.rhetoricalForce * weights.rhetoricalForce +
    scores.frameControl * weights.frameControl +
    scores.credibilityScore * weights.credibilityScore +
    scores.tacticalEffectiveness * weights.tacticalEffectiveness
  );
}

/**
 * Create fallback analysis when judge analysis fails
 */
export function createFallbackAnalysis(
  judge: LiveJudge,
  agent: Agent,
  opponent: Agent,
  turnNumber: number,
  message: string,
  opponentMessage: string,
  context: string
): TurnAnalysis {
  // Log more detailed information about the fallback
  console.info(`Creating fallback analysis for judge ${judge.name} (${judge.modelId}) on turn ${turnNumber}`);
  
  const defaultScores: JudgeScores = {
    logicalCoherence: 50,
    rhetoricalForce: 50,
    frameControl: 50,
    credibilityScore: 50,
    tacticalEffectiveness: 50,
    overallScore: 50
  };

  return {
    turnNumber,
    agentId: agent.id,
    agentName: agent.name,
    opponentId: opponent.id,
    opponentName: opponent.name,
    message,
    opponentMessage,
    context,
    scores: defaultScores,
    usedTactics: [
      {
        tactic: "fallback_default",
        effectiveness: 50,
        confidence: 30,
        context: "Default tactic used in fallback analysis"
      }
    ],
    effectivenessMap: {
      "fallback_default": 50
    },
    momentumShift: 0,
    frameControlShift: 0,
    exposedWeaknesses: ["Unable to analyze due to system limitations"],
    tacticalInsights: ["Fallback analysis used due to system error"],
    judgeId: judge.id,
    judgeSpecialization: judge.specialization,
    reasoning: 'Fallback analysis due to judge analysis failure - using default scores'
  };
}

/**
 * Aggregate scores across multiple judges
 */
export function aggregateJudgeScores(judgeAnalyses: TurnAnalysis[]): JudgeScores {
  if (judgeAnalyses.length === 0) {
    return {
      logicalCoherence: 0,
      rhetoricalForce: 0,
      frameControl: 0,
      credibilityScore: 0,
      tacticalEffectiveness: 0,
      overallScore: 0
    };
  }

  const aggregated: JudgeScores = {
    logicalCoherence: 0,
    rhetoricalForce: 0,
    frameControl: 0,
    credibilityScore: 0,
    tacticalEffectiveness: 0,
    overallScore: 0
  };

  // Average all scores
  judgeAnalyses.forEach(analysis => {
    aggregated.logicalCoherence += analysis.scores.logicalCoherence;
    aggregated.rhetoricalForce += analysis.scores.rhetoricalForce;
    aggregated.frameControl += analysis.scores.frameControl;
    aggregated.credibilityScore += analysis.scores.credibilityScore;
    aggregated.tacticalEffectiveness += analysis.scores.tacticalEffectiveness;
    aggregated.overallScore += analysis.scores.overallScore;
  });

  const divisor = judgeAnalyses.length;
  aggregated.logicalCoherence = Math.round(aggregated.logicalCoherence / divisor);
  aggregated.rhetoricalForce = Math.round(aggregated.rhetoricalForce / divisor);
  aggregated.frameControl = Math.round(aggregated.frameControl / divisor);
  aggregated.credibilityScore = Math.round(aggregated.credibilityScore / divisor);
  aggregated.tacticalEffectiveness = Math.round(aggregated.tacticalEffectiveness / divisor);
  aggregated.overallScore = Math.round(aggregated.overallScore / divisor);

  return aggregated;
}

/**
 * Calculate momentum shift based on current scores and historical momentum
 */
export function calculateMomentumShift(
  scores: JudgeScores,
  momentumTracker: MomentumTracker,
  agentId: string
): number {
  // Base momentum from overall score
  const baseMomentum = (scores.overallScore - 50) * 0.4; // Scale from -20 to +20
  
  // Bonus for high tactical effectiveness
  const tacticalBonus = (scores.tacticalEffectiveness - 50) * 0.3;
  
  // Penalty for low credibility
  const credibilityPenalty = (50 - scores.credibilityScore) * 0.2;
  
  // Current momentum inertia (tendency to continue current trend)
  const currentMomentum = momentumTracker.currentMomentum[agentId] || 0;
  const inertiaFactor = currentMomentum * 0.1;
  
  // Combine factors
  const momentumShift = baseMomentum + tacticalBonus - credibilityPenalty + inertiaFactor;
  
  // Clamp to reasonable bounds
  return Math.max(-25, Math.min(25, momentumShift));
}

/**
 * Calculate frame control shift based on argumentative dominance
 */
export function calculateFrameControlShift(
  scores: JudgeScores,
  frameControlTracker: FrameControlTracker,
  agentId: string
): number {
  // Base frame control from logical coherence and rhetorical force
  const baseControl = (scores.logicalCoherence + scores.rhetoricalForce) / 2 - 50;
  
  // Modifier from tactical effectiveness
  const tacticalModifier = (scores.tacticalEffectiveness - 50) * 0.3;
  
  // Current frame control inertia
  const currentControl = frameControlTracker.currentControl[agentId] || 0;
  const inertiaFactor = currentControl * 0.15;
  
  // Combine factors
  const frameShift = (baseControl + tacticalModifier + inertiaFactor) * 0.4;
  
  // Clamp to reasonable bounds
  return Math.max(-20, Math.min(20, frameShift));
}

/**
 * Create judge provider for analysis
 */
function createJudgeProvider(modelId: string) {
  const modelDef = MODEL_CATALOG[modelId];
  if (!modelDef) {
    throw new Error(`Model ${modelId} not found in catalog`);
  }
  return modelDef.makeProvider();
}

/**
 * Extract tactics from text using pattern matching
 */
export function extractTacticsFromText(text: string): TacticAnalysis[] {
  const tactics: TacticAnalysis[] = [];
  
  // Simple pattern matching for common tactics
  const tacticPatterns: { [key: string]: RegExp } = {
    'question': /\b(why|how|what|when|where)\b.*\?/i,
    'contradiction': /\b(no|not|never|wrong|incorrect|false)\b/i,
    'evidence_citation': /\b(according to|research shows|studies indicate|data suggests)\b/i,
    'emotional_appeal': /\b(feel|believe|heart|soul|passion|love|hate)\b/i,
    'ridicule': /\b(ridiculous|absurd|laughable|pathetic)\b/i,
    'authority_appeal': /\b(experts say|authorities believe|studies prove)\b/i,
    'analogy': /\b(like|similar to|just as|analogous to)\b/i,
    'redirection': /\b(let's focus on|moving on|however|but)\b/i
  };
  
  Object.entries(tacticPatterns).forEach(([tactic, pattern]) => {
    if (pattern.test(text)) {
      tactics.push({
        tactic,
        effectiveness: 70, // Default effectiveness
        confidence: 60,   // Default confidence
        context: `Detected ${tactic} pattern in text`
      });
    }
  });
  
  return tactics;
}