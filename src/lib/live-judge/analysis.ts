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
      temperature: 0.3,
      maxTokens: 800,
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

  return `Score this debate turn. Return ONLY valid JSON, exactly like the example below.

TOPIC: ${context || 'General debate'}
OPPONENT: ${opponent.name} said — "${opponentMessage}"
DEBATER BEING SCORED: ${agent.name} said — "${message}"

Example output (replace all values with your actual analysis):
{
  "reasoning": "Scores 64 on Logic because the debater asserts X without evidence, missing the opponent's counter-argument entirely. Rhetoric is 71 because the language is clear but generic with no memorable framing. Tactics at 48 because no new pressure was applied — the opponent can simply restate their position.",
  "scores": { "logicalCoherence": 64, "rhetoricalForce": 71, "frameControl": 55, "credibility": 60, "tacticalEffectiveness": 48 },
  "strategicImpact": { "momentumShift": 2, "frameControlShift": -3, "exposedWeaknesses": ["assertion without evidence"], "tacticalInsights": ["failed to apply pressure"] },
  "usedTactics": []
}`;
}

/**
 * Generate judge system prompt — no personality, strict rubric anchors, 2-3 sentence analysis
 */
function generateJudgeSystemPrompt(judge: LiveJudge): string {
  const specialization = judge.specialization;

  const rubrics: Record<string, string> = {
    logic: `Your primary lens is LOGICAL COHERENCE. Weight it most heavily.

Logical Coherence (0-100):
- 85–100: Flawless causal chain with explicit evidence or concrete examples; directly refutes the opponent's stated claim.
- 55–75: Coherent, but relies on hypotheticals or analogies instead of concrete examples; doesn't fully close the loop on the opponent's argument.
- 20–40: Logical fallacy, contradiction, or the debater ignored the opponent's core point entirely.

Rhetorical Force (0-100):
- 85–100: Punchy, persuasive, lands a memorable phrase or analogy; no bloated jargon.
- 55–75: Clear and credible, but generic — no standout moment.
- 20–40: Dense, dry, or so abstract the point is lost.

Tactical Execution (0-100):
- 85–100: Executes an advanced tactic (Concession & Pivot, Interrogation, Reframe) that puts the opponent on the defensive.
- 55–75: Refutes the opponent but introduces no new pressure.
- 20–40: Ignores the opponent's previous turn entirely.`,

    rhetoric: `Your primary lens is RHETORICAL FORCE. Weight it most heavily.

Rhetorical Force (0-100):
- 85–100: Punchy, persuasive, lands a memorable phrase or concrete analogy; no bloated jargon.
- 55–75: Clear and credible, but generic — no standout moment; overly dense or repetitive.
- 20–40: Boring, dry, incomprehensible, or leans heavily on academic filler.

Logical Coherence (0-100):
- 85–100: Flawless causal chain with explicit evidence; directly addresses the opponent's argument.
- 55–75: Coherent but relies on hypotheticals rather than concrete examples.
- 20–40: Logical fallacy, contradiction, or missed the opponent's point entirely.

Tactical Execution (0-100):
- 85–100: Executes an advanced tactic that forces the opponent into a difficult position.
- 55–75: Refutes but doesn't add new pressure.
- 20–40: Ignores the opponent's previous turn.`,

    strategy: `Your primary lens is TACTICAL EXECUTION. Weight it most heavily.

Tactical Execution (0-100):
- 85–100: Executes an advanced tactic (Concession & Pivot, Interrogation, Reframe, Trap-setting) that visibly puts the opponent on the defensive.
- 55–75: Refutes the opponent's point effectively but introduces no new strategic pressure.
- 20–40: Ignores the opponent's previous turn, or the move backfires and hands the opponent an easy win.

Logical Coherence (0-100):
- 85–100: Airtight reasoning with concrete evidence; closes the loop on the opponent's argument.
- 55–75: Coherent but unanchored — relies on hypotheticals rather than concrete examples.
- 20–40: Logical error, contradiction, or ignored the opponent's core claim.

Rhetorical Force (0-100):
- 85–100: Memorable, punchy delivery; strong framing; no jargon bloat.
- 55–75: Clear but forgettable.
- 20–40: Dense, dry, or incomprehensible.`,
  };

  return `You are an objective debate scoring system. You evaluate arguments against a fixed rubric. You have no personality and no biases — you are a scoring matrix.

${rubrics[specialization] ?? rubrics.logic}

frameControl (0-100): Did the debater redefine the terms or reframe the topic? 85+ = seized the frame; 55–75 = steered toward their ground; below 55 = responded within the opponent's frame.
credibility (0-100): Did they cite plausible facts or examples? 85+ = hard-to-dispute specifics; 55–75 = confident, no obvious errors; below 55 = unjustified assertions or overstatements.

MOMENTUM SHIFT (-25 to +25 integer):
- +20 to +25: Decisive blow — opponent cannot easily recover.
- +10 to +19: Clear ground gained.
- +1 to +9: Slight edge.
- 0: Even turn.
- Negative: Mirror of above.

RULES:
- reasoning must be exactly 2-3 sentences citing specific rubric anchors (e.g. "Scores 62 on Logic because...").
- Output ONLY valid JSON. No other text, no markdown, no explanation outside the JSON.`;
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