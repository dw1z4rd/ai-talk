import {
  type LiveJudge,
  type TurnAnalysis,
  type JudgeScores,
  type MomentumTracker,
  type FrameControlTracker,
  type PairwiseRound,
  type DebateScorecard,
  type NarrativeVerdict,
  type HarmonizationFlag,
} from "./types";
import type { Agent, Message } from "$lib/agents";
import { MODEL_CATALOG } from "$lib/agents";

// ── Debate domain classification ─────────────────────────────────────────────

export type DebateDomain = "empirical" | "philosophical" | "policy" | "mixed";

/**
 * Classify the debate topic into a domain category using keyword heuristics.
 * Used to inject domain-appropriate evidentiary standards into judge prompts.
 */
export function classifyDebateDomain(topic: string): DebateDomain {
  const t = topic.toLowerCase();

  const philosophicalKeywords = [
    "consciousness",
    "free will",
    "morality",
    "ethics",
    "justice",
    "identity",
    "metaphysics",
    "qualia",
    "knowledge",
    "beauty",
    "god",
    "soul",
    "meaning",
    "existence",
    "epistemology",
    "truth",
    "mind",
    "subjective",
    "objective reality",
    "free will",
    "determinism",
    "moral",
  ];
  const empiricalKeywords = [
    "climate",
    "vaccine",
    "health",
    "economic",
    "data",
    "study",
    "research",
    "science",
    "statistic",
    "evidence",
    "correlation",
    "causation",
    "experiment",
    "trial",
    "survey",
    "measurement",
    "empirical",
  ];
  const policyKeywords = [
    "policy",
    "law",
    "regulation",
    "government",
    "ban",
    "tax",
    "reform",
    "should ",
    "ought",
    "legislation",
    "rights",
    "democratic",
    "governance",
    "nuclear",
    "military",
    "ai safety",
    "censorship",
  ];

  const philoScore = philosophicalKeywords.filter((k) => t.includes(k)).length;
  const empiricalScore = empiricalKeywords.filter((k) => t.includes(k)).length;
  const policyScore = policyKeywords.filter((k) => t.includes(k)).length;

  const total = philoScore + empiricalScore + policyScore;
  if (total === 0) return "mixed";

  if (
    philoScore >= empiricalScore &&
    philoScore >= policyScore &&
    philoScore > 0
  )
    return "philosophical";
  if (empiricalScore > philoScore && empiricalScore >= policyScore)
    return "empirical";
  if (policyScore > 0) return "policy";
  return "mixed";
}

function buildDomainNote(domain: DebateDomain): string {
  switch (domain) {
    case "philosophical":
      return `NOTE — DOMAIN: PHILOSOPHICAL. Thought experiments, conceptual analysis, and intuition pumps ARE valid evidence in this debate. Do NOT penalize a turn for lacking empirical citations. Evaluate logical coherence of arguments on their own terms. Definitional assumptions still require defense if contested.`;
    case "empirical":
      return `NOTE — DOMAIN: EMPIRICAL. Precision claims (statistics, named studies, causal mechanisms) require plausible grounding. A bare assertion of a specific number without a mechanism explanation is penalizable (−1). A fully explained mechanism earns +1 even without a citation.`;
    case "policy":
      return `NOTE — DOMAIN: POLICY. Both normative frameworks and empirical evidence are valid. Consistent normative reasoning (deontological, consequentialist, etc.) earns the +1 causal chain bonus even without empirical citation. Mixed normative+empirical arguments are judged on the strength of their weakest link.`;
    default:
      return `NOTE — DOMAIN: MIXED. Apply calibrated standards: penalize hollow specificity in empirical claims, tolerate thought experiments in philosophical sub-claims, reward consistent normative reasoning in policy sub-claims.`;
  }
}

// ── Language consistency check ────────────────────────────────────────────────

/**
 * Detect if two turns appear to be written in different languages.
 * Uses CJK character ratio as the primary signal (catches the GLM Chinese-response bug).
 */
export function detectLanguageMismatch(
  messageA: string,
  messageB: string,
): { isConsistent: boolean; warning?: string } {
  const cjkRegex =
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
  const cjkA = (messageA.match(cjkRegex) || []).length;
  const cjkB = (messageB.match(cjkRegex) || []).length;
  const ratioA = messageA.length > 0 ? cjkA / messageA.length : 0;
  const ratioB = messageB.length > 0 ? cjkB / messageB.length : 0;
  const THRESHOLD = 0.08; // 8% CJK characters → likely non-English

  const aIsNonLatin = ratioA > THRESHOLD;
  const bIsNonLatin = ratioB > THRESHOLD;

  if (aIsNonLatin !== bIsNonLatin) {
    return {
      isConsistent: false,
      warning: `⚠ LANGUAGE MISMATCH: One turn appears to be in a non-English language. Comparison scores may be unreliable. Check debater system prompts for language enforcement.`,
    };
  }
  return { isConsistent: true };
}

// ── Pairwise comparative judging ──────────────────────────────────────────────

/**
 * Compare two consecutive debate turns head-to-head on Logic, Tactics, and Rhetoric.
 * This is the primary scoring function — replaces per-turn absolute scoring.
 */
export async function compareTurns(
  judge: LiveJudge,
  prevAgentId: string,
  prevAgentName: string,
  prevMessage: string,
  prevTurnNumber: number,
  curAgentId: string,
  curAgentName: string,
  curMessage: string,
  curTurnNumber: number,
  topic: string,
  roundNumber: number,
  signal?: AbortSignal,
  previousLogicDelta?: string,
): Promise<PairwiseRound> {
  const langCheck = detectLanguageMismatch(prevMessage, curMessage);
  if (!langCheck.isConsistent) {
    console.warn(`[Pairwise Judge] ${langCheck.warning}`);
  }

  const isOpeningRound = prevTurnNumber === 1;
  const domainNote = buildDomainNote(classifyDebateDomain(topic));
  const prompt = generatePairwisePrompt(
    prevAgentName,
    prevMessage,
    prevTurnNumber,
    curAgentName,
    curMessage,
    curTurnNumber,
    topic,
    isOpeningRound,
    previousLogicDelta,
  );

  const judgeProvider = createJudgeProvider(
    judge.modelId || "gpt-oss:120b-cloud",
  );
  const start = Date.now();

  try {
    const responseText = await judgeProvider.generateText(prompt, {
      systemPrompt: generatePairwiseSystemPrompt(
        prevAgentName,
        curAgentName,
        domainNote,
      ),
      temperature: 0.3,
      maxTokens: 700,
      signal,
    });

    console.log(
      `[Pairwise Judge] Round ${roundNumber} completed in ${Date.now() - start}ms`,
    );
    return parsePairwiseResponse(
      responseText,
      prevAgentId,
      prevAgentName,
      prevMessage,
      prevTurnNumber,
      curAgentId,
      curAgentName,
      curMessage,
      curTurnNumber,
      roundNumber,
      langCheck.warning,
    );
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (error?.name === "AbortError") {
      console.warn(
        `[Pairwise Judge] Round ${roundNumber} aborted after ${elapsed}ms`,
      );
    } else {
      console.error(
        `[Pairwise Judge] Round ${roundNumber} failed after ${elapsed}ms:`,
        error,
      );
    }
    return createFallbackPairwiseRound(
      prevAgentId,
      prevAgentName,
      prevMessage,
      prevTurnNumber,
      curAgentId,
      curAgentName,
      curMessage,
      curTurnNumber,
      roundNumber,
      langCheck.warning,
    );
  }
}

export function generatePairwiseSystemPrompt(
  nameA: string,
  nameB: string,
  domainNote: string = "",
): string {
  return `You are a comparative debate judge. Read two consecutive turns and pick the stronger one on three dimensions. No draws — you must choose one winner per dimension. Respond with a single JSON object only — no preamble, no markdown.

Required format (use exact agent names as shown):
{"logic_winner":"${nameA}","tactics_winner":"${nameB}","rhetoric_winner":"${nameA}","logic_delta":"2-3 sentences. Name the SPECIFIC logical failure in the weaker turn. For missing causal mechanisms, name which element was absent — e.g. 'stated how X produces Y but omitted why the mechanism holds under competitive markets' or 'gave mechanism but no measurable consequence.' For timeline violations, name the technology/concept and note it clearly postdates the phenomenon. Do NOT write vague phrases like 'unsupported premise' — articulate the gap.","tactics_delta":"1-2 sentences on which turn controlled the exchange and why.","rhetoric_delta":"1 sentence on which turn was more persuasive across all four components and why.","mechanism_delta":"1-2 sentences on mechanism quality for BOTH turns. For each, state which elements of the cause→process→measurable consequence chain were present or absent.","mechanism_failures":[],"counterfactual_agent":null,"counterfactual_summary":null}

--- LOGIC (forced choice) ---
Start each turn from 8. Apply deductions:
-1  One unsupported assumption (empirical OR philosophical — asserting "X implies Y" as fact without defending why is as penalizable as a bare statistics claim)
    Hollow specificity is penalizable: a specific number, percentage, or named study without a mechanism explanation is a -1 unsupported assumption. Precision is not a substitute for a causal account.
-2  Significant unsupported leap
-3  Clear logical error: category error, circular reasoning, strawman, or analogy whose structural mapping breaks down
-4  Multiple errors or incoherent structure
+1  Every major claim defended with an explicit causal chain
    Symmetric: if the mechanism is fully explained and the causal chain is explicit, award +1 even without a citation.
Winner = higher remaining score. If equal, award the turn whose core claim still stands despite errors.

Causal mechanism requirement: for each major causal leap, the argument must supply a mechanism sentence of the form "[how X produces Y] → [why that mechanism operates under these conditions] → [measurable consequence]." A causal leap missing any element of this template is penalized −1 as an unsupported assumption.
Also populate mechanism_delta (covers both turns) and mechanism_failures (array of agent names that had a mechanism failure) based on this assessment.
Retroactive necessary condition fallacy: if an argument treats a technology, concept, or practice that postdates the phenomenon being explained as a necessary condition for it, penalize −3. Later developments cannot be used as causal prerequisites for earlier effects. (Example: arguing that social media platforms were required for 19th-century political revolutions — social media is a 21st-century technology, not a prerequisite for 19th-century events.) When citing this violation in logic_delta, name the technology/concept and note that it clearly postdates the phenomenon.

EXCEPTIONS: Do not penalize thought experiments or illustrative hypotheticals as "unverified facts." Judge the mechanism, not the historical precision.

Argumentative stagnation: if a turn restates a prior claim without new evidence, mechanism, or development (see PREVIOUS ROUND NOTE if provided), treat it as a failed advance: −1.
Thesis drift: if a turn introduces a position that contradicts the debater's earlier stance (visible from PREVIOUS ROUND NOTE), penalize −1 for incoherence.

Strong analogy: a well-constructed analogy that draws a precise structural distinction — where the mapping between domains is explicit and the resulting insight is novel — earns a +1 LOGIC bonus if the structural mapping is valid. A decorative analogy used for rhetorical effect (no structural insight, no new distinction) earns nothing in LOGIC; evaluate it under RHETORIC.

Claim types: distinguish before applying evidentiary standards:
- Conceptual/definitional claims: assess on internal coherence. Penalizing for lack of empirical evidence is a scoring error.
- Empirical claims: assess on evidentiary grounding and mechanism.
- Normative claims: assess on consistency with the stated normative framework.

--- TACTICS (forced choice) ---
Which turn controlled the exchange? Did it target the opponent's strongest point, expose a real weakness, or redirect to better ground?
OPENING TURN (no previous opponent to rebut): Judge on framing quality — does it stake a defensible position and anticipate the strongest counterargument? Minimum is competitive framing.

Undefined comparative/superlative: if the motion contains an undefined superlative (e.g., "most X", "best Y") and a turn argues toward that superlative without first establishing a measurement standard, it has a foundational framing gap: −1 tactics. A turn that defines the evaluation metric earns a +1 framing bonus.

--- RHETORIC (forced choice) ---
Which turn was more persuasive and intellectually resonant? Evaluate on four equally-weighted components:
1. Expression quality — concrete and specific beats vague and academic; appropriate brevity beats padding. ONE component, not the whole rubric: do NOT let stylistic punchiness dominate. A structurally clear, plainly-expressed turn can outscore a vivid but weakly-structured one.
2. Structural clarity — is the argument easy to follow? Clear signposting beats rambling.
3. Audience awareness — does the turn speak to the stakes in terms the audience cares about?
4. Framing quality — does the turn define or reframe the central question to its own advantage?
Winner = the turn that is stronger across all four in aggregate.
ANTI-PUNCHINESS: Expression quality carries ONE vote out of four. Framing discipline and structural clarity are equally weighted. A vivid delivery style does not compensate for weak structure or poor framing.

--- DOMAIN CONTEXT ---
${domainNote}

--- ANTI-BIAS ---
Tone ≠ Logic. Academic register does not indicate sound reasoning. Confidence does not substitute for evidence. Apply identical evidentiary standards to both turns.
Citation ≠ Correctness. Cited precision that is mechanistically hollow is not stronger than uncited reasoning with a complete causal chain.
Style ≠ Rhetoric. Punchiness and brevity alone do not constitute superior rhetoric. Framing quality and structural clarity carry equal weight.

--- COUNTERFACTUAL ---
A counterfactual is a "no-X world" thought experiment: a turn that explicitly names a specific factor, asks what a world without it would look like, and then traces at least one full causal consequence in the form "if [X had not occurred / in a world without X], then [mechanism] → [measurable consequence]." The counterfactual must be the argument's own invention — not a paraphrase of the opponent's.
Detection: if either turn contains a counterfactual matching this definition, set counterfactual_agent to that agent's exact name and counterfactual_summary to one sentence. If neither qualifies, set both to null.
Scoring: the existing +1 for a complete explicit causal chain in LOGIC covers a counterfactual with a full chain — no separate bonus. A counterfactual missing the measurable consequence step is still penalized −1 under the mechanism requirement; populate mechanism_failures accordingly.`;
}

export function generatePairwisePrompt(
  nameA: string,
  messageA: string,
  turnA: number,
  nameB: string,
  messageB: string,
  turnB: number,
  topic: string,
  isOpeningRound: boolean,
  previousLogicDelta?: string,
): string {
  const openingNote = isOpeningRound
    ? `\n[NOTE: Turn ${turnA} is the OPENING statement — ${nameA} spoke first with no opponent yet. Apply OPENING TURN rules to their turn.]`
    : "";

  const prevDeltaNote = previousLogicDelta
    ? `\n[PREVIOUS ROUND JUDGE NOTE: "${previousLogicDelta}" — use this to detect argumentative stagnation or thesis drift in the current turns.]`
    : "";

  return `DEBATE TOPIC: ${topic}${openingNote}${prevDeltaNote}

TURN ${turnA} — ${nameA}:
"${messageA}"

TURN ${turnB} — ${nameB}:
"${messageB}"

Respond with JSON only:`;
}

function parsePairwiseResponse(
  responseText: string | null,
  prevAgentId: string,
  prevAgentName: string,
  prevMessage: string,
  prevTurnNumber: number,
  curAgentId: string,
  curAgentName: string,
  curMessage: string,
  curTurnNumber: number,
  roundNumber: number,
  languageWarning?: string,
): PairwiseRound {
  try {
    if (!responseText?.trim()) {
      console.warn(
        `[Pairwise Judge] Round ${roundNumber}: null/empty response`,
      );
      return createFallbackPairwiseRound(
        prevAgentId,
        prevAgentName,
        prevMessage,
        prevTurnNumber,
        curAgentId,
        curAgentName,
        curMessage,
        curTurnNumber,
        roundNumber,
        languageWarning,
      );
    }

    let jsonString = responseText
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .trim();

    const firstBrace = jsonString.indexOf("{");
    const lastBrace = jsonString.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      console.warn(
        `[Pairwise Judge] Round ${roundNumber}: no JSON found. Raw: ${responseText.slice(0, 200)}`,
      );
      return createFallbackPairwiseRound(
        prevAgentId,
        prevAgentName,
        prevMessage,
        prevTurnNumber,
        curAgentId,
        curAgentName,
        curMessage,
        curTurnNumber,
        roundNumber,
        languageWarning,
      );
    }
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);

    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch {
      const openBraces = (jsonString.match(/\{/g) || []).length;
      const closeBraces = (jsonString.match(/\}/g) || []).length;
      let fixed = jsonString;
      for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
      try {
        data = JSON.parse(fixed);
      } catch {
        console.warn(
          `[Pairwise Judge] Round ${roundNumber}: JSON repair failed`,
        );
        return createFallbackPairwiseRound(
          prevAgentId,
          prevAgentName,
          prevMessage,
          prevTurnNumber,
          curAgentId,
          curAgentName,
          curMessage,
          curTurnNumber,
          roundNumber,
          languageWarning,
        );
      }
    }

    const resolveWinner = (winnerField: string): string => {
      const lower = (winnerField || "").toLowerCase();
      if (lower.includes(prevAgentName.toLowerCase())) return prevAgentId;
      if (lower.includes(curAgentName.toLowerCase())) return curAgentId;
      // Fallback: if we can't parse, give current turn the benefit of the doubt
      console.warn(
        `[Pairwise Judge] Round ${roundNumber}: could not resolve winner "${winnerField}" to agent ID`,
      );
      return curAgentId;
    };

    return {
      roundNumber,
      prevTurn: {
        turnNumber: prevTurnNumber,
        agentId: prevAgentId,
        agentName: prevAgentName,
        message: prevMessage,
      },
      curTurn: {
        turnNumber: curTurnNumber,
        agentId: curAgentId,
        agentName: curAgentName,
        message: curMessage,
      },
      logicWinner: resolveWinner(data.logic_winner),
      tacticsWinner: resolveWinner(data.tactics_winner),
      rhetoricWinner: resolveWinner(data.rhetoric_winner),
      logicDelta:
        typeof data.logic_delta === "string"
          ? data.logic_delta.trim()
          : "No analysis provided.",
      tacticsDelta:
        typeof data.tactics_delta === "string"
          ? data.tactics_delta.trim()
          : "No analysis provided.",
      rhetoricDelta:
        typeof data.rhetoric_delta === "string"
          ? data.rhetoric_delta.trim()
          : "No analysis provided.",
      mechanismDelta:
        typeof data.mechanism_delta === "string"
          ? data.mechanism_delta.trim() || undefined
          : undefined,
      mechanismFailures: Array.isArray(data.mechanism_failures)
        ? data.mechanism_failures.filter((x: unknown) => typeof x === "string")
        : undefined,
      counterfactualDetected:
        typeof data.counterfactual_agent === "string" &&
        data.counterfactual_agent !== "null" &&
        data.counterfactual_agent.trim().length > 0
          ? {
              agentId: resolveWinner(data.counterfactual_agent),
              summary:
                typeof data.counterfactual_summary === "string"
                  ? data.counterfactual_summary.trim()
                  : "",
            }
          : undefined,
      languageWarning,
      isFallback: false,
    };
  } catch (error) {
    console.error("[Pairwise Judge] parsePairwiseResponse threw:", error);
    return createFallbackPairwiseRound(
      prevAgentId,
      prevAgentName,
      prevMessage,
      prevTurnNumber,
      curAgentId,
      curAgentName,
      curMessage,
      curTurnNumber,
      roundNumber,
      languageWarning,
    );
  }
}

function createFallbackPairwiseRound(
  prevAgentId: string,
  prevAgentName: string,
  prevMessage: string,
  prevTurnNumber: number,
  curAgentId: string,
  curAgentName: string,
  curMessage: string,
  curTurnNumber: number,
  roundNumber: number,
  languageWarning?: string,
): PairwiseRound {
  return {
    roundNumber,
    prevTurn: {
      turnNumber: prevTurnNumber,
      agentId: prevAgentId,
      agentName: prevAgentName,
      message: prevMessage,
    },
    curTurn: {
      turnNumber: curTurnNumber,
      agentId: curAgentId,
      agentName: curAgentName,
      message: curMessage,
    },
    logicWinner: prevAgentId,
    tacticsWinner: prevAgentId,
    rhetoricWinner: prevAgentId,
    logicDelta: "Fallback — judge analysis unavailable for this round.",
    tacticsDelta: "Fallback — judge analysis unavailable for this round.",
    rhetoricDelta: "Fallback — judge analysis unavailable for this round.",
    mechanismDelta: undefined,
    mechanismFailures: undefined,
    counterfactualDetected: undefined,
    languageWarning,
    isFallback: true,
  };
}

// ── Scorecard aggregation ─────────────────────────────────────────────────────

/**
 * Add a pairwise round to the running scorecard and return the updated scorecard.
 */
export function updateScorecard(
  scorecard: DebateScorecard,
  round: PairwiseRound,
  agentAId: string,
  agentAName: string,
  agentBId: string,
  agentBName: string,
): DebateScorecard {
  const updated: DebateScorecard = {
    rounds: [...scorecard.rounds, round],
    winTallies: {
      [agentAId]: scorecard.winTallies[agentAId] ?? {
        agentName: agentAName,
        logic: 0,
        tactics: 0,
        rhetoric: 0,
        total: 0,
      },
      [agentBId]: scorecard.winTallies[agentBId] ?? {
        agentName: agentBName,
        logic: 0,
        tactics: 0,
        rhetoric: 0,
        total: 0,
      },
    },
    overallWinner: null,
    counterfactualTrack: { ...(scorecard.counterfactualTrack ?? {}) },
  };

  // Record counterfactual submission if detected in this round
  if (round.counterfactualDetected) {
    updated.counterfactualTrack[round.counterfactualDetected.agentId] = true;
  }

  // Tally wins
  const tallyWin = (
    agentId: string,
    dimension: "logic" | "tactics" | "rhetoric",
  ) => {
    if (updated.winTallies[agentId]) {
      updated.winTallies[agentId][dimension]++;
      updated.winTallies[agentId].total++;
    }
  };

  tallyWin(round.logicWinner, "logic");
  tallyWin(round.tacticsWinner, "tactics");
  tallyWin(round.rhetoricWinner, "rhetoric");

  // Determine overall winner
  const tallies = Object.entries(updated.winTallies);
  if (tallies.length >= 2) {
    const sorted = tallies.sort((a, b) => b[1].total - a[1].total);
    if (sorted[0][1].total > sorted[1][1].total) {
      updated.overallWinner = sorted[0][0];
    }
    // Otherwise draw → overallWinner stays null
  }

  return updated;
}

/**
 * Convert pairwise win/loss result into synthetic JudgeScores for the adaptive
 * pressure system. Maps binary wins to values that sit above/below the pressure
 * thresholds defined in pressure.ts.
 */
export function synthScoresFromPairwise(
  round: PairwiseRound,
  forAgentId: string,
): JudgeScores {
  const logicWon = round.logicWinner === forAgentId;
  const tacticsWon = round.tacticsWinner === forAgentId;
  const rhetoricWon = round.rhetoricWinner === forAgentId;

  // Thresholds from pressure.ts:
  //   logicalCoherence: high > 28, low < 16  (4-40 scale)
  //   rhetoricalForce: high > 21, low < 12   (3-30 scale)
  //   tacticalEffectiveness: high > 21, low < 12 (3-30 scale)
  const logicScore = logicWon ? 30 : 14;
  const rhetoricScore = rhetoricWon ? 24 : 10;
  const tacticsScore = tacticsWon ? 24 : 10;

  const wins =
    (logicWon ? 1 : 0) + (tacticsWon ? 1 : 0) + (rhetoricWon ? 1 : 0);
  // Map 0-3 wins to overall scores that trigger appropriate pressure levels:
  //   0 wins → 30 (<40 = PRIORITY OVERRIDE)
  //   1 win  → 45 (mild)
  //   2 wins → 65 (neutral-positive)
  //   3 wins → 82 (positive reinforcement)
  const overallScore = [30, 45, 65, 82][wins];

  return {
    logicalCoherence: logicScore,
    rhetoricalForce: rhetoricScore,
    frameControl: overallScore,
    credibilityScore: overallScore,
    tacticalEffectiveness: tacticsScore,
    overallScore,
  };
}

// ── Harmonization ─────────────────────────────────────────────────────────────

/**
 * Synchronous check: compare pairwise winner assignments against per-turn absolute
 * scores for the same round. Returns flags for dimensions where the two systems diverge
 * beyond their scale-specific thresholds. No LLM call — pure arithmetic.
 *
 * Scale thresholds (gap required to flag):
 *   logic:   0–40,   threshold = 8
 *   tactics: 0–30,   threshold = 6
 *   rhetoric: 0–30,  threshold = 6
 *   overall: 0–100,  threshold = 15
 */
export function computeHarmonizationFlags(
  round: PairwiseRound,
  curAbsolute: import("./types").JudgeScores | undefined,
  prevAbsolute: import("./types").JudgeScores | undefined,
): HarmonizationFlag[] {
  if (!curAbsolute || !prevAbsolute) return [];

  const flags: HarmonizationFlag[] = [];
  const prevId = round.prevTurn.agentId;
  const curId = round.curTurn.agentId;

  const check = (
    dimension: HarmonizationFlag["dimension"],
    pairwiseWinnerId: string,
    prevScore: number,
    curScore: number,
    threshold: number,
  ) => {
    const absoluteLeaderId = curScore >= prevScore ? curId : prevId;
    const gap = Math.abs(curScore - prevScore);
    if (pairwiseWinnerId !== absoluteLeaderId && gap >= threshold) {
      flags.push({
        roundNumber: round.roundNumber,
        dimension,
        pairwiseWinner: pairwiseWinnerId,
        absoluteScoreLeader: absoluteLeaderId,
        divergenceMagnitude: gap,
        note: `${dimension} pairwise winner (${pairwiseWinnerId === prevId ? round.prevTurn.agentName : round.curTurn.agentName}) had lower absolute score by ${gap} (prev=${prevScore}, cur=${curScore})`,
      });
    }
  };

  check(
    "logic",
    round.logicWinner,
    prevAbsolute.logicalCoherence,
    curAbsolute.logicalCoherence,
    8,
  );
  check(
    "tactics",
    round.tacticsWinner,
    prevAbsolute.tacticalEffectiveness,
    curAbsolute.tacticalEffectiveness,
    6,
  );
  check(
    "rhetoric",
    round.rhetoricWinner,
    prevAbsolute.rhetoricalForce,
    curAbsolute.rhetoricalForce,
    6,
  );
  check(
    "overall",
    round.logicWinner,
    prevAbsolute.overallScore,
    curAbsolute.overallScore,
    15,
  );

  return flags;
}

// ── Narrative verdict ─────────────────────────────────────────────────────────

/**
 * Generate a 2-3 paragraph narrative verdict for the full debate.
 * Run once after all pairwise rounds are complete.
 */
export async function generateNarrativeVerdictText(
  judge: LiveJudge,
  fullTranscript: Message[],
  agentAId: string,
  agentAName: string,
  agentBId: string,
  agentBName: string,
  topic: string,
  scorecard: DebateScorecard,
  signal?: AbortSignal,
): Promise<NarrativeVerdict> {
  const transcriptText = fullTranscript
    .map((m, i) => `Turn ${i + 1} — ${m.agentName}:\n${m.text}`)
    .join("\n\n");

  const scorecardSummary = [agentAId, agentBId]
    .map((id) => {
      const t = scorecard.winTallies[id];
      return t
        ? `${t.agentName}: Logic ${t.logic}, Tactics ${t.tactics}, Rhetoric ${t.rhetoric} (${t.total} total wins)`
        : "";
    })
    .filter(Boolean)
    .join(" | ");

  const prompt = `DEBATE TOPIC: "${topic}"

PAIRWISE SCORECARD (${scorecard.rounds.length} rounds):
${scorecardSummary}

FULL TRANSCRIPT:
${transcriptText}

Write your verdict now:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "gpt-oss:120b-cloud",
  );
  const start = Date.now();

  try {
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt: generateNarrativeSystemPrompt(agentAName, agentBName),
      temperature: 0.7,
      maxTokens: 1200,
      signal,
    });
    console.log(
      `[Narrative Judge] Verdict completed in ${Date.now() - start}ms`,
    );
    return parseNarrativeVerdict(
      text,
      agentAId,
      agentAName,
      agentBId,
      agentBName,
      scorecard,
    );
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (error?.name === "AbortError") {
      console.warn(`[Narrative Judge] Aborted after ${elapsed}ms`);
    } else {
      console.error(`[Narrative Judge] Failed after ${elapsed}ms:`, error);
    }
    return {
      text: "Narrative verdict unavailable — judge analysis failed.",
      favouredAgentId: scorecard.overallWinner,
      agreesWithScorecard: true,
    };
  }
}

function generateNarrativeSystemPrompt(nameA: string, nameB: string): string {
  return `You are a senior debate analyst writing a post-match verdict for a sophisticated audience. Write exactly 2-3 paragraphs of prose.

Paragraph 1: Coherence of the cumulative case. Did either debater build a coherent, evolving argument across turns — setups that paid off, positions that held under pressure? Or did one keep retreating and reframing while the other drove consistent pressure?

Paragraph 2: The central unresolved tension of the debate. Name it precisely. Did either debater successfully pin the other on it, or did both sidestep it?

Paragraph 3: Your verdict. Who won the debate? Be specific — cite actual arguments and moments. Do NOT merely summarize the pairwise scorecard. Capture arc-level quality: coherence across the full debate, recovery under pressure, whether the core position survived scrutiny.

Rules:
- Reference specific turns and arguments by name.
- Do not reward style over substance. Academic register is not a proxy for rigorous reasoning.
- Do not be diplomatic. Pick a winner and explain why.
- At the very end, on its own line with nothing after, write exactly: VERDICT: ${nameA} OR VERDICT: ${nameB}`;
}

function parseNarrativeVerdict(
  text: string | null,
  agentAId: string,
  agentAName: string,
  agentBId: string,
  agentBName: string,
  scorecard: DebateScorecard,
): NarrativeVerdict {
  if (!text?.trim()) {
    return {
      text: "Verdict unavailable.",
      favouredAgentId: null,
      agreesWithScorecard: false,
    };
  }

  // Strip thinking blocks
  let cleaned = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  // Extract VERDICT line
  const verdictMatch = cleaned.match(/VERDICT:\s*(.+?)(?:\n|$)/i);
  let favouredAgentId: string | null = null;

  if (verdictMatch) {
    const verdictName = verdictMatch[1].trim();
    if (verdictName.toLowerCase().includes(agentAName.toLowerCase())) {
      favouredAgentId = agentAId;
    } else if (verdictName.toLowerCase().includes(agentBName.toLowerCase())) {
      favouredAgentId = agentBId;
    }
  }

  const agreesWithScorecard =
    favouredAgentId !== null && favouredAgentId === scorecard.overallWinner;
  // Remove the VERDICT line from display text
  const displayText = cleaned.replace(/VERDICT:\s*.+?(?:\n|$)/i, "").trim();

  return { text: displayText, favouredAgentId, agreesWithScorecard };
}

/**
 * Generate a 2-3 sentence adjudication when the narrative verdict disagrees with
 * the round-by-round scorecard. Explains why they diverged and which is better supported.
 */
export async function generateConflictResolution(
  judge: LiveJudge,
  scorecardWinnerName: string,
  narrativeFavouredName: string,
  scorecardSummary: string,
  narrativeText: string,
  signal?: AbortSignal,
): Promise<string> {
  const systemPrompt = `You are a meta-analyst adjudicating a conflict between two debate judging systems. Write exactly 3 sentences: (1) Why they diverged — identify the structural difference between turn-by-turn logic assessment and arc-level coherence. (2) Which verdict better reflects overall debate quality and why. (3) What the losing verdict got right despite picking the wrong winner. Be specific. Do not hedge.`;

  const prompt = `SCORECARD WINNER: ${scorecardWinnerName}
NARRATIVE VERDICT FAVOURS: ${narrativeFavouredName}

SCORECARD SUMMARY:
${scorecardSummary}

NARRATIVE VERDICT (excerpt):
${narrativeText.slice(0, 500)}

Write your adjudication:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "gpt-oss:120b-cloud",
  );
  try {
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt,
      temperature: 0.4,
      maxTokens: 220,
      signal,
    });

    // Strip thinking blocks
    const cleaned = (text || "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    return cleaned;
  } catch {
    return "";
  }
}

/**
 * Meta-judge pass: review the logic analyses from all pairwise rounds and flag
 * rubric drift — cases where the same type of argument was scored differently
 * across rounds, or where winner assignments appear inconsistent with the stated
 * reasoning. Returns a 2-3 sentence consistency report.
 */
export async function generateRubricHarmonization(
  judge: LiveJudge,
  rounds: import("./types").PairwiseRound[],
  agentAName: string,
  agentBName: string,
  narrativeVerdictText?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (rounds.length < 3) return "";

  // Use the last 8 non-fallback rounds to keep the prompt focused
  const analysisRounds = rounds.filter((r) => !r.isFallback).slice(-8);
  if (analysisRounds.length < 3) return "";

  const roundSummaries = analysisRounds
    .map(
      (r) =>
        `Round ${r.roundNumber} (T${r.prevTurn.turnNumber}:${r.prevTurn.agentName} vs T${r.curTurn.turnNumber}:${r.curTurn.agentName}): ` +
        `Logic→${r.logicWinner === r.prevTurn.agentId ? r.prevTurn.agentName : r.curTurn.agentName} | ` +
        `Tactics→${r.tacticsWinner === r.prevTurn.agentId ? r.prevTurn.agentName : r.curTurn.agentName} | ` +
        `Rhetoric→${r.rhetoricWinner === r.prevTurn.agentId ? r.prevTurn.agentName : r.curTurn.agentName}\n` +
        `Logic: "${r.logicDelta}" | Tactics: "${r.tacticsDelta}" | Rhetoric: "${r.rhetoricDelta}"`,
    )
    .join("\n\n");

  const narrativeBlock = narrativeVerdictText
    ? `\n\nNARRATIVE VERDICT (excerpt):\n${narrativeVerdictText.slice(0, 400)}`
    : "";

  const systemPrompt = `You are a meta-judge auditing scoring consistency across debate rounds. Review all round analyses plus the narrative verdict if provided. Produce exactly 3 sentences: (1) Per-round rubric consistency — were the same evidentiary, causal, and timeline standards applied uniformly across rounds? Cite specific round numbers if not. (2) Arc reconciliation — does the per-round win distribution across all three dimensions match the narrative verdict's favoured debater? If they diverge, name who the rounds favour vs. who the narrative favours and the most plausible reason. (3) Drift flag — the most significant rubric inconsistency with specific rounds named, or "No significant drift detected." Be specific and concise. Do not hedge.`;

  const prompt = `DEBATERS: ${agentAName} vs ${agentBName}

ROUND ANALYSES:
${roundSummaries}${narrativeBlock}

Write your consistency report:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "gpt-oss:120b-cloud",
  );
  try {
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt,
      temperature: 0.3,
      maxTokens: 200,
      signal,
    });
    const cleaned = (text || "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    return cleaned;
  } catch {
    return "";
  }
}

// ── Legacy per-turn analysis (used only for adaptive pressure) ────────────────

/**
 * Analyze a single turn with absolute scoring.
 * Used ONLY to generate adaptive pressure signals — not for display scoring.
 * The pairwise compareTurns() function is the primary scoring system.
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
  signal?: AbortSignal,
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
    messageHistory,
  );
  const domainNote = buildDomainNote(classifyDebateDomain(topic));

  const judgeProvider = createJudgeProvider(
    judge.modelId || "gpt-oss:120b-cloud",
  );
  const start = Date.now();

  try {
    const analysisText = await judgeProvider.generateText(judgePrompt, {
      systemPrompt: generateJudgeSystemPrompt(domainNote),
      temperature: 0.3,
      maxTokens: 600,
      signal,
    });
    console.log(
      `[Adaptive Judge] ${judge.name} completed in ${Date.now() - start}ms`,
    );
    return parseJudgeAnalysis(
      analysisText,
      judge,
      agent,
      opponent,
      turnNumber,
      message,
      opponentMessage,
      referenceContext,
    );
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (error?.name === "AbortError") {
      console.warn(`[Adaptive Judge] ${judge.name} aborted after ${elapsed}ms`);
    } else {
      console.error(
        `[Adaptive Judge] ${judge.name} failed after ${elapsed}ms:`,
        error,
      );
    }
    return createFallbackAnalysis(
      judge,
      agent,
      opponent,
      turnNumber,
      message,
      opponentMessage,
      referenceContext,
    );
  }
}

function generateJudgePrompt(
  judge: LiveJudge,
  agent: Agent,
  message: string,
  opponent: Agent,
  opponentMessage: string,
  turnNumber: number,
  topic: string,
  referenceContext: string,
  messageHistory: Message[],
): string {
  const contextBlock = referenceContext
    ? `\nREFERENCE MATERIAL: ${referenceContext}\n`
    : "";
  const isOpening = !opponentMessage.trim();
  const opponentBlock = isOpening
    ? `[OPENING TURN — ${agent.name} speaks first. No opponent argument exists yet.]`
    : `OPPONENT (${opponent.name}) just said: "${opponentMessage}"`;
  return `DEBATE TOPIC: ${topic || "General debate"}
TURN: ${turnNumber}${contextBlock}
${opponentBlock}

NOW EVALUATE — ${agent.name}'s response: "${message}"

Respond with the JSON object only:`;
}

function generateJudgeSystemPrompt(domainNote: string): string {
  return `You are a debate scoring system. Your entire response must be a single JSON object — no preamble, no explanation, no markdown.

Required output format (integers 1–10 only):
{"logic_score": 7, "rhetoric_score": 6, "tactics_score": 8, "analysis": "Max 2 sentences. Name the specific missing mechanism or gap."}

Keep the analysis field under 50 words.

SCORING PHILOSOPHY: A competent-but-unremarkable argument scores 5–6. Reserve 8–10 for genuinely strong work; 1–3 for clear failures.

--- LOGIC (1–10) ---
Start at 8. -1 unsupported assumption, -2 significant leap, -3 logical error, -4 multiple errors. +1 if every claim has explicit causal chain.
Hollow specificity is penalizable: a specific number, percentage, or named study without a mechanism explanation is a -1 unsupported assumption. Precision is not a substitute for a causal account.
Symmetric: if the mechanism is fully explained and the causal chain is explicit, award +1 even without a citation.
Causal mechanism requirement: for each major causal leap, the argument must supply a mechanism sentence of the form "[how X produces Y] → [why that mechanism operates under these conditions] → [measurable consequence]." A causal leap missing any element of this template is penalized −1 as an unsupported assumption.
Retroactive necessary condition fallacy: if an argument treats a technology, concept, or practice that postdates the phenomenon being explained as a necessary condition for it, penalize −3. Later developments cannot be used as causal prerequisites for earlier effects.
Strong analogy: a well-constructed analogy mapping a precise structural distinction earns +1 if the mapping is valid and the insight is novel. A decorative analogy earns nothing here.
Claim types: conceptual/definitional claims assessed on internal coherence (not empirical evidence); empirical claims need mechanism; normative claims need framework consistency.

--- RHETORIC (1–10) ---
Evaluate on four equally-weighted components in aggregate:
1. Expression quality — 9–10: clear, concrete, appropriately concise; 5–6: flat or over-hedged; 3–4: dry or padded. ONE component, not the whole rubric: do NOT let punchiness dominate.
2. Structural clarity — is the argument easy to follow? Clear signposting beats rambling.
3. Audience awareness — does it speak to the stakes in terms the audience cares about?
4. Framing quality — does it define or reframe the central question to its advantage?
ANTI-PUNCHINESS: Expression quality carries ONE vote out of four. Do not reward stylistic energy as a proxy for persuasive quality.

--- TACTICS (1–10) ---
Opening turn: score on framing quality, min 5. Other turns: 9–10 targets a specific gap with a named move; 5–6 mostly restates position; 1–2 ignores opponent.
Undefined comparative/superlative: if the motion has an undefined superlative and this turn argues toward it without establishing a metric, −1 tactics.

--- DOMAIN CONTEXT ---
${domainNote}

ANTI-BIAS: Tone ≠ Logic. Academic phrasing ≠ rigorous reasoning. Citation ≠ Correctness. Style ≠ Rhetoric.`;
}

export function parseJudgeAnalysis(
  analysisText: string | null,
  judge: LiveJudge,
  agent: Agent,
  opponent: Agent,
  turnNumber: number,
  message: string,
  opponentMessage: string,
  context: string,
): TurnAnalysis {
  try {
    if (!analysisText?.trim()) {
      return createFallbackAnalysis(
        judge,
        agent,
        opponent,
        turnNumber,
        message,
        opponentMessage,
        context,
      );
    }

    let jsonString = analysisText
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .trim();

    const firstBrace = jsonString.indexOf("{");
    const lastBrace = jsonString.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return createFallbackAnalysis(
        judge,
        agent,
        opponent,
        turnNumber,
        message,
        opponentMessage,
        context,
      );
    }
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);

    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch {
      const openBraces = (jsonString.match(/\{/g) || []).length;
      const closeBraces = (jsonString.match(/\}/g) || []).length;
      let fixed = jsonString;
      for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
      try {
        data = JSON.parse(fixed);
      } catch {
        return createFallbackAnalysis(
          judge,
          agent,
          opponent,
          turnNumber,
          message,
          opponentMessage,
          context,
        );
      }
    }

    const logicRaw = Math.max(
      1,
      Math.min(10, Math.round(Number(data.logic_score)) || 5),
    );
    const rhetoricRaw = Math.max(
      1,
      Math.min(10, Math.round(Number(data.rhetoric_score)) || 5),
    );
    const tacticsRaw = Math.max(
      1,
      Math.min(10, Math.round(Number(data.tactics_score)) || 5),
    );

    const logicScore = Math.min(40, logicRaw * 4);
    const rhetoricScore = Math.min(30, rhetoricRaw * 3);
    const tacticsScore = Math.min(30, tacticsRaw * 3);
    const totalScore = logicScore + rhetoricScore + tacticsScore;
    const analysis =
      typeof data.analysis === "string"
        ? data.analysis
        : "No analysis provided";

    const scores: JudgeScores = {
      logicalCoherence: logicScore,
      rhetoricalForce: rhetoricScore,
      frameControl: totalScore,
      credibilityScore: totalScore,
      tacticalEffectiveness: tacticsScore,
      overallScore: totalScore,
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
      reasoning: analysis,
    };
  } catch (error) {
    console.error("[Adaptive Judge] parseJudgeAnalysis threw:", error);
    return createFallbackAnalysis(
      judge,
      agent,
      opponent,
      turnNumber,
      message,
      opponentMessage,
      context,
    );
  }
}

export function createFallbackAnalysis(
  judge: LiveJudge,
  agent: Agent,
  opponent: Agent,
  turnNumber: number,
  message: string,
  opponentMessage: string,
  context: string,
): TurnAnalysis {
  const defaultScores: JudgeScores = {
    logicalCoherence: 20,
    rhetoricalForce: 15,
    frameControl: 50,
    credibilityScore: 50,
    tacticalEffectiveness: 15,
    overallScore: 50,
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
        context: "Fallback",
      },
    ],
    effectivenessMap: { fallback_default: 50 },
    momentumShift: 0,
    frameControlShift: 0,
    exposedWeaknesses: ["Unable to analyze"],
    tacticalInsights: ["Fallback analysis"],
    judgeId: judge.id,
    judgeSpecialization: judge.specialization,
    reasoning: "Fallback analysis — using default scores",
  };
}

export function aggregateJudgeScores(
  judgeAnalyses: TurnAnalysis[],
): JudgeScores {
  if (judgeAnalyses.length === 0) {
    return {
      logicalCoherence: 0,
      rhetoricalForce: 0,
      frameControl: 0,
      credibilityScore: 0,
      tacticalEffectiveness: 0,
      overallScore: 0,
    };
  }
  const agg: JudgeScores = {
    logicalCoherence: 0,
    rhetoricalForce: 0,
    frameControl: 0,
    credibilityScore: 0,
    tacticalEffectiveness: 0,
    overallScore: 0,
  };
  judgeAnalyses.forEach((a) => {
    agg.logicalCoherence += a.scores.logicalCoherence;
    agg.rhetoricalForce += a.scores.rhetoricalForce;
    agg.frameControl += a.scores.frameControl;
    agg.credibilityScore += a.scores.credibilityScore;
    agg.tacticalEffectiveness += a.scores.tacticalEffectiveness;
    agg.overallScore += a.scores.overallScore;
  });
  const d = judgeAnalyses.length;
  return {
    logicalCoherence: Math.round(agg.logicalCoherence / d),
    rhetoricalForce: Math.round(agg.rhetoricalForce / d),
    frameControl: Math.round(agg.frameControl / d),
    credibilityScore: Math.round(agg.credibilityScore / d),
    tacticalEffectiveness: Math.round(agg.tacticalEffectiveness / d),
    overallScore: Math.round(agg.overallScore / d),
  };
}

export function calculateMomentumShift(
  scores: JudgeScores,
  momentumTracker: MomentumTracker,
  agentId: string,
): number {
  const baseMomentum = (scores.overallScore - 50) * 0.4;
  const tacticalBonus = (scores.tacticalEffectiveness - 15) * 0.3;
  const credibilityPenalty = (50 - scores.credibilityScore) * 0.2;
  const currentMomentum = momentumTracker.currentMomentum[agentId] || 0;
  const inertiaFactor = currentMomentum * 0.1;
  return Math.max(
    -25,
    Math.min(
      25,
      baseMomentum + tacticalBonus - credibilityPenalty + inertiaFactor,
    ),
  );
}

export function calculateFrameControlShift(
  scores: JudgeScores,
  frameControlTracker: FrameControlTracker,
  agentId: string,
): number {
  // 17.5 = midpoint of avg(logicalCoherence 0–40, rhetoricalForce 0–30) = (20 + 15) / 2
  const baseControl =
    (scores.logicalCoherence + scores.rhetoricalForce) / 2 - 17.5;
  const tacticalModifier = (scores.tacticalEffectiveness - 15) * 0.3;
  const currentControl = frameControlTracker.currentControl[agentId] || 0;
  const inertiaFactor = currentControl * 0.15;
  return Math.max(
    -20,
    Math.min(20, (baseControl + tacticalModifier + inertiaFactor) * 0.4),
  );
}

function createJudgeProvider(modelId: string) {
  const modelDef = MODEL_CATALOG[modelId];
  if (!modelDef) throw new Error(`Model ${modelId} not found in catalog`);
  return modelDef.makeProvider();
}
