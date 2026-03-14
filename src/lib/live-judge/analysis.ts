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
      systemPrompt: generateJudgeSystemPrompt(judge),
      temperature: 0.7,
      maxTokens: 1500,
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
 * Generate judge-specific prompt for turn analysis
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
  
  const recentHistory = messageHistory.slice(-4).map(msg => 
    `${msg.agentName}: "${msg.text}"`
  ).join('\n');

  return `Analyze turn ${turnNumber} of this debate. Fill in the JSON below exactly — no other text.

DEBATER BEING SCORED: ${agent.name}
THEIR MESSAGE: "${message}"

OPPONENT: ${opponent.name}
OPPONENT'S LAST MESSAGE: "${opponentMessage}"

TOPIC: ${context || 'General debate'}

RECENT HISTORY:
${recentHistory}

Available tactics: ${DEBATE_TACTICS.join(', ')}

{
  "reasoning": "2-3 sentences explaining the scores from a ${judge.specialization} perspective",
  "scores": {
    "logicalCoherence": 0,
    "rhetoricalForce": 0,
    "frameControl": 0,
    "credibility": 0,
    "tacticalEffectiveness": 0
  },
  "strategicImpact": {
    "momentumShift": 0,
    "frameControlShift": 0,
    "exposedWeaknesses": ["weakness"],
    "tacticalInsights": ["insight"]
  },
  "usedTactics": [
    {
      "tactic": "tactic_name",
      "effectiveness": 0,
      "confidence": 0,
      "context": "explanation"
    }
  ]
}`;
}

/**
 * Generate judge-specific system prompt
 */
function generateJudgeSystemPrompt(judge: LiveJudge): string {
  const config = JUDGE_SPECIALIZATION_CONFIGS[judge.specialization];
  
  return `You are ${config.name}, a debate judge specializing in ${judge.specialization}.

${config.description}

SCORING RUBRIC — score each dimension based on what the debater actually did this turn:

logicalCoherence (did the argument hold together?):
- 80–95: Directly refuted the opponent's core claim with a specific counter-argument or pointed out a genuine contradiction
- 60–79: Raised a valid point that advances their position without directly engaging the opponent's argument
- 40–59: Made assertions without reasoning, or partially addressed the opponent's point
- 20–39: Committed a clear logical error, ignored the opponent's main argument entirely, or contradicted themselves

rhetoricalForce (was it persuasive and clear?):
- 80–95: Landed a vivid phrase, strong analogy, or concrete example that makes the point stick
- 60–79: Clearly expressed, easy to follow, credible tone
- 40–59: Readable but generic — no memorable moment, no particular force
- 20–39: Vague, rambling, or so abstract it's hard to know what point was being made

frameControl (did they define or shift the terms of debate?):
- 80–95: Redefined a key term or reframed the debate topic in a way the opponent must now respond to
- 60–79: Steered toward their preferred ground without fully seizing the frame
- 40–59: Responded within the opponent's frame without challenging it
- 20–39: Conceded ground or adopted the opponent's framing

credibility (did they come across as trustworthy and informed?):
- 80–95: Cited a specific fact, study, or concrete example that is plausible and hard to dispute
- 60–79: Spoke with confidence and no obvious errors
- 40–59: Some assertions feel unjustified or overstated
- 20–39: Said something verifiably wrong, made things up, or wildly overstated

tacticalEffectiveness (did the move serve their overall strategy?):
- 80–95: Put the opponent in a difficult position — forced a retreat, exposed a gap, or changed the game
- 60–79: Solid move that maintains or slightly improves their position
- 40–59: Neutral — neither helps nor hurts
- 20–39: Walked into a trap or handed the opponent an easy win

MOMENTUM SHIFT (-25 to +25 integer only):
- +20 to +25: Landed a decisive blow the opponent cannot easily recover from
- +10 to +19: Clearly gained ground this turn
- +1 to +9: Slight edge
- 0: Even turn
- Negative: Mirror of above for ground lost

Respond ONLY with the JSON the user provides. No other text. Fill in all fields.`;
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
    // Handle null/undefined case first with more detailed logging
    if (analysisText === null || analysisText === undefined) {
      console.warn('Analysis text is null or undefined for judge:', judge.name, 'model:', judge.modelId);
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }
    
    // Additional check for empty string or whitespace-only string
    if (typeof analysisText === 'string' && analysisText.trim() === '') {
      console.warn('Analysis text is empty string for judge:', judge.name, 'model:', judge.modelId);
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }
    
    // Check if analysisText is valid
    if (!analysisText || (typeof analysisText !== 'string' && typeof analysisText !== 'object')) {
      console.warn('Invalid analysis text type:', typeof analysisText, 'Value:', analysisText);
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }

    // Convert to string if it's an object
    let analysisString: string;
    if (typeof analysisText === 'object') {
      analysisString = JSON.stringify(analysisText);
    } else {
      analysisString = analysisText;
    }

    // Extract JSON from response with more robust approach
    let jsonString = analysisString.trim();
    
    // Try to find the first '{' and last '}' to extract JSON
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    } else {
      console.warn('No JSON object found in analysis response, using fallback');
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }

    // Try to parse the JSON
    let analysisData;
    try {
      analysisData = JSON.parse(jsonString);
    } catch (parseError: unknown) {
      console.warn(`[Judge] ${judge.name} JSON parse failed (${(parseError as Error).message}), attempting fix. Raw response tail: ...${jsonString.slice(-200)}`);
      try {
        // Close any truncated string literal first
        let fixedJson = jsonString;
        const lastQuote = fixedJson.lastIndexOf('"');
        const afterLastQuote = fixedJson.slice(lastQuote + 1).replace(/\s/g, '');
        // If there's an unclosed string (odd number of unescaped quotes), close it
        if (afterLastQuote.length > 0 && !afterLastQuote.startsWith(',') && !afterLastQuote.startsWith('}') && !afterLastQuote.startsWith(']')) {
          fixedJson = fixedJson.slice(0, lastQuote + 1);
        }

        // Close brackets in the correct order: ] before }
        const openBraces = (fixedJson.match(/\{/g) || []).length;
        const closeBraces = (fixedJson.match(/\}/g) || []).length;
        const openBrackets = (fixedJson.match(/\[/g) || []).length;
        const closeBrackets = (fixedJson.match(/\]/g) || []).length;

        for (let i = 0; i < openBrackets - closeBrackets; i++) fixedJson += ']';
        for (let i = 0; i < openBraces - closeBraces; i++) fixedJson += '}';

        analysisData = JSON.parse(fixedJson);
      } catch (secondParseError: unknown) {
        console.warn(`[Judge] ${judge.name} JSON fix failed (${(secondParseError as Error).message}), using fallback`);
        return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
      }
    }
    
    // Validate required fields
    if (!analysisData.scores) {
      console.warn('Missing scores in analysis data, using fallback');
      return createFallbackAnalysis(judge, agent, opponent, turnNumber, message, opponentMessage, context);
    }

    // Map scores using consistent field names before calculating weighted score
    const mappedScores = {
      logicalCoherence: analysisData.scores.logicalCoherence || 70,
      rhetoricalForce: analysisData.scores.rhetoricalForce || 70,
      frameControl: analysisData.scores.frameControl || 70,
      credibilityScore: analysisData.scores.credibility || analysisData.scores.credibilityScore || 70,
      tacticalEffectiveness: analysisData.scores.tacticalEffectiveness || 70,
    };
    const overallScore = calculateWeightedScore(mappedScores, judge.scoringWeights);

    // Create effectiveness map
    const effectivenessMap: { [tactic: string]: number } = {};
    if (Array.isArray(analysisData.usedTactics)) {
      analysisData.usedTactics.forEach((tactic: TacticAnalysis) => {
        if (tactic.tactic && typeof tactic.effectiveness === 'number') {
          effectivenessMap[tactic.tactic] = tactic.effectiveness;
        }
      });
    }

    return {
      turnNumber,
      agentId: agent.id,
      agentName: agent.name,
      opponentId: opponent.id,
      opponentName: opponent.name,
      message,
      opponentMessage,
      context,
      scores: {
        ...mappedScores,
        overallScore
      },
      usedTactics: Array.isArray(analysisData.usedTactics) ? analysisData.usedTactics : [],
      effectivenessMap,
      momentumShift: analysisData.strategicImpact?.momentumShift || 0,
      frameControlShift: analysisData.strategicImpact?.frameControlShift || 0,
      exposedWeaknesses: Array.isArray(analysisData.strategicImpact?.exposedWeaknesses) 
        ? analysisData.strategicImpact.exposedWeaknesses 
        : [],
      tacticalInsights: Array.isArray(analysisData.strategicImpact?.tacticalInsights) 
        ? analysisData.strategicImpact.tacticalInsights 
        : [],
      judgeId: judge.id,
      judgeSpecialization: judge.specialization,
      reasoning: analysisData.reasoning || analysisData.reasoningText || 'No reasoning provided'
    };
  } catch (error) {
    console.error('Failed to parse judge analysis:', error);
    console.error('Analysis text was:', analysisText);
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