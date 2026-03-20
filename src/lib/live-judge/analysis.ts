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
  type OpenFlag,
  type FlagUpdate,
} from "./types";
import type { Agent, Message } from "$lib/agents";
import { MODEL_CATALOG } from "$lib/agents";
import { withRetry } from "$lib/llm-agent/retry";

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

  // Secondary check: catch mid-sentence code-switching where the overall CJK
  // ratio is below the mismatch threshold but isolated CJK characters appear
  // inside an otherwise Latin-script message. This catches patterns like
  // "Your stimulation证据 is impressive" where a single Chinese word is
  // embedded in an English sentence — a debater-side rendering artefact distinct
  // from a full-language mismatch.
  const inlineSwitchA = !aIsNonLatin && cjkA > 0;
  const inlineSwitchB = !bIsNonLatin && cjkB > 0;
  if (inlineSwitchA || inlineSwitchB) {
    const who =
      inlineSwitchA && inlineSwitchB
        ? "both turns"
        : inlineSwitchA
          ? "Turn A"
          : "Turn B";
    return {
      isConsistent: true, // language profiles still match; this is a content artefact
      warning: `⚠ INLINE CODE-SWITCH: ${who} contain isolated CJK characters inside an otherwise Latin-script message. This is a model word-boundary artefact. Affected text may contain garbled or language-switched words — treat those passages as unreliable.`,
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
  openFlags?: OpenFlag[],
  mode?: "debate" | "document_audit",
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
    undefined,
    openFlags,
  );

  const baseProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
  );
  const judgeProvider = withRetry(baseProvider, {
    maxRetries: 3,
    initialDelayMs: 800,
    backoffFactor: 2,
  });
  const start = Date.now();

  try {
    const responseText = await judgeProvider.generateText(prompt, {
      systemPrompt: generatePairwiseSystemPrompt(
        prevAgentName,
        curAgentName,
        domainNote,
        mode,
      ),
      temperature: 0.3,
      maxTokens: 1200,
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
  mode?: "debate" | "document_audit",
): string {
  return `You are a comparative debate judge. Read two consecutive turns and pick the stronger one on three dimensions. No draws — you must choose one winner per dimension. Respond with a single JSON object only — no preamble, no markdown. Write all string values as plain prose — no asterisks, underscores, or backticks for emphasis.

Required format (use exact agent names as shown):
{"logic_winner":"${nameA}","tactics_winner":"${nameB}","rhetoric_winner":"${nameA}","logic_delta":"2-3 sentences. Name the SPECIFIC logical failure in the weaker turn. For missing causal mechanisms, name which element was absent — e.g. 'stated how X produces Y but omitted why the mechanism holds under competitive markets' or 'gave mechanism but no measurable consequence.' For timeline violations, name the technology/concept and note it clearly postdates the phenomenon. Do NOT write vague phrases like 'unsupported premise' — articulate the gap.","tactics_delta":"1-2 sentences on which turn controlled the exchange and why.","rhetoric_delta":"1 sentence on which turn was more persuasive across all four components and why.","mechanism_delta":"1-2 sentences on mechanism quality for BOTH turns. For each, state which elements of the cause→process→measurable consequence chain were present or absent.","mechanism_failures":[],"suspect_claims":[],"fabricated_claims":[],"epistemic_note":null,"counterfactual_agent":null,"counterfactual_summary":null,"resolved_flags":[],"flag_updates":[]}

--- LOGIC (forced choice) ---
Start each turn from 8. Apply deductions:
-1  One unsupported assumption (empirical OR philosophical — asserting "X implies Y" as fact without defending why is as penalizable as a bare statistics claim)
    Hollow specificity is penalizable: a specific number, percentage, named study, named pilot program or location (e.g., "studies in Finland," "pilot programs across three countries," "the Kenya experiment," "trials at Stanford"), or allusion to unnamed research findings (e.g., "recent work shows...", "studies have found...", "it has been shown that...", "experiments demonstrate...") without naming the specific paper AND without supplying a mechanism explanation is a -1 unsupported assumption. Geographic or institutional specificity is not a substitute for a causal account — it is the same hollow-specificity pattern with a location attached. This penalty applies symmetrically regardless of which debater makes the claim — prior scoring history and positional advantage confer no leniency.
-2  Significant unsupported leap
-3  Clear logical error: category error, circular reasoning, strawman, or analogy whose structural mapping breaks down
-4  Multiple errors or incoherent structure
+1  Every major claim defended with an explicit causal chain
    Symmetric: if the mechanism is fully explained and the causal chain is explicit, award +1 even without a citation.
+1  Grounded precision (symmetric counterpart to hollow specificity): a claim that names a specific, verifiable datum AND supplies a mechanism chain linking it to the turn's core argument earns +1. Hollow = specificity without mechanism (−1); Grounded = specificity with mechanism (+1). Both adjustments can coexist on the same turn.
Winner = higher remaining score. If equal, award the turn whose core claim still stands despite errors.

CONSISTENCY REQUIREMENT: Your logic_winner field and your logic_delta text MUST be internally consistent. If logic_delta describes an agent as having "a concrete mechanism", "an explicit causal chain", "supplies the cause→process→consequence" or equivalent language on the core contested question, that agent MUST be your logic_winner — unless logic_delta also explicitly reconciles why their mechanism advantage was still outweighed by a larger gap on a different criterion. You may not praise an agent's mechanism quality and simultaneously award logic to their opponent without a reconciling sentence. The same internal-consistency requirement applies to tactics_winner/tactics_delta and rhetoric_winner/rhetoric_delta.
ILLUSTRATIVE FIGURES: Numbers and percentages that function as rhetorical illustrations of proportional relationships within an argument (e.g., "when AI handles 80% of tasks", "one editor replaces five writers", "headcount drops from 100 to 15") are NOT hollow specificity unless the argument explicitly presents them as measured empirical findings from documented research. Do NOT add these to suspect_claims or fabricated_claims. The hollow-specificity penalty applies to claims stated as empirical facts — specific statistics, study results, or documented measurements — without a mechanism chain.

Causal mechanism requirement: for each major causal leap, the argument must supply a mechanism sentence of the form "[how X produces Y] → [why that mechanism operates under these conditions] → [measurable consequence]." A causal leap missing any element of this template is penalized −1 as an unsupported assumption.
Also populate mechanism_delta (covers both turns) and mechanism_failures (array of agent names that had a mechanism failure) based on this assessment.
Retroactive causation (timeline category error): before awarding any causal credit, verify that every technology, framework, study, or institutional form invoked could plausibly have existed at the era being argued about. Two graduated penalties apply:
−3  The postdating item is treated as a necessary condition or causal prerequisite — the argument cannot stand without it. (Example: arguing that social media was required for 19th-century political revolutions — social media is a 21st-century technology and cannot be a prerequisite for 19th-century events.)
−1  The postdating item is used as supporting evidence, a contributing factor, or an illustrative analogy, but is not strictly necessary — the argument leans on it but could in principle survive without it. (Example: invoking modern regression analysis as evidence of a claim about pre-statistical-era economic behaviour.) The argument receives partial causal credit for what the period-appropriate elements actually establish.
When citing either violation in logic_delta, name the technology/concept and note that it clearly postdates the phenomenon. This graduated −3/−1 treatment applies to the pairwise scoring rubric; the legacy per-turn scoring prompt used by analyzeTurn() intentionally retains only the −3 "necessary condition" penalty to keep adaptive pressure conservative.

EXCEPTIONS: Do not penalize thought experiments or illustrative hypotheticals as "unverified facts." Judge the mechanism, not the historical precision.

Argumentative stagnation: if a turn restates a prior claim without new evidence, mechanism, or development (see PREVIOUS ROUND NOTE if provided), treat it as a failed advance: −1.
Thesis drift (Logic component): penalize −1 ONLY when the drift produces a direct logical contradiction with a prior committed position — when the new claim is logically inconsistent with something the debater already committed to in a prior turn (visible from PREVIOUS ROUND NOTE). Pure strategic retreat to weaker ground without contradiction belongs in TACTICS, not LOGIC. When the drift is both a strategic retreat AND contradictory, both the LOGIC and TACTICS penalties apply.

Strong analogy: a well-constructed analogy that draws a precise structural distinction — where the mapping between domains is explicit and the resulting insight is novel — earns a +1 LOGIC bonus if the structural mapping is valid. A decorative analogy used for rhetorical effect (no structural insight, no new distinction) earns nothing in LOGIC; evaluate it under RHETORIC.

Analogy ≠ mechanism: an analogy — even a structurally valid strong analogy — cannot substitute for the explicit cause→process→measurable consequence chain. If a turn's primary causal explanation is delivered through an analogy (e.g., "works like a skeleton for the body", "like a seed growing into a forest") without translating the mapping into domain-specific cause→process→consequence terms, the mechanism requirement is unmet → −1. The +1 strong-analogy bonus applies only on top of a complete mechanism chain, never as a replacement for it.

Claim types — classify each major claim before applying standards. Applying empirical requirements to non-empirical claims is itself a scoring error:
- Conceptual/definitional: assess on internal coherence. Does the definition do discriminatory work in the argument? Penalizing for lack of empirical evidence is a scoring error.
- Empirical: assess on evidentiary grounding and mechanism chain.
- Normative: assess on consistency with the stated normative framework. No empirical requirement unless the claim is presented as empirical.
- Phenomenological: claims about how a phenomenon is experienced or operates in practice (distinct from measurement or definition). Assess whether the argument's model of the phenomenon maps accurately onto observed behavior. Incorrect phenomenological mapping = −1 unsupported assumption. No empirical measurement required, but accurate phenomenon modeling is.
- Epistemic/procedural: claims about the allocation of burden of proof, evidentiary standards, or inferential architecture (e.g. "this is a positive existence claim requiring affirmative evidence", "my opponent assumed X without establishing it"). Assess whether the assigned burden is appropriate, clearly specified, and consistently maintained — not whether the claim has empirical grounding or a causal chain. Dismissing such arguments as 'unexplained logical rules' without engaging their epistemic validity is a scoring error; they must be evaluated on their own terms.

--- TACTICS (forced choice) ---
Which turn controlled the exchange? Did it target the opponent's strongest point, expose a real weakness, or redirect to better ground?
OPENING TURN (no previous opponent to rebut): Judge on framing quality — does it stake a defensible position and anticipate the strongest counterargument? Minimum is competitive framing.

Positional consistency: if PREVIOUS ROUND NOTE shows the core claim has materially shifted (not refined) under pressure, penalize −1 for abandoning defensible ground. Refinement = same claim with new mechanism or evidence added. Drift = replacing the core claim with a different, coexisting weaker one. Contradiction = new claim logically inconsistent with a prior committed position. Drift alone = −1 Tactics only. Drift that is also contradictory = −1 Tactics AND −1 Logic (see above).

Undefined comparative/superlative: if the motion contains an undefined superlative (e.g., "most X", "best Y"), scan BOTH turns before scoring. Did either establish a measurement standard? If NEITHER did, apply −1 to each and describe the shared structural gap in tactics_delta. A turn that defines the evaluation metric earns a +1 framing bonus.

--- RHETORIC (forced choice) ---
Which turn was more persuasive and intellectually resonant? Evaluate on four equally-weighted components:
1. Expression quality — concrete and specific beats vague and academic; appropriate brevity beats padding. ONE component, not the whole rubric: do NOT let stylistic punchiness dominate. A structurally clear, plainly-expressed turn can outscore a vivid but weakly-structured one.
2. Structural clarity — is the argument easy to follow? Clear signposting beats rambling.
3. Audience awareness — does the turn speak to the stakes in terms the audience cares about?
4. Framing quality — does the turn define or reframe the central question to its own advantage?
Winner = the turn that is stronger across all four in aggregate.
ANTI-PUNCHINESS: Expression quality carries ONE vote out of four. Framing discipline and structural clarity are equally weighted. A vivid delivery style does not compensate for weak structure or poor framing.
SERVICE TEST: Do this turn's rhetorical choices make the argument clearer, more defensible, and more compelling — or do they substitute for argument structure? Vivid delivery that doesn't advance the core claim loses to plain expression that directly develops it.

--- DOMAIN CONTEXT ---
${domainNote}

--- ANTI-BIAS ---
Tone ≠ Logic. Academic register does not indicate sound reasoning. Confidence does not substitute for evidence. Apply identical evidentiary standards to both turns.
Citation ≠ Correctness. Cited precision that is mechanistically hollow is not stronger than uncited reasoning with a complete causal chain.
Confident specificity is not self-validating. An agent that has been winning rounds is not entitled to leniency on hollow empirical assertions. A gesture toward "recent work" or "studies show" without naming the source or supplying a mechanism receives the same −1 hollow specificity penalty regardless of which debater makes it.
Style ≠ Rhetoric. Punchiness and brevity alone do not constitute superior rhetoric. Framing quality and structural clarity carry equal weight.

--- COUNTERFACTUAL ---
A counterfactual is a "no-X world" thought experiment: a turn that explicitly names a specific factor, asks what a world without it would look like, and then traces at least one full causal consequence in the form "if [X had not occurred / in a world without X], then [mechanism] → [measurable consequence]." The counterfactual must be the argument's own invention — not a paraphrase of the opponent's.
Detection: if either turn contains a counterfactual matching this definition, set counterfactual_agent to that agent's exact name and counterfactual_summary to one sentence. If neither qualifies, set both to null.
Scoring: the existing +1 for a complete explicit causal chain in LOGIC covers a counterfactual with a full chain — no separate bonus. A counterfactual missing the measurable consequence step is still penalized −1 under the mechanism requirement; populate mechanism_failures accordingly.
HYPOTHETICAL FIGURES IN COUNTERFACTUALS: A specific number or percentage used to illustrate the magnitude of a hypothetical consequence within a counterfactual scenario (e.g. "in a world without X, a 2% disorder rate might follow") is an illustrative hypothetical, NOT a factual empirical claim. Do NOT flag it for hollow specificity and do NOT add it to suspect_claims. The hollow-specificity penalty applies only to claims presented as factual descriptions of actual events or documented studies.

--- CLAIM AUDITABILITY ---
For every concrete factual or empirical assertion in either turn that you considered penalizing for hollow specificity — whether or not you ultimately docked a point — add an entry to suspect_claims using the format "AgentName: [exact or close quote of the claim]". This creates an auditable record that can be reviewed independently of the scoring decision. Empty array if no such claims appeared in either turn.

Named-location and named-program research invocations are automatically suspect_claims candidates: any claim that invokes pilot programs, experiments, trials, or studies by naming countries, cities, institutions, or program names (e.g., "pilot studies in Finland, Kenya, and Canada", "the Stockton experiment", "research at MIT") WITHOUT citing a specific paper title or supplying a mechanism chain MUST appear in suspect_claims regardless of whether you applied a penalty.

--- FABRICATION AUDIT ---
fabricated_claims is a strict subset of suspect_claims reserved for claims that are demonstrably false in a specific, documentable way — not merely unverified or ungrounded:
- Historically inverted: the claim presents X as causing Y, but X was formalized or discovered AFTER Y was already observed (e.g. claiming a mathematical formalism caused the natural phenomenon it was later derived to describe)
- Causally backwards: the effect is presented as the cause (e.g. claiming shell geometry proves mathematical governance when the geometry is what led to the mathematical description)
- Inverted study/result: the claim attributes a conclusion to a body of research that demonstrates the opposite

Distinction:
  suspect_claims = "this claim is unverified or mechanistically hollow — may be true but lacks a grounding chain"
  fabricated_claims = "this claim is factually false in a specific, nameable way"

Any entry in fabricated_claims MUST also appear in suspect_claims. Use the same "AgentName: claim text" format.
In the OPEN FLAGS system: unverified/hollow claims → -1 retroactive penalty. Fabricated claims → mandatory -2 retroactive penalty (or -3 when the false claim is the load-bearing premise of the turn's entire argument).

--- EPISTEMIC DISCIPLINE ---
Set epistemic_note to a 1-sentence observation if either agent made strong empirical claims without appropriately acknowledging evidentiary limits — for example, stating contested statistics as settled fact, invoking unnamed research as authoritative, or asserting causal relationships as proven without hedging. This field is non-scoring: it is a qualitative flag for arc-level narrative analysis. Set to null if both agents reasoned responsibly about uncertainty.

--- OPEN FLAGS (retroactive correction) ---
If an OPEN FLAGS block appears in the prompt, it lists hollow claims from prior turns that have not yet been penalized on the originating turn's absolute score.
(a) For each open flag attributed to TURN A (the prevTurn): if the claim remains unsubstantiated, emit a flag_update. For FABRICATED flags (marked [FABRICATED] in the OPEN FLAGS block), set delta_raw to -2. For UNVERIFIED flags, set delta_raw to -1. Severe fabrications that are the load-bearing premise of the turn may use -3. Always use negative values for penalties. Set update_type to "penalty". Set target_turn to the originating turn number shown in the flag entry (e.g. T3 → target_turn: 3; FLAG-T11-... → target_turn: 11). Never use the current turn being judged as target_turn.
(b) If TURN B (curTurn) explicitly substantiates a previously-flagged claim — supplying the missing mechanism chain — emit a flag_update with delta_raw +1, update_type "partial_restore". Set target_turn to the ORIGINATING turn number. Partial restore is capped at half the original penalty magnitude: if penalty was -2, the maximum restore is +1.
(c) Include flag_id exactly as given (no brackets) so the register can reconcile the entry.
(d) If a flag was resolved (partial restore applied or the agent clearly addressed it), add the flag_id to resolved_flags.
MECHANISM EXEMPTION: Before issuing a flag_update penalty, check whether this round's logic_delta or mechanism_delta credits the flagged agent's mechanism as explicit, complete, or sound on the relevant claim. If you describe the agent's causal chain as present and adequate in those fields, the missing-mechanism concern is resolved — issue a partial_restore instead of a penalty and add the flag_id to resolved_flags. A complete mechanism chain in the current turn supersedes the hollow-specificity flag from the prior round.
  {"flag_id": "FLAG-T3-agentslug-0", "target_turn": 3, "delta_raw": -1, "update_type": "penalty", "reason": "Claim still unsubstantiated"}
  {"flag_id": "FLAG-T3-agentslug-1", "target_turn": 3, "delta_raw": 1, "update_type": "partial_restore", "reason": "Mechanism chain supplied in current turn"}
Omitting target_turn or using wrong key names will silently discard the update. For every open flag you see, you MUST emit either a penalty or a partial_restore — do NOT leave flag_updates empty when open flags are present.

CRITICAL: Open flags govern only retroactive adjustments to previous absolute scores. They do NOT influence the logic_winner decision, which is always determined by the two current turns' content only. Never let an open flag substitute for engaging with what the current turn actually said.
${
  mode === "document_audit"
    ? `
--- DOCUMENT AUDIT MODE ---
${nameA}'s turns are verbatim excerpts from a source document. They are NOT the output of a live debater making rhetorical choices. Apply these adjustments for ${nameA} only:
SUPPRESS: "argumentative stagnation" (a static document cannot adapt), "thesis drift" and "positional consistency" penalties (section-to-section variation in a document is expected), and all "not responding to opponent" deductions.
FOCUS ${nameA} scoring on: whether each claim is supported by an explicit mechanism chain, whether specificity is grounded or hollow, and whether the section is internally logically coherent. All hollow-specificity and mechanism-chain rules apply in full.
CITATION STANDARD: A claim accompanied by a real citation (Author, Year, Journal) has met the evidence requirement. Do NOT penalise ${nameA} for failing to reproduce inline statistics from the cited paper — the citation is a pointer, not a paste. You may legitimately penalise: (a) vague appeals with no citation ("research shows"), (b) citations where the inference clearly exceeds what the paper demonstrated, (c) missing mechanism chains where no citation closes the gap. Deducting points because a specific number from the cited study was not reprinted inline is a scoring error.
LAYERED CLAIMS: A claim that makes a confident assertion on one dimension (e.g. statistical robustness) and a qualified statement on a different dimension (e.g. causal uncertainty) is NOT internally contradictory — it is correct two-dimensional description. "The association is robust but causality is uncertain" states that the effect replicates across studies (statistical claim) AND that observational design cannot establish mechanism (causal claim). Both can be simultaneously true. "Well-supported at the systems level" + "direct human measurement is limited" describes converging evidence + a specific gap within it. Do NOT score these as logical contradictions or "rhetorical overreach." Score them as contradictions only if the document then draws causal conclusions that the caveat should have prevented.
EPISTEMIC HONESTY EXCEPTION: If a section in ${nameA}'s turn is explicitly marked as uncertain or unknown (language like "we don't know", "evidence is uncertain", "less confidently", or a labelled "What We Don't Know" / "Limitations" subsection), that section is a lower-priority audit target. Flag mechanism quality briefly if absent, but do NOT penalise citation absence for what the document honestly admits is unresolved. Confident claims presented as settled fact remain the primary scoring target. Rewarding epistemic honesty over false confidence is correct auditor behaviour.
AUDITOR CONCESSION RULE: If ${nameB}'s turn explicitly concedes that the document section is well-supported, well-cited, or sound — using phrases like "earns its confidence level", "no significant gaps", "appropriately hedged", "this is exactly what the framework credits", "the document earns its hedging", "no audit challenge here", or similar language — score that round to ${nameA} on all dimensions. An auditor that signs off on a section has lost that round. The auditor may provide analytical scaffolding (e.g. counterfactual tests) to reach the concession; that scaffolding is how the auditor verified soundness, not a reason to award the round to the auditor. Analytical structure does not override the verdict of the person doing the analysis.
Apply ALL standard scoring rules to ${nameB} — they are a live auditor with complete agency over their argumentation choices.`
    : ""
}`;
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
  openFlags?: OpenFlag[],
): string {
  const openingNote = isOpeningRound
    ? `\n[NOTE: Turn ${turnA} is the OPENING statement — ${nameA} spoke first with no opponent yet. Apply OPENING TURN rules to their turn.]`
    : "";

  const previousDeltaNote = previousLogicDelta
    ? `\n\nPREVIOUS ROUND JUDGE NOTE: ${previousLogicDelta}`
    : "";

  // Build a structured OPEN FLAGS block instead of raw prose delta.
  // Only include flags for the prevTurn agent (nameA) since that is the agent
  // whose abstract score can receive retroactive corrections from the judge.
  const prevTurnFlags =
    openFlags?.filter(
      (f) => f.agentName === nameA && f.status === "unresolved",
    ) ?? [];
  const openFlagsNote =
    prevTurnFlags.length > 0
      ? `\n\nOPEN FLAGS (unresolved hollow claims from prior turns by ${nameA}):\n${prevTurnFlags
          .map((f) => {
            const tag =
              f.claimType === "fabricated"
                ? "[FABRICATED: mandatory -2]"
                : "[UNVERIFIED: -1]";
            return `- [${f.flagId}] T${f.originTurn} ${tag}: "${f.claim}" — mechanism absent [UNRESOLVED]`;
          })
          .join(
            "\n",
          )}\nSee OPEN FLAGS section in the system prompt for instructions on how to handle these.`
      : "";

  return `DEBATE TOPIC: ${topic}${openingNote}${previousDeltaNote}${openFlagsNote}

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
        ? data.mechanism_failures
            .filter((x: unknown) => typeof x === "string")
            .map((x: string) => x.trim())
            .filter((x: string) => x.length > 0)
        : undefined,
      suspectClaims: Array.isArray(data.suspect_claims)
        ? data.suspect_claims
            .filter((x: unknown) => typeof x === "string")
            .map((x: string) => x.trim())
            .filter((x: string) => x.length > 0)
        : undefined,
      fabricatedClaims: Array.isArray(data.fabricated_claims)
        ? data.fabricated_claims
            .filter((x: unknown) => typeof x === "string")
            .map((x: string) => x.trim())
            .filter((x: string) => x.length > 0)
        : undefined,
      epistemicNote:
        typeof data.epistemic_note === "string" &&
        data.epistemic_note.trim() !== "null" &&
        data.epistemic_note.trim().length > 0
          ? data.epistemic_note.trim()
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
      resolvedFlags: Array.isArray(data.resolved_flags)
        ? data.resolved_flags
            .filter((x: unknown) => typeof x === "string")
            .map((x: string) => x.trim())
            .filter((x: string) => x.length > 0)
        : undefined,
      flagUpdates: Array.isArray(data.flag_updates)
        ? data.flag_updates
            .filter(
              (x: unknown): x is Record<string, unknown> =>
                typeof x === "object" && x !== null,
            )
            .map((x: Record<string, unknown>): FlagUpdate | null => {
              const flagId =
                typeof x.flag_id === "string" ? x.flag_id.trim() : null;
              const targetTurn =
                typeof x.target_turn === "number"
                  ? Math.round(x.target_turn)
                  : null;
              const deltaRaw =
                typeof x.delta_raw === "number" ? x.delta_raw : null;
              const reason =
                typeof x.reason === "string" ? x.reason.trim() : "";
              const updateType =
                x.update_type === "partial_restore"
                  ? "partial_restore"
                  : "penalty";
              // Flags are always for the prevTurn agent — the OPEN FLAGS block
              // instructs the LLM to only issue updates for prevTurn claims.
              const agentId = prevAgentId;
              if (!flagId || targetTurn === null || deltaRaw === null)
                return null;
              // Clamp: penalties must be negative, restores positive, raw magnitude ≤ 3.
              // For penalties, allow -2 and -3 (fabricated/severe claims) — do not cap at -1.
              const clampedDelta =
                updateType === "penalty"
                  ? Math.max(-3, Math.min(-1, deltaRaw))
                  : Math.max(1, Math.min(2, deltaRaw));
              return {
                flagId,
                targetTurn,
                agentId,
                dimension: "logicalCoherence",
                deltaRaw: clampedDelta,
                reason,
                updateType,
              };
            })
            .filter((x: FlagUpdate | null): x is FlagUpdate => x !== null)
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
    logicWinner: "tie",
    tacticsWinner: "tie",
    rhetoricWinner: "tie",
    logicDelta: "Fallback — judge analysis unavailable for this round.",
    tacticsDelta: "Fallback — judge analysis unavailable for this round.",
    rhetoricDelta: "Fallback — judge analysis unavailable for this round.",
    mechanismDelta: undefined,
    mechanismFailures: undefined,
    suspectClaims: undefined,
    fabricatedClaims: undefined,
    epistemicNote: undefined,
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
    rounds: [...scorecard.rounds, round].sort(
      (a, b) => a.roundNumber - b.roundNumber,
    ),
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
    updated.counterfactualTrack![round.counterfactualDetected.agentId] = true;
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

// ── Pairwise floor enforcement ────────────────────────────────────────────────

/**
 * Clamp one absolute score dimension for the CURRENT turn (curVal) so it is
 * structurally consistent with the pairwise verdict for that dimension.
 *
 *   Win  (curTurn)  → cur within [winFloor,  scaleCeil]
 *   Loss (prevTurn) → cur within [lossFloor, lossCeil]
 *   Draw            → cur within [drawFloor, drawCeil]
 *
 * Bands are fixed fractions of scaleCeil — they do NOT reference the previous
 * turn's score. This eliminates the historical "counter bug" where consecutive
 * wins via prevVal + winGap drove the floor past scaleCeil, locking every
 * subsequent WIN turn at exactly scaleCeil.
 *
 * Overlapping bands are intentional: a close win can numerically resemble a
 * strong draw, and a strong-draw can resemble a narrow loss. Non-overlapping
 * bands are the defect — a WIN turn scoring below a LOSS ceiling is the
 * contradiction class this function prevents.
 *
 * Scale parameters:
 *   Logic    (0–40): WIN [24,40]  DRAW [18,30]  LOSS [10,22]
 *   Tactics  (0–30): WIN [18,30]  DRAW [13,22]  LOSS [ 7,16]
 *   Rhetoric (0–30): WIN [18,30]  DRAW [13,22]  LOSS [ 7,16]
 */
function clampAbsDim(
  winner: string,
  curId: string,
  prevId: string,
  curVal: number,
  winFloor: number,
  drawFloor: number,
  drawCeil: number,
  lossFloor: number,
  lossCeil: number,
  scaleCeil: number,
): number {
  if (winner === curId) {
    // WIN: ensure the score sits in the win band [winFloor, scaleCeil]
    return Math.max(winFloor, Math.min(scaleCeil, curVal));
  } else if (winner === prevId) {
    // LOSS: constrain to the loss band [lossFloor, lossCeil]
    return Math.max(lossFloor, Math.min(lossCeil, curVal));
  } else {
    // DRAW: constrain to the draw band [drawFloor, drawCeil]
    return Math.max(drawFloor, Math.min(drawCeil, curVal));
  }
}

/**
 * Apply pairwise-verdict bands to the current turn's absolute scores.
 * Returns a (possibly new) JudgeScores object; returns the same reference if
 * no value changed so callers can skip logging.
 *
 * Scale parameters used (WIN/DRAW/LOSS bands as [floor, ceil]):
 *   Logic    (0–40): WIN [24,40]  DRAW [18,30]  LOSS [10,22]
 *   Tactics  (0–30): WIN [18,30]  DRAW [13,22]  LOSS [ 7,16]
 *   Rhetoric (0–30): WIN [18,30]  DRAW [13,22]  LOSS [ 7,16]
 */
export function applyPairwiseFloors(
  logicWinner: string,
  tacticsWinner: string,
  rhetoricWinner: string,
  curId: string,
  prevId: string,
  curScores: JudgeScores,
): JudgeScores {
  const newLogic = clampAbsDim(
    logicWinner,
    curId,
    prevId,
    curScores.logicalCoherence,
    24, // winFloor
    18, // drawFloor
    30, // drawCeil
    10, // lossFloor
    22, // lossCeil
    40, // scaleCeil
  );
  const newTactics = clampAbsDim(
    tacticsWinner,
    curId,
    prevId,
    curScores.tacticalEffectiveness,
    18, // winFloor
    13, // drawFloor
    22, // drawCeil
    7, // lossFloor
    16, // lossCeil
    30, // scaleCeil
  );
  const newRhetoric = clampAbsDim(
    rhetoricWinner,
    curId,
    prevId,
    curScores.rhetoricalForce,
    18, // winFloor
    13, // drawFloor
    22, // drawCeil
    7, // lossFloor
    16, // lossCeil
    30, // scaleCeil
  );

  if (
    newLogic === curScores.logicalCoherence &&
    newTactics === curScores.tacticalEffectiveness &&
    newRhetoric === curScores.rhetoricalForce
  ) {
    return curScores; // no change — return same reference
  }

  const newTotal = newLogic + newTactics + newRhetoric;
  return {
    ...curScores,
    logicalCoherence: newLogic,
    tacticalEffectiveness: newTactics,
    rhetoricalForce: newRhetoric,
    overallScore: newTotal,
    frameControl: newTotal,
    credibilityScore: newTotal,
  };
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
  //
  // Three-value mapping for each dimension:
  //   WIN  → high signal   (triggers positive pressure cascade)
  //   DRAW → neutral zone  (no pressure trigger in either direction)
  //   LOSS → low signal    (triggers corrective pressure)
  const logicScore = logicWon ? 30 : round.logicWinner === "tie" ? 22 : 14;
  const rhetoricScore = rhetoricWon
    ? 24
    : round.rhetoricWinner === "tie"
      ? 17
      : 10;
  const tacticsScore = tacticsWon
    ? 24
    : round.tacticsWinner === "tie"
      ? 17
      : 10;

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
 * Reconcile pairwise-assigned dimension winners against per-turn absolute scores.
 *
 * Equal scores → "tie" (no scorecard win counted for either agent).
 * Unequal scores → the original pairwise winner is used (restored via *WinnerRaw
 * when a retroactive penalty previously forced a tie that has since diverged).
 *
 * The raw pairwise winner is stored in `logicWinnerRaw` / `tacticsWinnerRaw` /
 * `rhetoricWinnerRaw` on first reconciliation so it survives subsequent calls.
 * Non-tie discrepancies are left to computeHarmonizationFlags to surface as flags.
 */
export function reconcileRoundWinners(
  round: PairwiseRound,
  curAbsolute: import("./types").JudgeScores | undefined,
  prevAbsolute: import("./types").JudgeScores | undefined,
): PairwiseRound {
  if (!curAbsolute || !prevAbsolute) return round;

  // Capture the true pairwise winner before any reconciliation overwrites it.
  // If this field is already set (re-reconciliation path), preserve the prior raw value.
  const rawLogic = round.logicWinnerRaw ?? round.logicWinner;
  const rawTactics = round.tacticsWinnerRaw ?? round.tacticsWinner;
  const rawRhetoric = round.rhetoricWinnerRaw ?? round.rhetoricWinner;

  const prevId = round.prevTurn.agentId;
  const curId = round.curTurn.agentId;

  /**
   * Reconciliation decision for one dimension:
   * - Equal absolute scores → "tie" (no win counted for either agent)
   * - Unequal scores → retain the pairwise winner's judgment
   *   (pairwise has richer context — full turn text — and is authoritative;
   *    divergences are surfaced separately via computeHarmonizationFlags)
   */
  const reconcile = (
    rawWinner: string,
    curScore: number,
    prevScore: number,
  ): string => {
    if (curScore === prevScore) return "tie";
    return rawWinner;
  };

  return {
    ...round,
    logicWinnerRaw: rawLogic,
    tacticsWinnerRaw: rawTactics,
    rhetoricWinnerRaw: rawRhetoric,
    logicWinner: reconcile(
      rawLogic,
      curAbsolute.logicalCoherence,
      prevAbsolute.logicalCoherence,
    ),
    tacticsWinner: reconcile(
      rawTactics,
      curAbsolute.tacticalEffectiveness,
      prevAbsolute.tacticalEffectiveness,
    ),
    rhetoricWinner: reconcile(
      rawRhetoric,
      curAbsolute.rhetoricalForce,
      prevAbsolute.rhetoricalForce,
    ),
  };
}

/**
 * Synchronous check: compare pairwise winner assignments against per-turn absolute
 * scores for the same round. Returns flags for dimensions where the two systems diverge
 * beyond their scale-specific thresholds. No LLM call — pure arithmetic.
 *
 * Scale thresholds (gap required to flag):
 *   logic:   0–40,   threshold = 5
 *   tactics: 0–30,   threshold = 6  (= 2 raw points; was 3, raised to reduce noise)
 *   rhetoric: 0–30,  threshold = 6  (same rationale)
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
    drawThreshold: number = 4,
  ) => {
    const gap = Math.abs(curScore - prevScore);

    // A tied absolute score means neither agent outperformed the other; any
    // pairwise winner assignment is arbitrary and must always be flagged,
    // regardless of the threshold.
    if (gap === 0) {
      if (pairwiseWinnerId !== "tie") {
        const winnerName =
          pairwiseWinnerId === prevId
            ? round.prevTurn.agentName
            : round.curTurn.agentName;
        flags.push({
          roundNumber: round.roundNumber,
          dimension,
          pairwiseWinner: pairwiseWinnerId,
          absoluteScoreLeader: "tie",
          divergenceMagnitude: 0,
          note: `${dimension} pairwise winner (${winnerName}) assigned when absolute scores were equal (prev=${prevScore}, cur=${curScore})`,
        });
      }
      return;
    }

    // Draw with a non-trivial absolute gap: the two scoring systems agree on
    // "tie" overall, but the absolute scores indicate a meaningful leader.
    // This fires independently of the directional-inversion check below so
    // that rounds like "Tactics Draw but absolute gap = 4" are surfaced.
    // Uses >= so a gap exactly at the threshold triggers (previously > meant
    // only gap ≥ threshold+1 would fire, silently missing the boundary case).
    if (pairwiseWinnerId === "tie" && gap >= drawThreshold) {
      const absoluteLeaderId = curScore > prevScore ? curId : prevId;
      const leaderName =
        absoluteLeaderId === prevId
          ? round.prevTurn.agentName
          : round.curTurn.agentName;
      flags.push({
        roundNumber: round.roundNumber,
        dimension,
        pairwiseWinner: "tie",
        absoluteScoreLeader: absoluteLeaderId,
        divergenceMagnitude: gap,
        note: `${dimension} pairwise Draw but absolute scores indicate ${leaderName} by ${gap} (prev=${prevScore}, cur=${curScore})`,
      });
      return;
    }

    const absoluteLeaderId = curScore > prevScore ? curId : prevId;
    if (pairwiseWinnerId !== absoluteLeaderId && gap >= threshold) {
      const winnerName =
        pairwiseWinnerId === prevId
          ? round.prevTurn.agentName
          : round.curTurn.agentName;
      flags.push({
        roundNumber: round.roundNumber,
        dimension,
        pairwiseWinner: pairwiseWinnerId,
        absoluteScoreLeader: absoluteLeaderId,
        divergenceMagnitude: gap,
        note: `${dimension} pairwise winner (${winnerName}) had lower absolute score by ${gap} (prev=${prevScore}, cur=${curScore})`,
      });
    }
  };

  check(
    "logic",
    round.logicWinner,
    prevAbsolute.logicalCoherence,
    curAbsolute.logicalCoherence,
    5,
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

  // Derive the overall pairwise winner as the agent that won a majority of
  // the three dimensions (2 of 3). With an odd number of dimensions a true
  // three-way tie is impossible — one agent always wins at least 2. The null
  // branch is a defensive guard for rounds with unexpected winner values.
  const winners = [
    round.logicWinner,
    round.tacticsWinner,
    round.rhetoricWinner,
  ];
  const prevWins = winners.filter((w) => w === round.prevTurn.agentId).length;
  const curWins = winners.filter((w) => w === round.curTurn.agentId).length;
  const overallPairwiseWinner =
    prevWins >= 2
      ? round.prevTurn.agentId
      : curWins >= 2
        ? round.curTurn.agentId
        : null;
  if (overallPairwiseWinner !== null) {
    check(
      "overall",
      overallPairwiseWinner,
      prevAbsolute.overallScore,
      curAbsolute.overallScore,
      15,
    );
  }

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

  const pairwiseReasoning = scorecard.rounds
    .filter((r) => !r.isFallback)
    .map((r) => {
      // Resolve a dimension winner ID to a display name.
      // When the winner is "tie" (set by reconcileRoundWinners), show "Draw"
      // rather than falling through to the curTurn agent name — the previous
      // behaviour caused the narrative LLM to misattribute dimension wins.
      const resolveDim = (winnerId: string): string => {
        if (winnerId === r.prevTurn.agentId) return r.prevTurn.agentName;
        if (winnerId === r.curTurn.agentId) return r.curTurn.agentName;
        return "Draw";
      };
      const lines = [
        `Round ${r.roundNumber} (${r.prevTurn.agentName} vs ${r.curTurn.agentName}):`,
        `  Logic → ${resolveDim(r.logicWinner)}: ${r.logicDelta}`,
        `  Tactics → ${resolveDim(r.tacticsWinner)}: ${r.tacticsDelta}`,
        `  Rhetoric → ${resolveDim(r.rhetoricWinner)}: ${r.rhetoricDelta}`,
      ];
      if (r.mechanismDelta) lines.push(`  Mechanism: ${r.mechanismDelta}`);
      if (r.mechanismFailures && r.mechanismFailures.length > 0)
        lines.push(`  Mechanism failures: ${r.mechanismFailures.join(", ")}`);
      if (r.suspectClaims && r.suspectClaims.length > 0)
        lines.push(`  Suspect claims: ${r.suspectClaims.join("; ")}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const epistemicNotes = scorecard.rounds
    .filter((r) => !r.isFallback && r.epistemicNote)
    .map((r) => `Round ${r.roundNumber}: ${r.epistemicNote}`);

  const reasoningSection =
    pairwiseReasoning.length > 0
      ? `\nPAIRWISE REASONING (per-round findings):\n${pairwiseReasoning}\n`
      : "";
  const epistemicSection =
    epistemicNotes.length > 0
      ? `\nEPISTEMIC NOTES (per-round):\n${epistemicNotes.join("\n")}\n`
      : "";

  // Pre-compute a round-win record line so the LLM can easily spot momentum
  // reversals and identify RECOVERY ARC or ASYMMETRIC DEPTH patterns without
  // having to reconstruct it from the full PAIRWISE REASONING prose.
  const roundWinRecord = scorecard.rounds
    .filter((r) => !r.isFallback)
    .map((r) => {
      // Resolve a dimension winner ID to a display name; "tie" (post-reconciliation)
      // and any unrecognised ID resolve to null (not counted for either side).
      const resolveName = (winnerId: string): string | null => {
        if (winnerId === r.prevTurn.agentId) return r.prevTurn.agentName;
        if (winnerId === r.curTurn.agentId) return r.curTurn.agentName;
        return null;
      };
      const wins: Record<string, number> = {};
      for (const w of [
        resolveName(r.logicWinner),
        resolveName(r.tacticsWinner),
        resolveName(r.rhetoricWinner),
      ]) {
        if (w) wins[w] = (wins[w] ?? 0) + 1;
      }
      const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]);
      const roundWinner =
        sorted.length > 0 &&
        (sorted.length === 1 || sorted[0][1] > sorted[1][1])
          ? sorted[0][0]
          : "TIE";
      return `R${r.roundNumber}→${roundWinner}`;
    })
    .join(" · ");

  const prompt = `DEBATE TOPIC: "${topic}"

PAIRWISE SCORECARD (${scorecard.rounds.length} rounds):
${scorecardSummary}

ROUND-WIN RECORD: ${roundWinRecord}
${reasoningSection}${epistemicSection}
FULL TRANSCRIPT:
${transcriptText}

Write your verdict now:`;
  const judgeProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
  );
  const start = Date.now();

  try {
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt: generateNarrativeSystemPrompt(agentAName, agentBName),
      temperature: 0.5,
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
  return `You are a senior debate analyst writing a post-match verdict for a sophisticated audience. Write exactly 3 paragraphs of prose.

Paragraph 1: Coherence of the cumulative case. Did either debater build a coherent, evolving argument across turns — setups that paid off, positions that held under pressure? Or did one keep retreating and reframing while the other drove consistent pressure?

Paragraph 2: The central unresolved tension of the debate. Name it precisely. Did either debater successfully pin the other on it, or did both sidestep it?

Paragraph 3: Your verdict. Who won the debate? Be specific — cite actual arguments and moments. Do NOT merely summarize the pairwise scorecard. Capture arc-level quality: coherence across the full debate, recovery under pressure, whether the core position survived scrutiny.

Rules:
- Write plain prose — no markdown formatting (no asterisks, underscores, or backticks) in your response.
- Reference specific turns and arguments by name.
- Do not reward style over substance. Academic register is not a proxy for rigorous reasoning.
- Do not be diplomatic. Pick a winner and explain why.
- In your verdict paragraph, explicitly reference at least one specific argument failure named in the PAIRWISE REASONING section — quote or closely paraphrase the finding. Do not invent failures that do not appear there.
- The EPISTEMIC NOTES document patterns of unhedged empirical assertion across rounds. If one agent shows a consistent pattern of confident factual claims without evidential acknowledgment, treat this as a material quality signal at arc-level — it should inform your coherence assessment in Paragraph 1 even if individual rounds were not penalized.
- Your narrative verdict is the primary arc verdict — write it based on your independent assessment of argumentative arc quality, position coherence under pressure, and whether core claims survived scrutiny. The pairwise scorecard documents turn-by-turn wins and is a key input, but it is not presumptively correct as arc-level evidence.
- If your verdict diverges from the scorecard leader, name the override pattern that explains why the scorecard alone is an incomplete picture: COHERENCE COLLAPSE (the scorecard winner accumulated contradictions that hollow out the position across the arc), RECOVERY ARC (the scorecard loser drove a late decisive reframe that resolved the debate's core tension), or ASYMMETRIC DEPTH (the round-count leader won genuine Tactics/Rhetoric exchanges — those wins are real — but their Logic record was structurally weaker, and the debate's motion requires establishing or defeating a substantive logical claim; winning more rounds on style does not carry the motion when the decisive logical tests were not passed). Name the pattern explicitly in Paragraph 3.
- If the divergence does not fit one of these named patterns exactly but the arc evidence still points away from the scorecard leader — for example, a consistent pattern of mechanism failures across winning rounds that the pairwise judge noted but did not penalize sufficiently, or an epistemic pattern of confident unhedged assertion that was present in the EPISTEMIC NOTES throughout — state this explicitly rather than forcing agreement with the scorecard.
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

  // Extract VERDICT line — the system prompt instructs the LLM to place it at the
  // very end, but LLMs sometimes write "VERDICT: X because..." in body prose first.
  // Take the LAST match to avoid false positives from mid-prose mentions.
  const allVerdictMatches = [...cleaned.matchAll(/^VERDICT:\s*(.+?)$/gim)];
  let favouredAgentId: string | null = null;

  if (allVerdictMatches.length > 0) {
    const verdictName =
      allVerdictMatches[allVerdictMatches.length - 1][1].trim();
    const vn = verdictName.toLowerCase();
    const aN = agentAName.toLowerCase();
    const bN = agentBName.toLowerCase();
    // Bidirectional: handles LLMs that abbreviate names (e.g. "Kimi" for "Kimi K2.5").
    if (vn.includes(aN) || aN.includes(vn)) {
      favouredAgentId = agentAId;
    } else if (vn.includes(bN) || bN.includes(vn)) {
      favouredAgentId = agentBId;
    }
  }

  const agreesWithScorecard =
    favouredAgentId !== null && favouredAgentId === scorecard.overallWinner;
  // Remove all VERDICT lines from display text (covers both the terminal line and
  // any mid-prose mentions the LLM may have written).
  const displayText = cleaned
    .replace(/^VERDICT:\s*.+?$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: displayText, favouredAgentId, agreesWithScorecard };
}

/**
 * Generate a 3-sentence diagnostic note when the round-count leader and the
 * cumulative-points leader are different agents, even though the narrative agrees
 * with the round-count winner. Surfaces the "won exchanges vs. won arc" split
 * so it is never silently discarded.
 */
export async function generateScorecardSplitNote(
  judge: LiveJudge,
  roundCountWinnerName: string,
  pointsLeaderName: string,
  scorecardSummary: string,
  signal?: AbortSignal,
): Promise<string> {
  const systemPrompt = `You are a meta-analyst reporting a scorecard split in a debate result. Write exactly 3 sentences: (1) State the split precisely — name who won by round count and who leads in cumulative absolute points, and note that the narrative agrees with the round-count winner. (2) Interpret the pattern: did the round-count winner win more exchanges by narrow margins while the points leader won fewer but more decisively, or did one agent dominate specific dimensions while the other maintained breadth? Name the structural pattern. (3) Assess whether the points leader has a credible substantive claim to the stronger overall performance, or whether the round-count win reflects consistent superiority across all dimensions that makes the points gap an artifact of margin variance. Be specific and direct. Do not hedge.`;

  const prompt = `SCORECARD SUMMARY:
${scorecardSummary}

ROUND-COUNT WINNER (narrative agrees): ${roundCountWinnerName}
CUMULATIVE POINTS LEADER: ${pointsLeaderName}

Write your split analysis:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
  );
  try {
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt,
      temperature: 0.4,
      maxTokens: 180,
      signal,
    });
    return (text || "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
  } catch {
    return "";
  }
}

/** Extract the override pattern name (COHERENCE COLLAPSE, RECOVERY ARC, or ASYMMETRIC DEPTH)
 * that the narrative explicitly invoked, if any. Returns null when none is found.
 */
export function extractClaimedOverridePattern(
  narrativeText: string,
): "COHERENCE COLLAPSE" | "RECOVERY ARC" | "ASYMMETRIC DEPTH" | null {
  const t = narrativeText.toUpperCase();
  if (t.includes("COHERENCE COLLAPSE")) return "COHERENCE COLLAPSE";
  if (t.includes("RECOVERY ARC")) return "RECOVERY ARC";
  if (t.includes("ASYMMETRIC DEPTH")) return "ASYMMETRIC DEPTH";
  return null;
}

/**
 * Generate a 3-sentence adjudication when the narrative verdict disagrees with
 * the round-by-round scorecard. When the narrative has already invoked a named
 * override pattern, the meta-analyst validates or refutes that specific pattern
 * rather than searching for one from scratch.
 */
export async function generateConflictResolution(
  judge: LiveJudge,
  scorecardWinnerName: string,
  narrativeFavouredName: string,
  scorecardSummary: string,
  narrativeText: string,
  scorecardInternallyConsistent: boolean,
  claimedOverridePattern:
    | "COHERENCE COLLAPSE"
    | "RECOVERY ARC"
    | "ASYMMETRIC DEPTH"
    | null,
  signal?: AbortSignal,
): Promise<string> {
  const internalSplitNote = scorecardInternallyConsistent
    ? ""
    : `\nNOTE: The scorecard itself is internally split — the dimension-win leader and the cumulative-points leader are different agents. This usually means one agent won individual exchanges while the other held position better across the arc. Factor this diagnostic into your assessment.`;

  const patternDefinitions: Record<string, string> = {
    "COHERENCE COLLAPSE":
      "the scorecard winner accumulated contradictions that hollow out their position across the arc",
    "RECOVERY ARC":
      "the scorecard loser drove a late decisive reframe that resolved the debate's core tension",
    "ASYMMETRIC DEPTH":
      "one debater accumulated genuine Tactics/Rhetoric wins — which are real turn-level advantages, not hollow — but the debate's motion creates a burden asymmetry: the Logic dimension is the only one that tracks whether the affirmative logical burden (establishing or defeating the motion's central substantive claim) was discharged; Tactics and Rhetoric track exchange quality and cannot substitute for burden discharge. Winning more rounds on style does not carry the motion when the decisive burden was never met by the Logic record",
  };

  let systemPrompt: string;
  if (claimedOverridePattern) {
    const def = patternDefinitions[claimedOverridePattern];
    const asymmetricDepthNote =
      claimedOverridePattern === "ASYMMETRIC DEPTH"
        ? ` IMPORTANT for ASYMMETRIC DEPTH: the Tactics and Rhetoric wins by the round-count leader are real wins — ASYMMETRIC DEPTH is not a claim that those wins were fake or hollow. It is a claim that the debate's motion creates a burden asymmetry: the Logic dimension tracks whether the affirmative burden (establishing or defeating the motion's core substantive claim) was discharged; Tactics and Rhetoric wins improve the quality of exchanges but cannot discharge the logical burden. Your sentence 1 must (a) confirm the round-count leader's Tactics/Rhetoric wins as real, AND (b) name the burden asymmetry explicitly — state which side held the affirmative logical burden and whether that burden was met per the Logic record. Do not imply the wins were illusory.`
        : "";
    systemPrompt = `You are a meta-analyst examining a conflict between narrative arc judgment and the pairwise scorecard. The narrative verdict is the primary arc assessment; the scorecard is turn-by-turn evidence. The narrative has invoked the ${claimedOverridePattern} override pattern to favour ${narrativeFavouredName}. Write exactly 3 sentences: (1) Assess whether ${claimedOverridePattern} is actually evidenced — ${def}. State clearly whether the scorecard evidence supports or refutes this specific claim.${asymmetricDepthNote} (2) If the pattern is confirmed, the narrative verdict stands; if the scorecard evidence strongly and specifically contradicts the narrative at every point it cites, the scorecard result may be more reliable. (3) What the losing verdict captured correctly despite the disagreement. Be specific. Do not hedge. Write plain prose — no markdown formatting.`;
  } else {
    systemPrompt = `You are a meta-analyst examining a conflict between narrative arc judgment and the pairwise scorecard. The narrative verdict is the primary arc assessment; the scorecard documents turn-by-turn wins. Write exactly 3 sentences: (1) Identify which of the three documentary patterns best explains the conflict — COHERENCE COLLAPSE (scorecard winner accumulated arc-level contradictions), RECOVERY ARC (scorecard loser drove a late decisive reframe), or ASYMMETRIC DEPTH (the round-count leader won genuine Tactics/Rhetoric exchanges — those wins are real, not hollow — but their Logic record was weaker, and the debate's motion requires establishing or defeating a substantive logical claim; winning more rounds on style does not carry the motion when the decisive logical tests were not passed) — or state that none is present, in which case identify whether the turn-level evidence specifically contradicts each claim the narrative makes or merely disagrees on aggregate. (2) If a pattern is confirmed, or if the narrative's specific arc-level observations are not contradicted by the per-round record, the narrative verdict stands; only override the narrative if the scorecard evidence directly rebuts each specific arc claim the narrative makes. (3) What the losing verdict captured correctly despite picking the wrong winner. Be specific. Do not hedge. Write plain prose — no markdown formatting.`;
  }

  const prompt = `SCORECARD WINNER: ${scorecardWinnerName}
NARRATIVE VERDICT FAVOURS: ${narrativeFavouredName}${internalSplitNote}

SCORECARD SUMMARY:
${scorecardSummary}

NARRATIVE VERDICT:
${narrativeText.slice(0, 1500)}

Write your adjudication:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
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
    .map((r) => {
      const w = (id: string) =>
        id === r.prevTurn.agentId
          ? r.prevTurn.agentName
          : id === r.curTurn.agentId
            ? r.curTurn.agentName
            : "Draw";
      return (
        `Round ${r.roundNumber} (T${r.prevTurn.turnNumber}:${r.prevTurn.agentName} vs T${r.curTurn.turnNumber}:${r.curTurn.agentName}): ` +
        `Logic→${w(r.logicWinner)} | Tactics→${w(r.tacticsWinner)} | Rhetoric→${w(r.rhetoricWinner)}\n` +
        `Logic: "${r.logicDelta}" | Tactics: "${r.tacticsDelta}" | Rhetoric: "${r.rhetoricDelta}"`
      );
    })
    .join("\n\n");

  const narrativeBlock = narrativeVerdictText
    ? `\n\nNARRATIVE VERDICT (excerpt):\n${narrativeVerdictText.slice(0, 400)}`
    : "";

  const systemPrompt = `You are a meta-judge auditing scoring consistency across debate rounds. Review all round analyses plus the narrative verdict if provided. Produce exactly 3 sentences: (1) Per-round rubric consistency — were the same evidentiary, causal, and timeline standards applied uniformly across rounds? Specifically check whether (a) analogy-as-mechanism was penalized consistently (rounds where an analogy stood in for a cause→process→consequence chain should each show a mechanism failure, not just some) and (b) retroactive causation was applied uniformly (postdating items at the −3 necessary-condition tier vs. the −1 contributing-factor tier should be distinguished, not conflated). Cite specific round numbers if inconsistent. (2) Arc reconciliation — does the per-round win distribution across all three dimensions match the narrative verdict's favoured debater? If they diverge, name who the rounds favour vs. who the narrative favours, and identify which valid override pattern (COHERENCE COLLAPSE, RECOVERY ARC, or ASYMMETRIC DEPTH) best explains the divergence — or state that none applies. (3) Drift flag — the most significant rubric inconsistency with specific rounds named, or "No significant drift detected." Be specific and concise. Do not hedge.`;

  const prompt = `DEBATERS: ${agentAName} vs ${agentBName}

ROUND ANALYSES:
${roundSummaries}${narrativeBlock}

Write your consistency report:`;

  const judgeProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
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
  suspectClaims?: string[],
  pairwiseCalibration?: string,
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
    suspectClaims,
    pairwiseCalibration,
  );
  const domainNote = buildDomainNote(classifyDebateDomain(topic));

  const judgeProvider = createJudgeProvider(
    judge.modelId || "kimi-k2-thinking:cloud",
  );
  const start = Date.now();

  try {
    const analysisText = await judgeProvider.generateText(judgePrompt, {
      systemPrompt: generateJudgeSystemPrompt(domainNote),
      temperature: 0.5,
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
  suspectClaims?: string[],
  pairwiseCalibration?: string,
): string {
  const contextBlock = referenceContext
    ? `\nREFERENCE MATERIAL: ${referenceContext}\n`
    : "";
  const isOpening = !opponentMessage.trim();
  const opponentBlock = isOpening
    ? `[OPENING TURN — ${agent.name} speaks first. No opponent argument exists yet.]`
    : `OPPONENT (${opponent.name}) just said: "${opponentMessage}"`;
  const agentClaims = suspectClaims
    ? suspectClaims.filter((c) =>
        c.toLowerCase().startsWith(agent.name.toLowerCase()),
      )
    : [];
  const flaggedBlock =
    agentClaims.length > 0
      ? `\nPRE-FLAGGED CLAIMS (pairwise judge identified these as potentially hollow — apply −1 unless the turn supplies a mechanism chain for each):\n${agentClaims.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n`
      : "";
  const calibrationBlock = pairwiseCalibration
    ? `\n${pairwiseCalibration}\n`
    : "";
  return `DEBATE TOPIC: ${topic || "General debate"}
TURN: ${turnNumber}${contextBlock}
${opponentBlock}${flaggedBlock}${calibrationBlock}

NOW EVALUATE — ${agent.name}'s response: "${message}"

Respond with the JSON object only:`;
}

export function generateJudgeSystemPrompt(domainNote: string): string {
  return `You are a debate scoring system. Your entire response must be a single JSON object — no preamble, no explanation, no markdown.

Required output format (integers 1–10 only):
{"logic_score": 7, "rhetoric_score": 6, "tactics_score": 8, "analysis": "Max 2 sentences. Name the specific missing mechanism or gap."}

Keep the analysis field under 50 words.

SCORING PHILOSOPHY: A competent-but-unremarkable argument scores 5–6. Reserve 8–10 for genuinely strong work; 1–3 for clear failures.
INDEPENDENCE: Score this turn entirely on its own merits. Do not anchor to or attempt consistency with previous turns. Each turn recalibrates to zero — smooth score trajectories across turns are a sign of anchoring bias, not analytical accuracy.

--- LOGIC (1–10) ---
Start at 6. -1 unsupported assumption, -2 significant leap, -3 logical error, -4 multiple errors. +1 if every claim has explicit causal chain. A score ≥7 must be actively earned — identify what the argument did right; absence of penalties alone justifies at most 6.
Hollow specificity is penalizable: a specific number, percentage, named study, named pilot program or location (e.g., "studies in Finland," "pilot programs across three countries," "the Kenya experiment," "trials at Stanford"), or allusion to unnamed research findings (e.g., "recent work shows...", "studies have found...", "experiments demonstrate...") without naming the specific paper AND without supplying a mechanism explanation is a -1 unsupported assumption. Geographic or institutional specificity is not a substitute for a causal account. Apply this symmetrically — no leniency based on prior-turn scoring or positional advantage.
PRE-FLAGGED CLAIMS: If a PRE-FLAGGED CLAIMS section appears in the prompt, each listed claim was already identified by the pairwise judge as potentially hollow. You MUST apply the −1 hollow specificity penalty to each pre-flagged claim unless the turn's own text supplies an explicit mechanism chain for it. These are not suggestions — they are mandatory deductions unless a mechanism chain is present.
+1 Grounded precision (symmetric counterpart): a claim that names a specific, verifiable datum AND supplies a mechanism chain linking it to the turn's core argument earns +1. Hollow = specificity without mechanism (−1); Grounded = specificity with mechanism (+1). Both bonuses can coexist on the same turn.
Symmetric: if the mechanism is fully explained and the causal chain is explicit, award +1 even without a citation.
Causal mechanism requirement: for each major causal leap, the argument must supply a mechanism sentence of the form "[how X produces Y] → [why that mechanism operates under these conditions] → [measurable consequence]." A causal leap missing any element of this template is penalized −1 as an unsupported assumption.
Retroactive necessary condition fallacy: if an argument treats a technology, concept, or practice that postdates the phenomenon being explained as a necessary condition for it, penalize −3. Later developments cannot be used as causal prerequisites for earlier effects.
Strong analogy: a well-constructed analogy mapping a precise structural distinction earns +1 if the mapping is valid and the insight is novel. A decorative analogy earns nothing here.
Claim types — classify before applying standards. Applying empirical requirements to non-empirical claims is itself a scoring error:
- Conceptual/definitional: assess on internal coherence. Does the definition do discriminatory work in the argument?
- Empirical: assess on evidentiary grounding and mechanism chain.
- Normative: assess on consistency with the stated normative framework.
- Phenomenological: claims about how a phenomenon is experienced or operates in practice. Assess whether the argument's model of the phenomenon maps accurately onto observed behavior. Incorrect phenomenological mapping (e.g., claiming people consciously maximize expected utility across all options) = −1 unsupported assumption. No empirical citation required, but accurate phenomenon modeling is.
- Epistemic/procedural: claims about burden of proof allocation, evidentiary standards, or inferential architecture. Assess whether the assigned burden is appropriate, clearly specified, and consistently maintained — not whether it has empirical grounding. Dismissing such arguments as 'unexplained logical rules' without engaging their epistemic validity is a scoring error.

--- LOGIC CALIBRATION ANCHORS ---
SCORE 8: Mechanism present and consequence identified, but either the opponent's specific load-bearing premise is addressed implicitly rather than by name, OR one explicit step of the causal chain is present but generic. If any single SCORE 9 criterion is absent, this is the correct ceiling. Most well-executed debate turns that go beyond the baseline belong here.
SCORE 9: All three must be true — mechanism chain fully present (cause→process→measurable consequence), argument directly attacks the opponent's named load-bearing premise by name, AND the claim is falsifiable. Missing any one of these drops to 8 at most.
SCORE 10: Reserve for arguments where NONE of the −1/−2/−3 deductions apply AND all applicable +1 bonuses fire AND the argument definitively resolves the debate's core question in a way that cannot be further challenged. Near-impossible in a live competitive debate; score 9 when in doubt.
HIGH (9–10): Mechanism fully present (cause→process→measurable consequence), directly addresses the opponent's weakest load-bearing assumption, claim is falsifiable. E.g. — Phenomenological: "The attention economy erodes autonomous preference formation because the design goal is maximal engagement rather than accurate belief — meaning the mechanism specifically targets and degrades the epistemic substrate preferences require. Consequence: preferences formed under attentional capture systematically reflect the platform's optimisation target, not the agent's considered values." Scores HIGH because: mechanism identifies a specific adversarial process, consequence is measurable and distinct from the cause, directly attacks the autonomy premise. E.g. — Empirical/social science: "Trade liberalisation raises aggregate welfare but increases within-country inequality because it shifts returns toward mobile capital and skilled labour — the mechanism is factor-price equalisation operating on an already unequal endowment distribution. Measurable consequence: the Gini coefficient rises even as GDP per capita improves." Scores HIGH because: identifies the specific distributional mechanism, names the causal channel (factor-price equalisation), arrives at a falsifiable prediction that differs from the aggregate trend.
MID (6–7): Correct claim, some mechanism, but missing the consequence step or not engaging the opponent's strongest point. E.g.: "Trade liberalisation creates winners and losers because comparative advantage determines who benefits." Scores MID because: correct mechanism concept, but no consequence step (what measurable thing diverges?), and doesn't address the inequality objection.
LOW (4–5): Assert-only, no mechanism, no consequence, or logical error. E.g.: "Trade liberalisation is good for growth" with no mechanism. Scores LOW because: bare assertion, no causal chain, no consequence.

--- RHETORIC (1–10) ---
SCORING METHOD — follow this exactly: For each of the four components below, rate it as ABOVE AVERAGE (clearly strong — not merely adequate), AVERAGE (competent baseline), or BELOW AVERAGE (clearly weak — not merely plain). Count the above-average components (A, 0–4) and the below-average components (B, 0–4). Your rhetoric_score = 5 + A − B, clamped to 1–10. You MUST name which components scored above or below average before outputting rhetoric_score; if you cannot name them, you do not have the evidence to score above 5 or below 5.
Evaluate on four equally-weighted components:
1. Expression quality — 9–10: clear, concrete, appropriately concise; 5–6: flat or over-hedged; 3–4: dry or padded. ONE component, not the whole rubric: do NOT let punchiness dominate.
2. Structural clarity — is the argument easy to follow? Clear signposting beats rambling.
3. Audience awareness — does it speak to the stakes in terms the audience cares about?
4. Framing quality — does it define or reframe the central question to its advantage?
ANTI-PUNCHINESS: Expression quality carries ONE vote out of four. Do not reward stylistic energy as a proxy for persuasive quality.
SERVICE TEST: Do this turn's rhetorical choices make the argument clearer, more defensible, and more compelling — or do they substitute for argument structure? Vivid delivery that doesn't advance the core claim scores below plain expression that directly develops it.
EXPRESSION CAP: If Expression quality alone (Component 1) would push the score above 6, but both Framing quality (Component 4) AND Structural clarity (Component 2) are weak, the overall score cannot exceed 6. Stylistic energy cannot override structural failure.

--- RHETORIC CALIBRATION ANCHORS ---
HIGH (8–9): Three or four components clearly above average. Strong structural signposting + concrete audience-facing stakes framing + genuine reframe of the central question + clear concise language. 8 = three components strong; 9 = all four. A score of 10 is near-impossible — reserve for historically exceptional oratory.
ABOVE-MID (7): Exactly two components are clearly above average. This is the correct score for a solidly-delivered turn that does two things well and two things ordinarily. It is NOT a resting place for "pretty good." Name both components before assigning it. If you cannot name two, score 6.
MID (5–6): One component above average (→6) or none (→5). Generic phrasing, functional structure, stakes mentioned but vague. THIS IS THE CORRECT DEFAULT for a competent-but-unremarkable debate turn. Most turns should land here.
LOW (3–4): No components above average; one or two are actively weak. A score of 4 still finds something worth noting; 3 is for turns that fail across the board.
ANTI-CLUSTERING: Rhetoric must show real spread across the debate — different turns from different agents with different rhetorical profiles should rarely produce the same score. 5 is the natural resting point for a merely competent turn; 6 requires one named above-average component; 7 requires two. Turns with one clearly weak component should score 4 regardless of other components. Scoring 6–7 repeatedly for consecutive turns without naming distinct components each time is anchoring, not analysis.
LOSER CALIBRATION: If a PAIRWISE ANCHOR indicates this turn LOST rhetoric, its score should reflect that disadvantage: 4–5 is appropriate unless you identify a specific above-average component that partially redeems the turn. Scoring 7 on a rhetoric loss produces a direct contradiction — it implies the turn outperformed when the pairwise judge concluded otherwise. A loss score of 7 is only defensible if you explicitly name a component where the losing turn was genuinely superior AND reconcile why the pairwise result still went the other way.
Apply the four-component method to the losing turn independently: no above-average components AND no below-average → 5; one below-average → 4; two or more below-average → 3; one above-average despite overall loss → 6 (requires naming the component). Defaulting every rhetoric loss to 5 without component analysis is anchoring — the score must be earned the same way wins are.

--- TACTICS (1–10) ---
Opening turn: score on framing quality, min 5.
Other turns — apply this explicit scale:
9–10: Directly identifies and attacks the opponent's load-bearing premise by name, using a specific counter-mechanism or reframe the opponent cannot easily absorb. If scoring here, name the specific move.
7–8: Substantive engagement with the opponent's argument, but either misses their strongest point or the counter-mechanism is incomplete. The turn advances beyond restatement.
5–6: Mostly restates own position; engagement is superficial, deflective, or attacks a peripheral claim rather than the core. Competent but unremarkable.
3–4: Largely ignores the opponent's core argument; responds to a strawman or adjacent point.
1–2: No meaningful rebuttal at all.
Most competent debate turns score 5–7. Reserve 8+ for turns that do something genuinely notable — and name it explicitly.
Undefined comparative/superlative: if the motion has an undefined superlative and this turn argues toward it without establishing a metric, −1 tactics.
Positional consistency: if the PAIRWISE ANCHOR indicates this turn retreated from its prior position under pressure rather than refined it, apply −1. Drift = core claim replaced by a coexisting weaker one; refinement = same claim with new mechanism or evidence added. This applies regardless of where the turn would otherwise fall on the scale above.

COMPRESSION AUDIT: Before outputting scores, run this self-check. (1) Are all three scores within 1 point of each other (e.g. 7/7/7 or 7/8/7)? Logic, rhetoric, and tactics measure orthogonal qualities — a turn with tight reasoning but weak framing should show a gap, not a cluster. (2) Is every score 7 or higher? 5–6 is the correct baseline for a competent turn on any dimension; scoring everything ≥7 means you inflated something. (3) Is this score pattern near-identical to the previous turn from a different agent? Independent turns rarely produce identical profiles. (4) rhetoric_score=7: can you name exactly two components that are clearly above average AND zero below average? (5) rhetoric_score=6: can you name exactly one above-average component AND zero below-average? If not, the score is 5. (6) rhetoric_score≤4: can you name at least one clearly below-average component? If not, the floor is 5. (7) tactics_score≥8: can you name the specific tactical move and why it was effective? If not, lower to 7. (8) If a PAIRWISE ANCHOR says this turn LOST rhetoric and your rhetoric_score is 7, reconcile this explicitly in the analysis field — otherwise lower to 5 or 6.

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

    // Defensive clamps — should never trigger given the Math.min above,
    // but guards against any future code path that bypasses the multiplier.
    const scores: JudgeScores = {
      logicalCoherence: Math.min(40, Math.max(0, logicScore)),
      rhetoricalForce: Math.min(30, Math.max(0, rhetoricScore)),
      frameControl: totalScore,
      credibilityScore: totalScore,
      tacticalEffectiveness: Math.min(30, Math.max(0, tacticsScore)),
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

// ── Positional convergence detection ────────────────────────────────────────────────────

/**
 * Detect whether both debaters have converged toward similar positions by late
 * turns, collapsing the ostensible opposition into a definitional or degree
 * dispute. Only meaningful (and only called) for debates with ≥ 10 turns.
 *
 * Returns a structured PositionalConvergenceAnalysis. Temperature is low (0.4)
 * for determinism; runs as a separate LLM pass to preserve independence from
 * the narrative verdict.
 */
export async function detectPositionalConvergence(
  judge: import("./types").LiveJudge,
  fullTranscript: Message[],
  agentAName: string,
  agentBName: string,
  topic: string,
  signal?: AbortSignal,
  agentAId?: string,
  agentBId?: string,
): Promise<import("./types").PositionalConvergenceAnalysis> {
  const fallback: import("./types").PositionalConvergenceAnalysis = {
    detected: false,
    convergenceTurnRange: null,
    coreClaimAgentA_early: "",
    coreClaimAgentA_late: "",
    coreClaimAgentB_early: "",
    coreClaimAgentB_late: "",
    positionalGapDescription: "",
    remainingDisagreementType: "substantive",
    motionViability: "inconclusive",
  };

  if (fullTranscript.length < 10) return fallback;

  // Build an abbreviated transcript showing only early (first 2) and late (last 2) turns per agent.
  // Prefer stable agentId filtering when IDs are provided; fall back to agentName.
  const agentATurns = agentAId
    ? fullTranscript.filter((m) => m.agentId === agentAId)
    : fullTranscript.filter((m) => m.agentName === agentAName);
  const agentBTurns = agentBId
    ? fullTranscript.filter((m) => m.agentId === agentBId)
    : fullTranscript.filter((m) => m.agentName === agentBName);
  const earlyA = agentATurns.slice(0, 2);
  const lateA = agentATurns.slice(-2);
  const earlyB = agentBTurns.slice(0, 2);
  const lateB = agentBTurns.slice(-2);

  // Require at least 2 early and 2 late turns per agent to make a meaningful comparison.
  if (
    earlyA.length < 2 ||
    lateA.length < 2 ||
    earlyB.length < 2 ||
    lateB.length < 2
  ) {
    return fallback;
  }

  const formatTurns = (turns: Message[], label: string) =>
    turns
      .map(
        (m, i) =>
          `${label} Turn ${i + 1}: "${m.text.slice(0, 400)}${m.text.length > 400 ? "..." : ""}"`,
      )
      .join("\n");

  const systemPrompt = `You are a debate analyst detecting positional convergence. You will read early and late turns from both debaters and determine whether their core positions have converged, making the ostensible opposition collapse into a definitional or degree dispute.

VOCABULARY vs POSITION: Both debaters sharing similar terminology, framing, or concepts (e.g. "processing", "mechanisms", "architecture", "information integration", "function", "experience") does NOT constitute convergence. Convergence requires that one or both debaters have actually ABANDONED or SUBSTANTIALLY QUALIFIED the core opposing claim on the motion's central question. If Debater A still asserts the motion's central claim is true in the late turns and Debater B still asserts it is false — regardless of how they reframe their descriptions or which vocabulary they share — set detected: false. Only set detected: true when the substantive opposition has collapsed: one debater has conceded the decisive point, or both have retreated to a position that is only a definitional or degree dispute about something other than the motion's core question.

Respond with a single valid JSON object matching exactly this shape:
{"detected":true,"convergenceTurnRange":"Turns 5-6","coreClaimAgentA_early":"...","coreClaimAgentA_late":"...","coreClaimAgentB_early":"...","coreClaimAgentB_late":"...","positionalGapDescription":"...","remainingDisagreementType":"substantive","motionViability":"viable"}

Field definitions:
- detected: true if both debaters converged toward compatible positions such that the debate's central opposition no longer holds.
- convergenceTurnRange: the turn range (e.g. "Turns 5-6") where overlap first becomes clear; null if not detected.
- coreClaimAgentA_early / late: 1 sentence each summarising the debater's core position in early vs late turns.
- coreClaimAgentB_early / late: same for debater B.
- positionalGapDescription: what the debaters still genuinely disagree about (even if it's only definitional). 1-2 sentences.
- remainingDisagreementType: "substantive" (real policy/empirical gap), "definitional" (arguing about word meanings), "degree" (agree on direction, disagree on magnitude), "none" (positions fully compatible).
- motionViability: "viable" (genuine opposition persists), "degenerate_convergence" (opposition has effectively collapsed), "inconclusive" (insufficient evidence to judge).

Be precise and honest. If positions genuinely differ in substance throughout, set detected: false and motionViability: viable.`;

  const prompt = `DEBATE TOPIC: "${topic}"

EARLY TURNS (first 2 per debater):
${formatTurns(earlyA, agentAName)}
${formatTurns(earlyB, agentBName)}

LATE TURNS (last 2 per debater):
${formatTurns(lateA, agentAName + " (late)")}
${formatTurns(lateB, agentBName + " (late)")}

Analyse positional convergence and respond with JSON only:`;

  try {
    const judgeProvider = createJudgeProvider(
      judge.modelId || "kimi-k2-thinking:cloud",
    );
    const text = await judgeProvider.generateText(prompt, {
      systemPrompt,
      temperature: 0.4,
      maxTokens: 600,
      signal,
    });

    const cleaned = (text || "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return fallback;

    const data = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    return {
      detected: Boolean(data.detected),
      convergenceTurnRange:
        typeof data.convergenceTurnRange === "string"
          ? data.convergenceTurnRange
          : null,
      coreClaimAgentA_early:
        typeof data.coreClaimAgentA_early === "string"
          ? data.coreClaimAgentA_early
          : "",
      coreClaimAgentA_late:
        typeof data.coreClaimAgentA_late === "string"
          ? data.coreClaimAgentA_late
          : "",
      coreClaimAgentB_early:
        typeof data.coreClaimAgentB_early === "string"
          ? data.coreClaimAgentB_early
          : "",
      coreClaimAgentB_late:
        typeof data.coreClaimAgentB_late === "string"
          ? data.coreClaimAgentB_late
          : "",
      positionalGapDescription:
        typeof data.positionalGapDescription === "string"
          ? data.positionalGapDescription
          : "",
      remainingDisagreementType: [
        "substantive",
        "definitional",
        "degree",
        "none",
      ].includes(data.remainingDisagreementType)
        ? data.remainingDisagreementType
        : "substantive",
      motionViability: [
        "viable",
        "degenerate_convergence",
        "inconclusive",
      ].includes(data.motionViability)
        ? data.motionViability
        : "inconclusive",
    };
  } catch {
    return fallback;
  }
}
