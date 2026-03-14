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
import { createOllamaProvider, withRetry } from '$lib/llm-agent';
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
  messageHistory: Message[]
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
  
  try {
    const analysisText = await judgeProvider.generateText(judgePrompt, {
      systemPrompt: generateJudgeSystemPrompt(judge),
      temperature: 0.7,
      maxTokens: 1500
    });

    return parseJudgeAnalysis(analysisText, judge, agent, opponent, turnNumber, message, opponentMessage, context);
  } catch (error) {
    console.error(`Judge analysis failed for ${judge.name}:`, error);
    // Return fallback analysis
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

  return `You are ${judge.name}, a ${judge.specialization} judge analyzing turn ${turnNumber} of a debate.

AGENT BEING ANALYZED: ${agent.name}
AGENT'S MESSAGE: "${message}"

OPPONENT: ${opponent.name}
OPPONENT'S PREVIOUS MESSAGE: "${opponentMessage}"

DEBATE CONTEXT: ${context || 'No specific context provided'}

RECENT DEBATE HISTORY:
${recentHistory}

JUDGE SPECIALIZATION: ${judge.specialization}
${JUDGE_SPECIALIZATION_CONFIGS[judge.specialization].description}

SCORING WEIGHTS:
- Logical Coherence: ${(judge.scoringWeights.logicalCoherence * 100).toFixed(0)}%
- Rhetorical Force: ${(judge.scoringWeights.rhetoricalForce * 100).toFixed(0)}%
- Frame Control: ${(judge.scoringWeights.frameControl * 100).toFixed(0)}%
- Credibility: ${(judge.scoringWeights.credibilityScore * 100).toFixed(0)}%
- Tactical Effectiveness: ${(judge.scoringWeights.tacticalEffectiveness * 100).toFixed(0)}%

Please analyze this turn and provide:

1. SCORES (0-100 each):
   - logicalCoherence: [score]
   - rhetoricalForce: [score]
   - frameControl: [score]
   - credibility: [score]
   - tacticalEffectiveness: [score]

2. TACTICS USED (identify up to 3):
   - tactic: [tactic_name]
   - effectiveness: [0-100]
   - confidence: [0-100]
   - context: [brief explanation]

3. STRATEGIC IMPACT:
   - momentumShift: [-100 to +100] (how this affects debate momentum)
   - frameControlShift: [-100 to +100] (how this affects narrative control)
   - exposedWeaknesses: [list any weaknesses in opponent's argument]
   - tacticalInsights: [key strategic observations]

4. REASONING: [brief explanation of your scoring decisions]

Available tactics to choose from: ${DEBATE_TACTICS.join(', ')}

Respond in this exact JSON format:
{
  "scores": {
    "logicalCoherence": 0,
    "rhetoricalForce": 0,
    "frameControl": 0,
    "credibility": 0,
    "tacticalEffectiveness": 0
  },
  "usedTactics": [
    {
      "tactic": "tactic_name",
      "effectiveness": 0,
      "confidence": 0,
      "context": "explanation"
    }
  ],
  "strategicImpact": {
    "momentumShift": 0,
    "frameControlShift": 0,
    "exposedWeaknesses": [],
    "tacticalInsights": []
  },
  "reasoning": "explanation"
}`;
}

/**
 * Generate judge-specific system prompt
 */
function generateJudgeSystemPrompt(judge: LiveJudge): string {
  const config = JUDGE_SPECIALIZATION_CONFIGS[judge.specialization];
  
  return `You are ${config.name}, an expert debate judge with specialized expertise in ${judge.specialization}.

${config.description}

Your scoring bias profile:
- Complexity preference: ${judge.biasProfile.preferenceComplexity > 0 ? 'prefers' : 'disprefers'} complex arguments
- Emotional preference: ${judge.biasProfile.preferenceEmotion > 0 ? 'prefers' : 'disprefers'} emotional appeals
- Aggression preference: ${judge.biasProfile.preferenceAggression > 0 ? 'prefers' : 'disprefers'} aggressive tactics
- Evidence preference: ${judge.biasProfile.preferenceEvidence > 0 ? 'prefers' : 'disprefers'} evidence-based arguments

Analyze debates objectively but apply your specialized perspective. Be precise in your scoring and provide tactical insights that reflect your expertise.

Key evaluation criteria:
- Logic and reasoning quality
- Persuasive power and emotional resonance
- Narrative and frame control
- Tactical effectiveness and strategic impact
- Credibility and authenticity

CRITICAL INSTRUCTION: You MUST respond ONLY with valid JSON in the exact format specified below. Do not include any other text, explanations, or markdown formatting. Just pure JSON.

Example response format:
{
  "scores": {
    "logicalCoherence": 85,
    "rhetoricalForce": 75,
    "frameControl": 80,
    "credibility": 90,
    "tacticalEffectiveness": 70
  },
  "usedTactics": [
    {
      "tactic": "evidence_citation",
      "effectiveness": 85,
      "confidence": 90,
      "context": "cited specific study to support claim"
    }
  ],
  "strategicImpact": {
    "momentumShift": 5,
    "frameControlShift": 10,
    "exposedWeaknesses": ["inconsistent logic in previous argument"],
    "tacticalInsights": ["effective use of authoritative sources"]
  },
  "reasoning": "The agent demonstrated strong logical coherence by citing specific studies..."
}

If you cannot provide a complete analysis, fill in reasonable default values rather than omitting fields.`;
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
    // Check if analysisText is valid
    if (!analysisText || typeof analysisText !== 'string') {
      throw new Error('Invalid analysis text: ' + typeof analysisText);
    }

    // Extract JSON from response with more robust regex
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in analysis response');
    }

    // Try to parse the JSON
    let analysisData;
    try {
      analysisData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      throw new Error('Failed to parse JSON: ' + parseError.message);
    }
    
    // Validate required fields
    if (!analysisData.scores) {
      throw new Error('Missing scores in analysis data');
    }

    // Calculate overall score using judge's weights
    const overallScore = calculateWeightedScore(analysisData.scores, judge.scoringWeights);

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
        logicalCoherence: analysisData.scores.logicalCoherence || 70,
        rhetoricalForce: analysisData.scores.rhetoricalForce || 70,
        frameControl: analysisData.scores.frameControl || 70,
        credibilityScore: analysisData.scores.credibility || analysisData.scores.credibilityScore || 70,
        tacticalEffectiveness: analysisData.scores.tacticalEffectiveness || 70,
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
    scores.credibility * weights.credibility +
    scores.tacticalEffectiveness * weights.tacticalEffectiveness
  );
}

/**
 * Create fallback analysis when judge analysis fails
 */
function createFallbackAnalysis(
  judge: LiveJudge,
  agent: Agent,
  opponent: Agent,
  turnNumber: number,
  message: string,
  opponentMessage: string,
  context: string
): TurnAnalysis {
  const defaultScores: JudgeScores = {
    logicalCoherence: 70,
    rhetoricalForce: 70,
    frameControl: 70,
    credibilityScore: 70,
    tacticalEffectiveness: 70,
    overallScore: 70
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
    usedTactics: [],
    effectivenessMap: {},
    momentumShift: 0,
    frameControlShift: 0,
    exposedWeaknesses: [],
    tacticalInsights: [],
    judgeId: judge.id,
    judgeSpecialization: judge.specialization,
    reasoning: 'Fallback analysis due to judge analysis failure'
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
  
  const provider = modelDef.makeProvider();
  return withRetry(provider, {
    maxRetries: 2,
    initialDelayMs: 600
  });
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