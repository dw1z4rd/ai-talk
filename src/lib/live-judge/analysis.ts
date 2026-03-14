import {
  type LiveJudge,
  type TurnAnalysis,
  type JudgeScores,
  type MomentumTracker,
  type FrameControlTracker,
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
  topic: string,
  referenceContext: string,
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
    topic,
    referenceContext,
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
    return parseJudgeAnalysis(analysisText, judge, agent, opponent, turnNumber, message, opponentMessage, referenceContext);
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (error?.name === 'AbortError') {
      console.warn(`[Judge] ${judge.name} (${judge.modelId}) aborted after ${elapsed}ms`);
    } else {
      console.error(`[Judge] ${judge.name} (${judge.modelId}) failed after ${elapsed}ms:`, error);
    }
    return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, referenceContext);
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
  topic: string,
  referenceContext: string,
  messageHistory: Message[]
): string {
  const contextBlock = referenceContext
    ? `\nREFERENCE MATERIAL: ${referenceContext}\n`
    : '';
  return `DEBATE TOPIC: ${topic || 'General debate'}
TURN: ${turnNumber}${contextBlock}
OPPONENT (${opponent.name}) just said: "${opponentMessage}"

NOW EVALUATE — ${agent.name}'s response: "${message}"`;
}

/**
 * Generate judge system prompt
 */
function generateJudgeSystemPrompt(): string {
  return `You are an impartial debate scoring system. You evaluate the substance and effectiveness of arguments — not their surface style. Academic-sounding language does not make an argument more valid. A precise analogy is as rigorous as a formal proof if the structural mapping holds.

ANTI-BIAS RULE: Apply identical standards to both debaters. If an analogy is credited for one side, an equivalently structured analogy from the other must be judged by the same criteria. Do not reward formal register over clear reasoning.

Scoring Rubric (Total 100 Points):

Logic Score (0–40 Points) — evaluate SUBSTANCE, not style:
- 40: Sound premises, valid inference, claims grounded in verifiable facts, accurate analogies, or documented evidence.
- 30: Mostly sound with minor gaps or lightly unsupported assumptions.
- 20: A significant unsupported leap, a speculative claim presented as fact, or an analogy whose mapping partially breaks down.
- 10: A clear logical error — category error (applying in-universe rules to the whole system), circular reasoning, strawman, or an analogy that misrepresents the domain.
- 0: Internally contradictory or entirely fallacious.

EVIDENCE NOTE: "Concrete evidence" means verifiable, observable facts. Theoretical interpretations, contested scientific claims, or philosophical assumptions presented as settled science do not qualify — award partial credit only.
ANALOGY NOTE: Penalise an analogy only if its structural mapping is inaccurate or applied outside its valid domain. Do not penalise analogical style itself.

Rhetoric Score (0–30 Points):
- 30: Punchy, vivid, persuasive — uses concrete images or apt analogies to land a point without empty jargon.
- 15: Clear but flat, repetitive, or over-hedged.
- 0: Incomprehensible, incoherent, or pure mockery with no substance.

Tactics Score (0–30 Points):
- 30: Directly engages the opponent's actual argument; applies a specific tactic (reframe, concession-and-pivot, pointed question, exposed contradiction) to create new pressure.
- 15: Addresses the opponent's turn but introduces no new strategic pressure.
- 0: Ignores the opponent's previous turn or responds only to a strawman of it.

Score each category from 1 to 10. Do not use any other scale.

Output STRICTLY as valid JSON with no surrounding text or markdown:
{"logic_score": <integer 1-10>, "rhetoric_score": <integer 1-10>, "tactics_score": <integer 1-10>, "analysis": "<2-3 sentences citing specific reasoning>"}`;
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

    // Clamp each dimension to 1-10
    const logicRaw = Math.max(1, Math.min(10, Math.round(Number(data.logic_score)) || 5));
    const rhetoricRaw = Math.max(1, Math.min(10, Math.round(Number(data.rhetoric_score)) || 5));
    const tacticsRaw = Math.max(1, Math.min(10, Math.round(Number(data.tactics_score)) || 5));

    // Backend computes weighted total: logic*4 + rhetoric*3 + tactics*3
    const logicScore = logicRaw * 4;    // 0-40
    const rhetoricScore = rhetoricRaw * 3; // 0-30
    const tacticsScore = tacticsRaw * 3;   // 0-30
    const totalScore = logicScore + rhetoricScore + tacticsScore; // 0-100

    const analysis = typeof data.analysis === 'string' ? data.analysis : 'No analysis provided';

    // Store raw dimension scores (4-40/3-30/3-30) in these fields; UI displays with denominators.
    // frameControl and credibilityScore carry totalScore as proxies — calibrated in pressure.ts.
    const scores: JudgeScores = {
      logicalCoherence: logicScore,        // 4–40  (logicRaw × 4)
      rhetoricalForce: rhetoricScore,      // 3–30  (rhetoricRaw × 3)
      frameControl: totalScore,            // proxy: totalScore (7–100)
      credibilityScore: totalScore,        // proxy: totalScore (7–100)
      tacticalEffectiveness: tacticsScore, // 3–30  (tacticsRaw × 3)
      overallScore: totalScore             // 7–100
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

