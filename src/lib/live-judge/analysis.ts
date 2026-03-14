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
      maxTokens: 800,
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
  const isOpening = !opponentMessage.trim();
  const opponentBlock = isOpening
    ? `[OPENING TURN — ${agent.name} speaks first. No opponent argument exists yet. Apply the OPENING TURN tactics rule.]`
    : `OPPONENT (${opponent.name}) just said: "${opponentMessage}"`;
  return `DEBATE TOPIC: ${topic || 'General debate'}
TURN: ${turnNumber}${contextBlock}
${opponentBlock}

NOW EVALUATE — ${agent.name}'s response: "${message}"

Respond with the JSON object only:`;
}

/**
 * Generate judge system prompt
 */
function generateJudgeSystemPrompt(): string {
  return `You are a debate scoring system. Your entire response must be a single JSON object — no preamble, no explanation, no markdown, no text before or after the braces.

Required output format (integers 1–10 only):
{"logic_score": 7, "rhetoric_score": 6, "tactics_score": 8, "analysis": "2-3 sentence reasoning here."}

SCORING PHILOSOPHY: Scores must discriminate. A competent-but-unremarkable argument scores 5–6. Reserve 8–10 for genuinely strong work; use 1–3 for clear failures. Do not anchor to 7.

--- LOGIC (1–10) ---
Start at 8. Apply deductions:
-1  One unsupported assumption or minor unverified claim.
-2  Significant unsupported leap; or unverified specificity — deploying precise-sounding claims as established fact without a traceable source. This includes: exact statistics or percentages, named studies or data, specific mechanisms ("X works via Y"), and confident assertion of specific phenomena (e.g. "shell companies are used for Z", "botnets do X", "HFT cables cause Y") where the specificity is doing rhetorical work but the claim itself is unverified. The test: could this specific claim be factually wrong? If yes and it's unsourced, deduct 2.
-3  A clear logical error: category error, circular reasoning, strawman, or analogy whose mapping breaks down.
-4  Multiple errors or a structurally incoherent argument.
-5  Internally contradictory or entirely fallacious.
Add back +1 if every major claim is grounded in a verifiable fact or a precisely mapped analogy with an explicit causal chain.
Final score = max(1, min(10, 8 + additions - deductions)).
ANALOGY: penalise only if the structural mapping is inaccurate. Vivid analogies that map correctly are as valid as formal proofs.

--- RHETORIC (1–10) ---
- 9–10: Punchy, vivid, memorable — lands with force, no empty jargon.
- 7–8: Clear and persuasive but not exceptional.
- 5–6: Competent but flat, over-hedged, or repetitive.
- 3–4: Dry, dense, or relies on mockery over substance.
- 1–2: Incomprehensible or incoherent.

--- TACTICS (1–10) ---
OPENING TURN (opponent message is empty): Score on framing quality, not engagement. A bold opening that stakes a clear defensible position and anticipates the strongest counterargument earns 7–9. A vague or unguarded opening earns 4–6. Do not penalise the opener for failing to rebut a non-existent argument — minimum score is 5.
ALL OTHER TURNS:
- 9–10: Directly targets a specific claim or gap in the opponent's argument; applies a named tactic (reframe, concession-pivot, pointed question, exposed contradiction) that creates new pressure.
- 7–8: Engages the opponent's argument but adds no new strategic leverage.
- 5–6: Partially addresses the opponent; mostly restates own position.
- 3–4: Responds to a strawman or largely ignores the opponent's turn.
- 1–2: Completely ignores the opponent.

ANTI-BIAS: Apply identical standards to both debaters. If an analogy earns credit for one side, an equivalent analogy from the other must be judged by the same criteria.`;
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
      console.warn(`[Judge] ${judge.name} received null/empty response from provider`);
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }

    let jsonString = analysisText.trim();
    const lastBrace = jsonString.lastIndexOf('}');
    // Use lastIndexOf('{') so that if the model embeds JSON-like syntax inside
    // a <thinking> block before the real response, we grab the final object.
    const firstBrace = lastBrace !== -1 ? jsonString.lastIndexOf('{', lastBrace) : -1;
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      console.warn(`[Judge] ${judge.name} no JSON found in response. Raw (first 300 chars): ${jsonString.slice(0, 300)}`);
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

