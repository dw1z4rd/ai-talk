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
  type HarmonizationFlag,
  type OpenFlag,
  JUDGE_SPECIALIZATION_CONFIGS,
} from "./types";
import type { Agent, Message } from "$lib/agents";
import {
  analyzeTurn,
  calculateMomentumShift,
  calculateFrameControlShift,
  createFallbackAnalysis,
  compareTurns,
  updateScorecard,
  synthScoresFromPairwise,
  applyPairwiseFloors,
  generateNarrativeVerdictText,
  generateConflictResolution,
  extractClaimedOverridePattern,
  generateScorecardSplitNote,
  generateRubricHarmonization,
  computeHarmonizationFlags,
  reconcileRoundWinners,
  detectPositionalConvergence,
} from "./analysis";
import { generateAdaptivePressure, generateHiddenDirective } from "./pressure";
import { MODEL_CATALOG } from "$lib/agents";

// CJK character range used to clean non-English leakage from judge model output.
const CJK_CLEAN_RE = /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g;

// ── Harmonization helpers ─────────────────────────────────────────────────────

/**
 * Returns prevTurn's historical absolute scores re-clamped to the pairwise
 * band the judge actually assigned it in `round`.
 *
 * The structural tension in the sliding-window design is that a turn's frozen
 * per-turn absolute score (set when it was curTurn) may sit in the wrong band
 * for a later round where it appears as prevTurn with the opposite outcome.
 * Passing the raw history score to computeHarmonizationFlags then fires a
 * spurious "absolute score leader disagrees with pairwise winner" flag.
 *
 * Contextualizing by calling applyPairwiseFloors with prevTurn in the "cur"
 * slot places prevTurn's score in the band consistent with this round's
 * outcome — so harmonization only flags genuine inconsistencies, not
 * structural ones.
 *
 * absoluteScoreHistory is NOT mutated; this contextualized copy is used solely
 * for harmonization flag computation.
 */
function contextualizeScoreForRound(
  round: PairwiseRound,
  prevHistScore: JudgeScores | undefined,
): JudgeScores | undefined {
  if (!prevHistScore || round.isFallback) return prevHistScore;
  return applyPairwiseFloors(
    round.logicWinner,
    round.tacticsWinner,
    round.rhetoricWinner,
    round.prevTurn.agentId, // prevTurn plays "cur" so its scores get clamped
    round.curTurn.agentId,
    prevHistScore,
  );
}

// ── Judge model selection ─────────────────────────────────────────────────────

const JUDGE_MODEL_ID = "kimi-k2:1t-cloud";

/**
 * Always returns Kimi K2 as the judge model.
 */
export function selectJudgeModel(_excludeModelIds: string[]): string {
  return JUDGE_MODEL_ID;
}

// ── Calibration anchor builder ────────────────────────────────────────────────

/**
 * Build a pairwise-calibration anchor string for the absolute scoring prompt.
 * Extracted from processTurn to avoid re-creating a closure on every turn.
 */
function buildDimAnchor(
  dimension: string,
  winFloor: number,
  winner: string,
  curAgentId: string,
  curAgentName: string,
  prevAgentName: string,
): string {
  const dim = dimension.toLowerCase();
  if (winner === curAgentId) {
    const rhetoricNote =
      dimension === "Rhetoric"
        ? ` Use the four-component method: count above-average components (A) and below-average components (B); score = 5+A−B. A clear win (A≥2, B=0) should score 7–8; a dominant win (A≥3) should score 8–9. Scoring exactly ${winFloor} every time signals anchoring — name the components that justify the actual score.`
        : "";
    const logicNote =
      dimension === "Logic"
        ? ` LOGIC WIN — override "Start at 6": use 8 as your baseline for a clear mechanism win. Graduated scoring: 9 = decisive win — complete cause→process→consequence chain AND opponent's load-bearing premise explicitly named and refuted; 8 = clear win — own mechanism complete and causally connected, opponent's gap identified or exploited; USE THIS for competitive rounds where both turns argued well but this turn's mechanism was more complete or precise — a win in a competent exchange scores 8, not 7; 7 = narrow win — THIS TURN's own mechanism is incomplete (missing a causal link or consequence step), but structurally stronger than the opponent's; reserve 7 for cases where the win comes from relative strength despite a gap in your own argument's chain; 6 = barely wins — both mechanisms incomplete, winner only on minor framing differences, requires explicit reconciliation. IMPORTANT: score 7 only when THIS TURN's own argument has a missing step — if this turn supplied a complete mechanism that dissolved the opponent's regress or closed their gap, score 8 or 9.`
        : "";
    return `PAIRWISE ANCHOR — ${dimension}: the comparative judge gave the WIN to ${curAgentName} (this turn). Your ${dim}_score should be ≥ ${winFloor}.${rhetoricNote}${logicNote} Scoring below ${winFloor} would directly contradict the comparative judge's finding — only do so if you identify a specific failure the comparative judge explicitly overlooked.`;
  } else if (winner === "tie") {
    const rhetoricNote =
      dimension === "Rhetoric"
        ? ` Both turns competed evenly on rhetoric — neither should score dramatically above or below 5–6.`
        : "";
    const logicNote =
      dimension === "Logic"
        ? ` LOGIC DRAW — override "Start at 6": use 5 as your baseline. Expected range is 5–6; both turns supplied comparable mechanism quality. Scoring 7 requires naming a specific above-average element not captured by the draw result; ≥8 directly contradicts the draw verdict.`
        : "";
    return `PAIRWISE ANCHOR — ${dimension}: the comparative judge called this a DRAW. Your ${dim}_score should reflect a genuinely competitive turn — a score below 4 would contradict the draw verdict unless you find a specific failure the comparative judge missed.${rhetoricNote}${logicNote}`;
  } else {
    const rhetoricNote =
      dimension === "Rhetoric"
        ? ` Since ${prevAgentName} won this dimension, ${curAgentName}'s rhetoric was comparatively weaker. Use the four-component method: a turn with no above-average and one below-average component scores 4; no above-average and no below-average scores 5. A rhetoric loss should rarely score above 5 — scoring 6 requires naming one above-average component despite losing overall; scoring 7 directly contradicts the pairwise verdict and is only valid with explicit reconciliation.`
        : "";
    const logicNote =
      dimension === "Logic"
        ? ` LOGIC LOSS — override "Start at 6": use 4 as your baseline. Graduated scoring: 3 = argument circular, wholly unsubstantiated, or no mechanism present; 4 = structural claim present but mechanism absent or demonstrably weaker than ${prevAgentName}'s — this is the expected score for a coherent turn that lost on mechanism quality; 5 = at least one named mechanism element present but causal chain incomplete; 6 = requires explicit reconciliation — name the specific mechanism quality that matched or exceeded ${prevAgentName}'s and state why the verdict still went the other way; ≥7 directly contradicts the pairwise verdict.`
        : "";
    return `PAIRWISE ANCHOR — ${dimension}: the comparative judge gave the WIN to ${prevAgentName} (opponent). ${curAgentName}'s ${dim}_score may be below average — apply the normal rubric, but note that a score ≥ 7 here would imply ${curAgentName} actually outperformed ${prevAgentName} on ${dimension}, contradicting the pairwise verdict.${rhetoricNote}${logicNote}`;
  }
}

// ── LiveJudgeSystem ───────────────────────────────────────────────────────────

export class LiveJudgeSystem {
  private panel: LiveJudgePanel;
  private mode: "debate" | "document_audit" = "debate";

  constructor(judgeModelId: string = "kimi-k2:1t-cloud") {
    this.panel = this.initializeJudgePanel(judgeModelId);
  }

  private initializeJudgePanel(judgeModelId: string): LiveJudgePanel {
    // Single judge handles both adaptive analysis and pairwise comparison.
    // Specialization 'balance' gives equal weight to all dimensions.
    const specialization: JudgeSpecialization = "balance";
    const config = JUDGE_SPECIALIZATION_CONFIGS[specialization];
    const judge: LiveJudge = {
      id: "judge-pairwise",
      name: "Comparative Judge",
      modelId: judgeModelId,
      specialization,
      scoringWeights: config.scoringWeights,
      biasProfile: config.typicalBias,
      lastAnalysis: null,
      analysisCount: 0,
    };

    return {
      judges: [judge],
      currentScores: {},
      momentumTracker: {
        currentMomentum: {},
        momentumHistory: {},
        lastMomentumShift: {},
        momentumTrend: {},
      },
      frameControlTracker: {
        currentControl: {},
        controlHistory: {},
        lastControlShift: {},
        dominantFrame: null,
      },
      turnCount: 0,
      isActive: true,
      scorecard: {
        rounds: [],
        winTallies: {},
        overallWinner: null,
        counterfactualTrack: {},
      },
      previousTurn: null,
      lastAbsoluteScores: {},
      absoluteScoreHistory: {},
      claimFlagRegister: [],
      retroactiveDeltas: {},
      convergenceDetectedTurn: undefined,
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
    topic: string = "",
    referenceContext: string = "",
    messageHistory: Message[] = [],
  ): Promise<JudgeAnalysisResult> {
    this.panel.turnCount = turnNumber;
    const judge = this.panel.judges[0];
    const isOpeningTurn = !opponentMessage.trim();

    let pairwiseRound: PairwiseRound | undefined;
    let aggregatedScores: JudgeScores;
    let judgeAnalyses: any[] = [];
    let absoluteScores: JudgeScores | undefined;
    let scoreBreakdown: import("./types").TurnScoreBreakdown | undefined;
    let logicGapAdjustment:
      | {
          targetTurn: number;
          targetAgentId: string;
          deltaLogic: number;
          roundNumber: number;
        }
      | undefined;

    if (isOpeningTurn) {
      // Turn 1: no opponent to compare against — store this turn and use neutral scores
      this.panel.previousTurn = {
        turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        message,
      };
      aggregatedScores = {
        // Use scale midpoints, not 50, for the three bounded sub-scores:
        // logicalCoherence 0-40, rhetoricalForce 0-30, tacticalEffectiveness 0-30.
        // frameControl / credibilityScore / overallScore live on 0-100 scale → 50 is correct.
        logicalCoherence: 20,
        rhetoricalForce: 15,
        frameControl: 50,
        credibilityScore: 50,
        tacticalEffectiveness: 15,
        overallScore: 50,
      };

      // Still run a lightweight adaptive judge on the opening turn so the
      // debater can get feedback on their framing quality for Turn 3.
      try {
        const openingAnalysis = await analyzeTurn(
          judge,
          agent,
          message,
          opponent,
          "",
          turnNumber,
          topic,
          referenceContext,
          messageHistory,
        );
        judge.lastAnalysis = openingAnalysis;
        judge.analysisCount++;
        judgeAnalyses = [openingAnalysis];
        aggregatedScores = openingAnalysis.scores;
        absoluteScores = openingAnalysis.scores;
        scoreBreakdown = openingAnalysis.breakdown;
        // Persist so Turn 2 harmonization check has a prevAbsolute to compare against
        this.panel.lastAbsoluteScores[agent.id] = absoluteScores;
        this.panel.absoluteScoreHistory[turnNumber] = absoluteScores;
      } catch {
        // Opening analysis failed — store neutral fallback so Round 1 harmonization
        // is not silently skipped due to a missing prevAbsolute entry.
        this.panel.lastAbsoluteScores[agent.id] = aggregatedScores;
        this.panel.absoluteScoreHistory[turnNumber] = aggregatedScores;
      }
    } else {
      // Turn 2+: run pairwise comparison against the previous turn.
      const prev = this.panel.previousTurn;
      const prevAgentId = prev?.agentId || opponent.id;
      const prevAgentName = prev?.agentName || opponent.name;
      const prevMessage = prev?.message || opponentMessage;
      const prevTurnNumber = prev?.turnNumber || turnNumber - 1;
      const roundNumber = turnNumber - 1;

      // Store current turn as the new "previous" before the async call
      this.panel.previousTurn = {
        turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        message,
      };

      // Build the open flags list for the current prevTurn agent so the judge
      // can issue retroactive corrections. We only pass flags for the agent
      // whose turn is being held up as "prevTurn" in this comparison.
      const openFlagsForPrev: OpenFlag[] = this.panel.claimFlagRegister.filter(
        (f) => f.agentId === prevAgentId && f.status === "unresolved",
      );

      try {
        // Pairwise runs first so its suspect_claims feed into the absolute scorer.
        // The absolute scoring is supplementary — its failure never blocks the pairwise result.
        const pairwiseResult = await compareTurns(
          judge,
          prevAgentId,
          prevAgentName,
          prevMessage,
          prevTurnNumber,
          agent.id,
          agent.name,
          message,
          turnNumber,
          topic,
          roundNumber,
          undefined,
          openFlagsForPrev.length > 0 ? openFlagsForPrev : undefined,
          this.mode,
        );
        // Build a calibration hint from the pairwise result so the absolute scorer
        // doesn't produce scores that flatly contradict what the comparative judge
        // concluded. Covers all three dimensions. The absolute scorer still evaluates
        // independently — these anchors prevent near-failure scores on turns the
        // pairwise judge credited or treated as equal.
        const pairwiseCalibration = pairwiseResult.isFallback
          ? undefined
          : `ROUND ${turnNumber} PAIRWISE CALIBRATION (this absolute score must reflect the same comparative verdict as Round ${turnNumber}):\n` +
            [
              buildDimAnchor(
                "Logic",
                8,
                pairwiseResult.logicWinner,
                agent.id,
                agent.name,
                prevAgentName,
              ),
              buildDimAnchor(
                "Tactics",
                6,
                pairwiseResult.tacticsWinner,
                agent.id,
                agent.name,
                prevAgentName,
              ),
              buildDimAnchor(
                "Rhetoric",
                7,
                pairwiseResult.rhetoricWinner,
                agent.id,
                agent.name,
                prevAgentName,
              ),
            ].join("\n");

        const absoluteAnalysis = await analyzeTurn(
          judge,
          agent,
          message,
          opponent,
          opponentMessage,
          turnNumber,
          topic,
          referenceContext,
          messageHistory,
          undefined,
          pairwiseResult.suspectClaims,
          pairwiseCalibration,
        ).catch(() => null);

        pairwiseRound = pairwiseResult;
        judge.analysisCount++;

        // ── Seed new open flags from pairwise suspect_claims ──────────────────
        // Claims attributed to the prevTurn agent are seeded immediately so they
        // are available as open flags in the very next round.
        // Claims attributed to the curTurn agent are also early-registered here
        // (rather than waiting for them to appear as prevTurn next round), so that
        // if the debate ends before that agent speaks again as prevTurn, their
        // hollow claims still receive a penalty. The existing deduplication logic
        // prevents double-seeding when the next round re-encounters the same claim.
        if (pairwiseResult.suspectClaims && !pairwiseResult.isFallback) {
          // Build a fast-lookup set of fabricated claim texts (format: "AgentName: text")
          // so we can mark flags with claimType: "fabricated" when seeding.
          const fabricatedClaimTexts = new Set<string>(
            (pairwiseResult.fabricatedClaims ?? [])
              .map((e) => {
                const colonIdx = e.indexOf(":");
                return colonIdx === -1
                  ? ""
                  : e
                      .slice(colonIdx + 1)
                      .trim()
                      .toLowerCase()
                      .slice(0, 80);
              })
              .filter((t) => t.length > 0),
          );

          // ── Prev-turn agent flags ────────────────────────────────────────────
          let newFlagsSeeded = 0;
          // Filter to only prevAgent claims for the denominator displayed in the log.
          const prevAgentSuspectClaims = pairwiseResult.suspectClaims.filter(
            (c) =>
              c.toLowerCase().startsWith(prevAgentName.toLowerCase() + ":"),
          );
          for (const entry of pairwiseResult.suspectClaims) {
            // Format: "AgentName: claim text"
            const colonIdx = entry.indexOf(":");
            if (colonIdx === -1) continue;
            const claimedName = entry.slice(0, colonIdx).trim();
            const claimText = entry.slice(colonIdx + 1).trim();
            if (
              claimedName.toLowerCase() !== prevAgentName.toLowerCase() ||
              claimText.length === 0
            )
              continue;
            // Deduplicate by exact text OR shared 80-char prefix (catches LLM
            // rephrasing the same claim across turns).
            const prefix80 = claimText.slice(0, 80).toLowerCase();
            const alreadyExists = this.panel.claimFlagRegister.some(
              (f) =>
                f.claim === claimText ||
                (prefix80.length >= 40 &&
                  f.claim.slice(0, 80).toLowerCase() === prefix80),
            );
            if (!alreadyExists) {
              const claimIndex = this.panel.claimFlagRegister.filter(
                (f) =>
                  f.agentId === prevAgentId && f.originTurn === prevTurnNumber,
              ).length;
              const flagId = `FLAG-T${prevTurnNumber}-${prevAgentId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}-${claimIndex}`;
              const isFabricated =
                fabricatedClaimTexts.has(prefix80) ||
                fabricatedClaimTexts.has(claimText.slice(0, 80).toLowerCase());
              this.panel.claimFlagRegister.push({
                flagId,
                agentId: prevAgentId,
                agentName: prevAgentName,
                originTurn: prevTurnNumber,
                claim: claimText,
                status: "unresolved",
                claimType: isFabricated ? "fabricated" : "unverified",
              });
              if (isFabricated) {
                console.warn(
                  `[Claim Flags] Fabricated claim flagged for ${prevAgentName} T${prevTurnNumber}: "${claimText.slice(0, 80)}"`,
                );
              }
              newFlagsSeeded++;
            }
          }
          // Log only prevAgent-attributed claims; including curAgent claims in the
          // count gave a misleading "seeded N/M for prevAgent" where M counted turns
          // from the other agent.
          console.log(
            `[Claim Flags] Round ${roundNumber} seeded ${newFlagsSeeded}/${prevAgentSuspectClaims.length} new flag(s) for ${prevAgentName} T${prevTurnNumber}` +
              (prevAgentSuspectClaims.length > 0
                ? ` — claims: ${prevAgentSuspectClaims.map((c) => `"${c.slice(0, 60)}${c.length > 60 ? "…" : ""}"`).join(", ")}`
                : ""),
          );

          // ── Cur-turn agent early-register ────────────────────────────────────
          // Seed suspect claims for the current turn's agent now rather than
          // waiting for the next pairwise round to re-surface them. This ensures
          // that even if the debate ends before this agent speaks again as prevTurn,
          // the claim is in the register and its status is tracked.
          //
          // EXCEPTION — skip seeding when curTurn WIN or DRAW on Logic:
          //   WIN:  mechanism was credited as adequate — seeding would retroactively
          //         penalise a praised turn.
          //   DRAW: the argument was contested, not established. Seeding Draw-round
          //         claims causes the same "penalty on praised turns" failure mode
          //         when the agent continues developing the same argument next round.
          //         TODO: track Draw-round suspects in a contestedClaims structure
          //         (separate from claimFlagRegister) so convergence detection can
          //         read them without triggering penalties.
          let curFlagsSeeded = 0;
          const curTurnLogicResult =
            pairwiseResult.logicWinner === agent.id
              ? "win"
              : pairwiseResult.logicWinner === "tie"
                ? "draw"
                : "loss";
          const curTurnLogicLost = curTurnLogicResult === "loss";
          if (curTurnLogicLost) {
            for (const entry of pairwiseResult.suspectClaims) {
              const colonIdx = entry.indexOf(":");
              if (colonIdx === -1) continue;
              const claimedName = entry.slice(0, colonIdx).trim();
              const claimText = entry.slice(colonIdx + 1).trim();
              if (
                claimedName.toLowerCase() !== agent.name.toLowerCase() ||
                claimText.length === 0
              )
                continue;
              const prefix80 = claimText.slice(0, 80).toLowerCase();
              const alreadyExists = this.panel.claimFlagRegister.some(
                (f) =>
                  f.claim === claimText ||
                  (prefix80.length >= 40 &&
                    f.claim.slice(0, 80).toLowerCase() === prefix80),
              );
              if (!alreadyExists) {
                const claimIndex = this.panel.claimFlagRegister.filter(
                  (f) => f.agentId === agent.id && f.originTurn === turnNumber,
                ).length;
                const flagId = `FLAG-T${turnNumber}-${agent.id.replace(/[^a-z0-9]/gi, "").slice(0, 12)}-${claimIndex}`;
                const prefix80cur = claimText.slice(0, 80).toLowerCase();
                const isFabricatedCur =
                  fabricatedClaimTexts.has(prefix80cur) ||
                  fabricatedClaimTexts.has(
                    claimText.slice(0, 80).toLowerCase(),
                  );
                this.panel.claimFlagRegister.push({
                  flagId,
                  agentId: agent.id,
                  agentName: agent.name,
                  originTurn: turnNumber,
                  claim: claimText,
                  status: "unresolved",
                  claimType: isFabricatedCur ? "fabricated" : "unverified",
                });
                curFlagsSeeded++;
              }
            }
            if (curFlagsSeeded > 0) {
              const curAgentSuspectClaims = pairwiseResult.suspectClaims.filter(
                (c) =>
                  c.toLowerCase().startsWith(agent.name.toLowerCase() + ":"),
              );
              console.log(
                `[Claim Flags] Round ${roundNumber} early-registered ${curFlagsSeeded}/${curAgentSuspectClaims.length} flag(s) for ${agent.name} T${turnNumber}`,
              );
            }
          } // end if (curTurnLogicLost)
          if (
            curTurnLogicResult !== "loss" &&
            pairwiseResult.suspectClaims.some((c) =>
              c.toLowerCase().startsWith(agent.name.toLowerCase() + ":"),
            )
          ) {
            console.log(
              `[Claim Flags] Round ${roundNumber}: skipping early-register for ${agent.name} T${turnNumber} — pairwise Logic ${curTurnLogicResult === "win" ? "WIN (mechanism credited)" : "DRAW (argument contested, not established)"}`,
            );
          }
        } else if (!pairwiseResult.isFallback) {
          console.log(
            `[Claim Flags] Round ${roundNumber}: pairwise judge returned no suspect_claims for ${prevAgentName} T${prevTurnNumber}`,
          );
        }

        // ── Apply retroactive score corrections from flag_updates ─────────────
        // The judge issues UPDATE instructions for prevTurn's absolute score.
        // We apply them to retroactiveDeltas; the SSE layer emits scoreUpdate events.
        // absoluteScoreHistory is also updated so that re-reconciliation (below) can
        // re-evaluate pairwise round winners using the corrected absolute scores.
        if (pairwiseResult.flagUpdates && !pairwiseResult.isFallback) {
          console.log(
            `[Claim Flags] Round ${roundNumber}: ${pairwiseResult.flagUpdates.length} flag_update(s) received`,
          );
          const penalisedTurns = new Set<number>();
          // Track if any penalty was capped so we can update flagUpdates for SSE consistency.
          const cappedFlagDeltaRaw = new Map<string, number>();

          for (const update of pairwiseResult.flagUpdates) {
            const { flagId, targetTurn, deltaRaw, updateType } = update;

            // Find the original flag so we can enforce the restore cap.
            const flag = this.panel.claimFlagRegister.find(
              (f) => f.flagId === flagId,
            );

            // Guard: discard updates for unknown flagIds (LLM hallucinated an ID not in
            // the register). Without this, a phantom flagId causes flag===undefined,
            // short-circuits the originTurn check, and lets the penalty land unchecked.
            if (!flag) {
              console.warn(
                `[Claim Flags] Unknown flagId "${flagId}" in update for T${targetTurn} (Turn ${turnNumber}) — discarding`,
              );
              continue;
            }
            // Guard: discard updates where the LLM echoed the current turn number
            // instead of the flag's originating turn (Turn N+1 misattribution bug).
            if (flag.originTurn !== targetTurn) {
              console.warn(
                `[Claim Flags] target_turn mismatch on ${flagId}: flag originates at T${flag.originTurn} but update targets T${targetTurn} — discarding`,
              );
              continue;
            }

            // For partial restores: cap magnitude at 50% of accumulated penalties
            // so the agent can never fully undo a docking just by citing late.
            let effectiveDelta = deltaRaw;
            if (updateType === "partial_restore" && flag) {
              const existingDelta =
                this.panel.retroactiveDeltas[targetTurn]?.logicalCoherence ?? 0;
              // existingDelta should already be negative (penalty); restore is positive.
              const maxRestore = Math.abs(existingDelta) / 2;
              effectiveDelta = Math.min(deltaRaw, maxRestore);
              if (effectiveDelta <= 0) continue; // no meaningful restore
            }

            // For penalties on fabricated claims, enforce a minimum of -2 (on the 1-10 raw scale).
            // The LLM is instructed to use -2 for fabricated flags, but clamp defensively here.
            if (updateType === "penalty" && flag?.claimType === "fabricated") {
              effectiveDelta = Math.min(effectiveDelta, -2); // ensure at least -2 severity
            }

            // Accumulate in retroactiveDeltas (values are deltas on the 0-40 scale)
            const scaledDelta = effectiveDelta * 4;
            const existing =
              this.panel.retroactiveDeltas[targetTurn]?.logicalCoherence ?? 0;

            // Cap: retroactive penalties cannot shed more than a fraction of the original
            // logic score. For turns that won their pairwise logic dimension, use a tighter
            // 25% cap — this prevents open-flag penalties from creating artificial "both at
            // penalty floor" ties that contradict a round where the pairwise judge awarded
            // the logic win. For all other turns the cap is 50% (previous behaviour).
            let cappedScaledDelta = scaledDelta;
            const hist = this.panel.absoluteScoreHistory[targetTurn];
            if (hist && scaledDelta < 0) {
              const originalScore = hist.logicalCoherence - existing; // score before any retroactive adjustments
              // Determine the round where this turn was curTurn (the turn
              // being judged in that round). Avoid rounds where it appears as
              // prevTurn — that reflects the opponent's context in the *next*
              // round and would misattribute the wrong pairwise outcome to this
              // turn's absolute score.
              const ownRound = this.panel.scorecard.rounds.find(
                (r) =>
                  r.curTurn.turnNumber === targetTurn &&
                  r.curTurn.agentId === update.agentId,
              );
              const wasPairwiseLogicWinner =
                ownRound !== undefined &&
                (ownRound.logicWinnerRaw ?? ownRound.logicWinner) ===
                  update.agentId;
              // Determine the pairwise Logic band this turn belongs to so the
              // penalty cannot push the score below the band's lower bound.
              // Logic bands: WIN [24,40]  DRAW [18,30]  LOSS [10,22]
              // Opening turns have no pairwise round (ownRound === undefined);
              // use bandFloor 0 so the only constraint is no negative scores.
              const wasPairwiseLogicDraw =
                !wasPairwiseLogicWinner &&
                ownRound !== undefined &&
                (ownRound.logicWinnerRaw ?? ownRound.logicWinner) === "tie";
              const bandFloor =
                ownRound === undefined
                  ? 0
                  : wasPairwiseLogicWinner
                    ? 24
                    : wasPairwiseLogicDraw
                      ? 18
                      : 10;
              // For winners: cap at whichever is less severe — the more
              // restrictive of a 25% fractional cap or the band floor. This
              // prevents artificial ties from open-flag penalties contradicting
              // a clear logic win.
              // For non-winners: there is no extra fractional cap; only the band
              // floor limits how far penalties can push the score down.
              // Ensure the band-floor-based cap is never positive: if the original
              // score is already at or below the band floor, we allow no further
              // penalty (but never introduce a bonus).
              const bandFloorDeltaCap = -Math.max(0, originalScore - bandFloor);
              const maxPenalty = wasPairwiseLogicWinner
                ? Math.max(-Math.ceil(originalScore * 0.25), bandFloorDeltaCap)
                : bandFloorDeltaCap;
              if (existing + scaledDelta < maxPenalty) {
                cappedScaledDelta = maxPenalty - existing;
                console.log(
                  `[Claim Flags] Penalty on T${targetTurn} capped: Δ${scaledDelta} → ${cappedScaledDelta} (original=${originalScore}, bandFloor=${bandFloor}${wasPairwiseLogicWinner ? ", winner 25%" : ""})`,
                );
                cappedFlagDeltaRaw.set(flagId, cappedScaledDelta / 4);
              }
            }

            this.panel.retroactiveDeltas[targetTurn] = {
              ...this.panel.retroactiveDeltas[targetTurn],
              logicalCoherence: existing + cappedScaledDelta,
            };

            // Mirror the same delta into absoluteScoreHistory so re-reconciliation
            // uses the post-penalty score when re-evaluating tied rounds.
            if (hist) {
              this.panel.absoluteScoreHistory[targetTurn] = {
                ...hist,
                logicalCoherence: Math.max(
                  0,
                  hist.logicalCoherence + cappedScaledDelta,
                ),
              };
              penalisedTurns.add(targetTurn);
            }

            // Update flag status in the register
            if (flag) {
              flag.status =
                updateType === "partial_restore" ? "resolved" : "penalized";
            }
            console.log(
              `[Claim Flags] ${updateType} on ${flagId} → T${targetTurn} logicalCoherence ${effectiveDelta > 0 ? "+" : ""}${cappedScaledDelta} (scaled)`,
            );
          }

          // If any penalties were capped, update pairwiseRound.flagUpdates so the SSE
          // scoreUpdate events sent to the client reflect the actual applied delta rather
          // than the uncapped value from the LLM response.
          if (cappedFlagDeltaRaw.size > 0 && pairwiseRound?.flagUpdates) {
            pairwiseRound = {
              ...pairwiseRound,
              flagUpdates: pairwiseRound.flagUpdates.map((u) =>
                cappedFlagDeltaRaw.has(u.flagId)
                  ? { ...u, deltaRaw: cappedFlagDeltaRaw.get(u.flagId)! }
                  : u,
              ),
            };
          }
          // For each turn whose absolute logicalCoherence changed, re-run
          // reconcileRoundWinners on every pairwise round that included that turn.
          // This corrects the specific case where penalties make a previously-equal
          // score pair unequal (or vice versa), keeping the absolute score table
          // and the pairwise scorecard consistent.
          for (const affectedTurn of penalisedTurns) {
            const affectedAbs = this.panel.absoluteScoreHistory[affectedTurn];
            if (!affectedAbs) continue;

            for (let ri = 0; ri < this.panel.scorecard.rounds.length; ri++) {
              const round = this.panel.scorecard.rounds[ri];
              const isPrev = round.prevTurn.turnNumber === affectedTurn;
              const isCur = round.curTurn.turnNumber === affectedTurn;
              if (!isPrev && !isCur) continue;

              const prevAbs = isPrev
                ? affectedAbs
                : this.panel.absoluteScoreHistory[round.prevTurn.turnNumber];
              const curAbs = isCur
                ? affectedAbs
                : this.panel.absoluteScoreHistory[round.curTurn.turnNumber];
              if (!prevAbs || !curAbs) continue;

              const updatedRound = reconcileRoundWinners(
                round,
                curAbs,
                prevAbs,
              );
              const dimPairs: Array<
                [
                  "logicWinner" | "tacticsWinner" | "rhetoricWinner",
                  "logic" | "tactics" | "rhetoric",
                ]
              > = [
                ["logicWinner", "logic"],
                ["tacticsWinner", "tactics"],
                ["rhetoricWinner", "rhetoric"],
              ];

              let anyChange = false;
              for (const [field, tallyKey] of dimPairs) {
                const oldWinner = round[field];
                const newWinner = updatedRound[field];
                if (oldWinner === newWinner) continue;
                anyChange = true;
                // Un-tally the old winner and tally the new one
                if (
                  oldWinner !== "tie" &&
                  this.panel.scorecard.winTallies[oldWinner]
                ) {
                  this.panel.scorecard.winTallies[oldWinner][tallyKey]--;
                  this.panel.scorecard.winTallies[oldWinner].total--;
                }
                if (
                  newWinner !== "tie" &&
                  this.panel.scorecard.winTallies[newWinner]
                ) {
                  this.panel.scorecard.winTallies[newWinner][tallyKey]++;
                  this.panel.scorecard.winTallies[newWinner].total++;
                }
                console.log(
                  `[Claim Flags] Re-reconciled R${round.roundNumber} ${tallyKey}: ${oldWinner} → ${newWinner} after T${affectedTurn} penalty`,
                );
              }

              if (anyChange) {
                this.panel.scorecard.rounds[ri] = {
                  ...round,
                  logicWinner: updatedRound.logicWinner,
                  tacticsWinner: updatedRound.tacticsWinner,
                  rhetoricWinner: updatedRound.rhetoricWinner,
                };
              }
            }

            // Recompute overallWinner after tally adjustments
            const sortedTallies = Object.entries(
              this.panel.scorecard.winTallies,
            ).sort((a, b) => b[1].total - a[1].total);
            this.panel.scorecard.overallWinner =
              sortedTallies.length >= 2 &&
              sortedTallies[0][1].total > sortedTallies[1][1].total
                ? sortedTallies[0][0]
                : null;
          }
        }

        // ── Mark explicitly resolved flags ────────────────────────────────────
        if (pairwiseResult.resolvedFlags) {
          for (const flagId of pairwiseResult.resolvedFlags) {
            const flag = this.panel.claimFlagRegister.find(
              (f) => f.flagId === flagId,
            );
            if (flag && flag.status === "unresolved") {
              flag.status = "resolved";
            }
          }
        }

        if (absoluteAnalysis) {
          absoluteScores = absoluteAnalysis.scores;
          scoreBreakdown = absoluteAnalysis.breakdown;

          // ── Pairwise-calibrated floor enforcement ──────────────────────────
          // After the absolute LLM scorer runs, enforce structural consistency
          // against the pairwise verdict as a code-level backstop.  This
          // prevents the "14/40 on a Draw" class of bugs where the absolute
          // scorer independently produces a score that inverts or grossly
          // contradicts the pairwise judgment.
          //
          // Only band clamping is applied here (WIN/DRAW/LOSS floors/ceilings).
          // prevScores is intentionally NOT passed — the winMinGap enforcement
          // that used to live here ran before penalties (evidence gating, artifact
          // cap) and caused a feedback loop where the pre-penalty bump was always
          // erased by the subsequent penalty, landing scores at the same value
          // every round.  Gap enforcement is now the sole responsibility of the
          // post-penalty block below, which sees final values of both turns.
          //
          // Only curTurn's scores are modified.  PrevTurn's scores are frozen
          // (they were set in a prior processTurn call and may carry retroactive
          // penalties that we must not silently undo here).

          if (!pairwiseRound.isFallback) {
            const clamped = applyPairwiseFloors(
              pairwiseRound.logicWinner,
              pairwiseRound.tacticsWinner,
              pairwiseRound.rhetoricWinner,
              agent.id,
              pairwiseRound.prevTurn.agentId,
              absoluteScores,
              // prevScores omitted — gap enforcement moved to post-penalty block
            );
            if (clamped !== absoluteScores) {
              const floorNote =
                `Logic: ${absoluteScores.logicalCoherence}→${clamped.logicalCoherence} ` +
                `Tactics: ${absoluteScores.tacticalEffectiveness}→${clamped.tacticalEffectiveness} ` +
                `Rhetoric: ${absoluteScores.rhetoricalForce}→${clamped.rhetoricalForce}`;
              console.log(
                `[Floor Calibration] R${pairwiseRound.roundNumber} T${turnNumber} ` +
                  `(${agent.name}) — ${floorNote} ` +
                  `[pairwise L:${pairwiseRound.logicWinner === agent.id ? "WIN" : pairwiseRound.logicWinner === "tie" ? "DRAW" : "LOSS"} ` +
                  `T:${pairwiseRound.tacticsWinner === agent.id ? "WIN" : pairwiseRound.tacticsWinner === "tie" ? "DRAW" : "LOSS"} ` +
                  `R:${pairwiseRound.rhetoricWinner === agent.id ? "WIN" : pairwiseRound.rhetoricWinner === "tie" ? "DRAW" : "LOSS"}]`,
              );
              absoluteScores = clamped;
              // Record the floor adjustment in the breakdown for the audit panel
              if (scoreBreakdown) {
                scoreBreakdown = {
                  ...scoreBreakdown,
                  pairwiseFloorApplied: true,
                  pairwiseFloorNote: `Pairwise floor applied — ${floorNote}`,
                };
              }
            }
          }

          // ── Evidence gating enforcement ─────────────────────────────────────
          // Code-level backstop for empirical claims without citations.
          // The judge prompt already instructs the LLM to penalise hollow
          // specificity, but the LLM may classify borderline phrasing as
          // "normative" and skip the penalty.  When the pre-scoring detector
          // found empirical patterns AND no inline citations, apply a −4 Logic
          // penalty (= −1 raw point × 4) capped at the LOSS band floor (10).
          // Only fires when Logic is above 24 (WIN floor): turns already scored
          // in the LOSS/DRAW band are not further depressed.
          const EVIDENCE_LOGIC_PENALTY = 4; // −1 raw point on 1–10 scale × 4
          if (
            scoreBreakdown?.empiricalClaimsWithoutCitations &&
            absoluteScores.logicalCoherence > 24
          ) {
            const penalised = Math.max(
              24,
              absoluteScores.logicalCoherence - EVIDENCE_LOGIC_PENALTY,
            );
            if (penalised !== absoluteScores.logicalCoherence) {
              absoluteScores = {
                ...absoluteScores,
                logicalCoherence: penalised,
              };
              scoreBreakdown = {
                ...scoreBreakdown,
                evidenceEnforcementNote:
                  `Logic −${EVIDENCE_LOGIC_PENALTY}: empirical claims detected without inline citations ` +
                  `(${scoreBreakdown.empiricalClaimsList?.slice(0, 2).join("; ") ?? "see audit"}). ` +
                  `Score capped at WIN floor pending citation.`,
              };
            }
          }

          // ── Artifact remediation: Rhetoric cap ──────────────────────────────
          // CJK inline artifacts signal a tokeniser encoding failure that
          // space-drop repair cannot fix.  The LLM scored repaired text, but
          // residual encoding noise may have inflated Expression or Structure
          // ratings.  Cap Rhetoric at the DRAW-band ceiling (22/30) for severe
          // artifacts so the cap is visible in the audit trail.
          const RHETORIC_ARTIFACT_CAP = 22; // DRAW-band max for Tactics/Rhetoric
          if (
            scoreBreakdown?.artifactSeverity === "severe" &&
            absoluteScores.rhetoricalForce > RHETORIC_ARTIFACT_CAP
          ) {
            absoluteScores = {
              ...absoluteScores,
              rhetoricalForce: RHETORIC_ARTIFACT_CAP,
            };
            scoreBreakdown = {
              ...scoreBreakdown,
              rhetoricalScoreCapped: true,
              rhetoricalCapNote:
                `Rhetoric capped at ${RHETORIC_ARTIFACT_CAP}/30 — CJK inline encoding artifact detected. ` +
                `Space-drop repair cannot fix this class of tokeniser failure; score reflects uncertainty.`,
            };
          }

          // Persist for next round's harmonization check and retroactive re-reconciliation
          // NOTE: Logic gap enforcement (MIN_LOGIC_WIN_GAP) has been moved to
          // enforceAllLogicGaps(), called once inside generateNarrativeVerdict after all
          // turns are scored.  Running it here caused stacking: when T3 was later pulled
          // down as a loser in R3, it equalized with T2 (which had already been pulled
          // down for R2), flipping R2 from DS-win to "tie".
          this.panel.lastAbsoluteScores[agent.id] = absoluteScores;
          this.panel.absoluteScoreHistory[turnNumber] = absoluteScores;
        }

        // Reconcile pairwise winners with absolute scores: when both turns score
        // identically on a dimension, the winner is reset to "tie" so no scorecard
        // win is counted for either agent.
        // Use absoluteScoreHistory keyed by turn number rather than lastAbsoluteScores
        // keyed by agentId: the history entry is updated in-place when retroactive
        // penalties fire during this same round, whereas lastAbsoluteScores is not.
        if (absoluteScores && !pairwiseRound.isFallback) {
          pairwiseRound = reconcileRoundWinners(
            pairwiseRound,
            absoluteScores,
            this.panel.absoluteScoreHistory[pairwiseRound.prevTurn.turnNumber],
          );
        }

        // Update the scorecard using agent IDs/names from the pairwise round itself
        this.panel.scorecard = updateScorecard(
          this.panel.scorecard,
          pairwiseRound,
          pairwiseRound.prevTurn.agentId,
          pairwiseRound.prevTurn.agentName,
          pairwiseRound.curTurn.agentId,
          pairwiseRound.curTurn.agentName,
        );

        // Derive synthetic adaptive scores from pairwise result
        aggregatedScores = synthScoresFromPairwise(pairwiseRound, agent.id);

        // Replace the binary floor/ceiling rhetoric and tactics values with the
        // continuous absolute scores when available. synthScoresFromPairwise
        // maps win→24 / loss→10 for these dimensions, which produces the
        // floor-clustering problem observed in long debates. absoluteScores
        // uses the 1–10 model signal mapped to 3–30, giving proper spread.
        // logicalCoherence stays binary (14/22/30 for loss/draw/win) and overallScore
        // stays win-count-mapped (30/45/65/82) to keep momentum calibration intact.
        // logicQuality carries the real continuous LLM Logic score for display.
        if (absoluteScores) {
          aggregatedScores = {
            ...aggregatedScores,
            rhetoricalForce: absoluteScores.rhetoricalForce,
            tacticalEffectiveness: absoluteScores.tacticalEffectiveness,
            logicQuality: absoluteScores.logicalCoherence,
          };
        }

        // Also create a synthetic TurnAnalysis for pressure.ts compatibility
        judgeAnalyses = [
          this.synthTurnAnalysis(
            judge,
            agent,
            opponent,
            message,
            opponentMessage,
            turnNumber,
            aggregatedScores,
            pairwiseRound.logicDelta,
          ),
        ];
      } catch (error) {
        console.error("[Pairwise Judge] compareTurns threw:", error);
        aggregatedScores = {
          logicalCoherence: 20,
          rhetoricalForce: 15,
          frameControl: 50,
          credibilityScore: 50,
          tacticalEffectiveness: 15,
          overallScore: 50,
        };
        judgeAnalyses = [
          createFallbackAnalysis(
            judge,
            agent,
            opponent,
            turnNumber,
            message,
            opponentMessage,
            referenceContext,
          ),
        ];
      }
    }

    // Calculate momentum and frame control from adaptive scores
    const momentumShift = calculateMomentumShift(
      aggregatedScores,
      this.panel.momentumTracker,
      agent.id,
    );
    const frameControlShift = calculateFrameControlShift(
      aggregatedScores,
      this.panel.frameControlTracker,
      agent.id,
    );

    // Generate adaptive pressures
    const adaptivePressures = judgeAnalyses.map((analysis) =>
      generateAdaptivePressure(analysis, momentumShift, frameControlShift),
    );

    // ── Post-scoring harmonization pass ──────────────────────────────────────
    // All absolute scores for the current turn (and any retroactive adjustments
    // to earlier turns' history entries) are now settled.  Run a single pass
    // over every round using the final absoluteScoreHistory snapshot so that
    // Draw-spread and directional-inversion flags always reflect the values
    // visible in the score table — not pre-penalty or pre-gap-enforcement values.
    if (pairwiseRound && !pairwiseRound.isFallback) {
      this.recomputeAllHarmonizationFlags();
    }

    // Derive opts for hidden directive: counterfactual and mechanism pressure.
    // Use turnNumber + 1 (the *next* turn) so the pool index matches what
    // generateAdaptiveReply() will inject — keeping the log consistent with the
    // directive the agent actually receives.
    const noCounterfactualYet =
      turnNumber + 1 >= 4 &&
      !this.panel.scorecard.counterfactualTrack?.[agent.id];
    const mechanismFailureLastRound =
      !!pairwiseRound?.mechanismFailures?.includes(agent.name);

    // ── Mid-debate convergence heuristic ─────────────────────────────────────
    // After turn 12, check whether the debate has collapsed into a definitional
    // dispute by looking at the balance of wins across the last 8 non-fallback
    // rounds. When neither agent has won a majority (balanced within 15% of total
    // possible dimension wins) AND both agents have recent mechanism failures,
    // convergence is suspected.
    // Fire at most once per debate (convergenceDetectedTurn guards re-fire).
    let convergenceDetectedNow = false;
    let convergenceWarning: string | undefined;
    if (
      turnNumber >= 12 &&
      !this.panel.convergenceDetectedTurn &&
      this.panel.scorecard.rounds.length >= 8
    ) {
      const recentRounds = this.panel.scorecard.rounds
        .filter((r) => !r.isFallback)
        .slice(-8);
      if (recentRounds.length >= 6) {
        const agentIds = Object.keys(this.panel.scorecard.winTallies);
        if (agentIds.length === 2) {
          // Count dimension wins across recent rounds for each agent
          const winCounts: Record<string, number> = {
            [agentIds[0]]: 0,
            [agentIds[1]]: 0,
          };
          let totalWins = 0;
          for (const r of recentRounds) {
            for (const winner of [
              r.logicWinner,
              r.tacticsWinner,
              r.rhetoricWinner,
            ]) {
              if (agentIds.includes(winner)) {
                winCounts[winner]++;
                totalWins++;
              }
            }
          }
          const maxWins = Math.max(...Object.values(winCounts));
          const balance = totalWins > 0 ? maxWins / totalWins : 0.5;
          // Both agents have recent mechanism failures (both stuck)
          // Both agents must individually appear in mechanismFailures — total count alone
          // is insufficient because one agent could contribute all entries.
          const mechanismFailureCounts = new Map<string, number>();
          for (const name of recentRounds.flatMap(
            (r) => r.mechanismFailures ?? [],
          )) {
            mechanismFailureCounts.set(
              name,
              (mechanismFailureCounts.get(name) ?? 0) + 1,
            );
          }
          const agentNames = agentIds.map(
            (id) => this.panel.scorecard.winTallies[id]?.agentName ?? id,
          );
          // Require ≥2 appearances each to avoid false-positives from a single
          // shared-vocabulary round (e.g. consciousness / epistemic debates).
          const bothHaveMechanismFailures = agentNames.every(
            (name) => (mechanismFailureCounts.get(name) ?? 0) >= 2,
          );
          // Convergence: neither agent dominates (≤ 55% of recent wins) AND both struggling
          if (balance <= 0.55 && bothHaveMechanismFailures) {
            convergenceDetectedNow = true;
            this.panel.convergenceDetectedTurn = turnNumber;
            convergenceWarning = `⚠ CONVERGENCE DETECTED (Turn ${turnNumber}): Neither debater holds a sustained positional advantage across the last ${recentRounds.length} rounds, and both have recent mechanism failures. The debate appears to have collapsed into a definitional or degree dispute. The next turn should re-anchor to the original motion or acknowledge the convergence.`;
            console.warn(`[Convergence] ${convergenceWarning}`);
          }
        }
      }
    }

    const hiddenDirective = generateHiddenDirective(
      aggregatedScores,
      turnNumber + 1,
      {
        noCounterfactualYet,
        mechanismFailureLastRound,
        convergenceDetected: convergenceDetectedNow,
      },
    );
    if (hiddenDirective) {
      console.log(
        `[Hidden Directive] Turn ${turnNumber} → preview for Turn ${turnNumber + 1} (${opponent.name}): ${hiddenDirective}`,
      );
    }

    // Update panel state
    this.updatePanelState(
      agent,
      aggregatedScores,
      momentumShift,
      frameControlShift,
      judgeAnalyses,
    );

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
      scorecard: pairwiseRound ? { ...this.panel.scorecard } : undefined,
      absoluteScores,
      harmonizationFlags:
        pairwiseRound && !pairwiseRound.isFallback
          ? this.panel.scorecard.rounds.find(
              (r) => r.roundNumber === pairwiseRound!.roundNumber,
            )?.harmonizationFlags
          : undefined,
      retroactiveDeltas:
        pairwiseRound?.flagUpdates && pairwiseRound.flagUpdates.length > 0
          ? { ...this.panel.retroactiveDeltas }
          : undefined,
      convergenceWarning,
      scoreBreakdown,
      logicGapAdjustment,
    };
  }

  /**
   * Create a TurnAnalysis-compatible object from pairwise scores for pressure.ts.
   */
  /**
   * Recompute harmonization flags for every non-fallback round using the
   * current absoluteScoreHistory as ground truth.
   *
   * Called once at the end of each processTurn, after all absolute scores,
   * penalties, and gap-enforcement adjustments are fully settled.  This
   * guarantees every flag references the same score values visible in the
   * scorecard table — no flag can reference a value that was later overwritten.
   *
   * Three check types per round:
   *   - Draw spread:       pairwise = tie AND |curScore − prevScore| ≥ threshold
   *   - Directional inversion: pairwise winner scores lower than loser by ≥ threshold
   *   - WIN near-zero gap: pairwise direction is correct but margin < winMinGap
   *     (catches retroactive gap enforcement collapsing a WIN to near-tie level)
   *
   * prevTurn scores are contextualized for the inversion check (to avoid
   * false positives caused by the sliding-window design) but raw for the
   * draw-spread and near-zero gap checks (to reflect actual table values).
   */
  private recomputeAllHarmonizationFlags(): void {
    const snapshot = this.panel.absoluteScoreHistory;
    const updatedRounds = this.panel.scorecard.rounds.map((round) => {
      if (round.isFallback) return round;
      const rawPrev = snapshot[round.prevTurn.turnNumber];
      const rawCur = snapshot[round.curTurn.turnNumber];
      if (!rawPrev || !rawCur) return round;

      const flags = computeHarmonizationFlags(
        round,
        rawCur,
        contextualizeScoreForRound(round, rawPrev), // contextualized for inversion check
        rawPrev, // raw for draw-spread check
      );

      if (flags.length > 0) {
        flags.forEach((f) =>
          console.warn(
            `[Harmonization] R${f.roundNumber} ${f.dimension}: ${f.note}`,
          ),
        );
      }

      return {
        ...round,
        harmonizationFlags: flags.length > 0 ? flags : undefined,
      };
    });

    this.panel.scorecard = {
      ...this.panel.scorecard,
      rounds: updatedRounds,
    };
  }

  private synthTurnAnalysis(
    judge: LiveJudge,
    agent: Agent,
    opponent: Agent,
    message: string,
    opponentMessage: string,
    turnNumber: number,
    scores: JudgeScores,
    reasoning: string,
  ): any {
    return {
      turnNumber,
      agentId: agent.id,
      agentName: agent.name,
      opponentId: opponent.id,
      opponentName: opponent.name,
      message,
      opponentMessage,
      context: "",
      scores,
      usedTactics: [],
      effectivenessMap: {},
      momentumShift: 0,
      frameControlShift: 0,
      exposedWeaknesses: [],
      tacticalInsights: [],
      judgeId: judge.id,
      judgeSpecialization: judge.specialization,
      reasoning,
    };
  }

  /**
   * Enforce a minimum Logic gap between winner and loser for every scored round,
   * applied in a single reverse-order pass after all turns are processed.
   *
   * Reverse order is required because a turn can be the winner in round N and
   * the loser in round N+1.  Processing N+1 first establishes the loser's final
   * score; round N then uses that reduced score to set the earlier loser, cascading
   * the gap correctly down the chain.  Forward-order processing breaks earlier
   * round gaps when a later round pulls a shared turn's score below the earlier
   * winner's floor.
   *
   * Only the loser is ever adjusted (downward).  The winner's score is never
   * touched here — all per-turn penalties are already baked into absoluteScoreHistory.
   * After adjusting scores, reconcileRoundWinners is re-run for any affected round so
   * rounds where the gap was already ≥ MIN_LOGIC_WIN_GAP remain unchanged.
   */
  private enforceAllLogicGaps(): Array<{
    targetTurn: number;
    agentId: string;
    deltaLogic: number;
    roundNumber: number;
  }> {
    const MIN_LOGIC_WIN_GAP = 6;
    const rounds = this.panel.scorecard.rounds;
    const adjustments: Array<{
      targetTurn: number;
      agentId: string;
      deltaLogic: number;
      roundNumber: number;
    }> = [];

    // Reverse pass: last round first so shared turns cascade correctly.
    for (let i = rounds.length - 1; i >= 0; i--) {
      const round = rounds[i];
      if (round.isFallback || round.logicWinner === "tie") continue;

      const prevAbs =
        this.panel.absoluteScoreHistory[round.prevTurn.turnNumber];
      const curAbs = this.panel.absoluteScoreHistory[round.curTurn.turnNumber];
      if (!prevAbs || !curAbs) continue;

      const winnerIsCur = round.logicWinner === round.curTurn.agentId;
      const winnerTurn = winnerIsCur
        ? round.curTurn.turnNumber
        : round.prevTurn.turnNumber;
      const loserTurn = winnerIsCur
        ? round.prevTurn.turnNumber
        : round.curTurn.turnNumber;
      const loserAgentId = winnerIsCur
        ? round.prevTurn.agentId
        : round.curTurn.agentId;

      const winnerLogic =
        this.panel.absoluteScoreHistory[winnerTurn]!.logicalCoherence;
      const loserEntry = this.panel.absoluteScoreHistory[loserTurn]!;
      const loserLogic = loserEntry.logicalCoherence;

      if (winnerLogic - loserLogic < MIN_LOGIC_WIN_GAP) {
        // Guard: only enforce when the winner ACTUALLY scores higher than the loser.
        // A cascade-induced directional inversion (winnerLogic ≤ loserLogic) means the
        // pairwise-winner's absolute score was already at or below the loser's after
        // earlier cascade adjustments.  Blindly pushing the loser down to
        // max(10, winnerLogic−MIN_LOGIC_WIN_GAP) can equalise both scores at the band
        // floor (10), causing reconcileRoundWinners to flip the round to "tie" while
        // also emitting a misleading "Gap enforcement (Round N)" note for a Draw round.
        // Directional inversions are surfaced independently by harmonization flags;
        // enforcement must not compound them by creating an artificial tie.
        if (winnerLogic > loserLogic) {
          const adjustedLoser = Math.max(10, winnerLogic - MIN_LOGIC_WIN_GAP);
          if (adjustedLoser !== loserLogic) {
            this.panel.absoluteScoreHistory[loserTurn] = {
              ...loserEntry,
              logicalCoherence: adjustedLoser,
            };
            adjustments.push({
              targetTurn: loserTurn,
              agentId: loserAgentId,
              deltaLogic: adjustedLoser - loserLogic, // negative (downward adjustment)
              roundNumber: round.roundNumber,
            });
            console.log(
              `[Logic Gap Pass] R${round.roundNumber} ` +
                `T${loserTurn} Logic ${loserLogic}→${adjustedLoser} ` +
                `(winner T${winnerTurn}=${winnerLogic}, gap was ${winnerLogic - loserLogic})`,
            );
          }
        } else {
          // winnerLogic ≤ loserLogic: cascade-induced directional inversion — log and skip.
          // reconcileRoundWinners below will correct the round's stored winner using the
          // post-cascade absoluteScoreHistory values; harmonization flags will surface it.
          console.log(
            `[Logic Gap Pass] R${round.roundNumber} skipped — directional inversion ` +
              `(winner T${winnerTurn}=${winnerLogic} ≤ loser T${loserTurn}=${loserLogic}); ` +
              `harmonization flag will surface this`,
          );
        }
      }

      // Re-reconcile this round using the (possibly updated) scores so equal-score
      // pairs are correctly flagged as "tie" and unequal pairs retain their winner.
      const updatedPrev =
        this.panel.absoluteScoreHistory[round.prevTurn.turnNumber]!;
      const updatedCur =
        this.panel.absoluteScoreHistory[round.curTurn.turnNumber]!;
      const reconciled = reconcileRoundWinners(round, updatedCur, updatedPrev);
      if (
        reconciled.logicWinner !== round.logicWinner ||
        reconciled.tacticsWinner !== round.tacticsWinner ||
        reconciled.rhetoricWinner !== round.rhetoricWinner
      ) {
        rounds[i] = reconciled;
      }
    }

    return adjustments;
  }

  /**
   * Generate the full-debate narrative verdict. Call this after all turns complete.
   */
  async generateNarrativeVerdict(
    fullTranscript: Message[],
    topic: string,
    agentA: Agent,
    agentB: Agent,
    onGapAdjustments?: (
      adjustments: Array<{
        targetTurn: number;
        agentId: string;
        deltaLogic: number;
        roundNumber: number;
      }>,
    ) => void,
  ): Promise<NarrativeVerdict | null> {
    if (this.panel.scorecard.rounds.length === 0) return null;

    // ── Final gap enforcement ─────────────────────────────────────────────────
    // All per-turn penalties (evidence gating, artifact cap) are now finalised.
    // Run a single reverse-order pass to enforce MIN_LOGIC_WIN_GAP across every
    // round.  Reverse order ensures that when a turn is shared between two rounds
    // (winner in R_N, loser in R_{N+1}), R_{N+1}'s adjustment is applied first so
    // R_N can cascade down correctly without creating new ties.
    // The callback fires immediately so the caller can emit SSE events BEFORE the
    // verdict LLM call begins — ensuring the client sees corrected scores first.
    const gapAdjustments = this.enforceAllLogicGaps();
    if (gapAdjustments.length > 0) onGapAdjustments?.(gapAdjustments);

    // Re-run harmonization after enforcement: enforceAllLogicGaps mutates
    // absoluteScoreHistory, so the per-turn pass (run during processTurn) is
    // stale. This catches Draw spread flags where a curTurn score was pulled
    // down into a spread with prevTurn, and WIN near-zero gap flags where the
    // reverse-pass cascade left a margin below MIN_LOGIC_WIN_GAP.
    this.recomputeAllHarmonizationFlags();

    const judge = this.panel.judges[0];
    const VERDICT_TIMEOUT_MS = 60_000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn("[Narrative Judge] Verdict timed out");
        controller.abort();
      }, VERDICT_TIMEOUT_MS);

      const verdict = await generateNarrativeVerdictText(
        judge,
        fullTranscript,
        agentA.id,
        agentA.name,
        agentB.id,
        agentB.name,
        topic,
        this.panel.scorecard,
        controller.signal,
      ).finally(() => clearTimeout(timer));

      // Strip CJK characters that may leak through from non-English judge models.
      verdict.text = verdict.text
        .replace(CJK_CLEAN_RE, " ") // space not empty-string to prevent word-boundary merges
        .replace(/  +/g, " ")
        .trim();

      // Compute scorecard internal consistency unconditionally — the round-count leader
      // (overallWinner) and cumulative-points leader may differ even when the narrative
      // agrees with the round-count winner. Both splits must always be surfaced.
      const tallies = Object.values(this.panel.scorecard.winTallies);
      const maxWins =
        tallies.length >= 2 ? Math.max(...tallies.map((t) => t.total)) : -1;
      const winCountLeaders = tallies.filter((t) => t.total === maxWins);
      // In a tie there is no single win-count leader; skip the consistency check.
      const winCountLeader =
        winCountLeaders.length === 1 ? winCountLeaders[0].agentName : null;

      const pointsTotals = Object.entries(this.panel.currentScores)
        .map(([id, s]) => ({
          id,
          agentName: s.agentName,
          total: s.totalScore,
        }))
        .sort((a, b) => b.total - a.total);
      const maxPoints = pointsTotals[0]?.total ?? -Infinity;
      // In a points tie there is also no single leader; skip the consistency check.
      const pointsLeaderName =
        pointsTotals.filter((p) => p.total === maxPoints).length === 1
          ? (pointsTotals[0]?.agentName ?? null)
          : null;

      const scorecardInternallyConsistent =
        winCountLeader !== null &&
        pointsLeaderName !== null &&
        winCountLeader === pointsLeaderName;
      verdict.scorecardInternallyConsistent = scorecardInternallyConsistent;

      const scorecardSummary = [agentA.id, agentB.id]
        .map((id) => {
          const t = this.panel.scorecard.winTallies[id];
          const s = this.panel.currentScores[id];
          if (!t) return "";
          const absScore = s ? ` | abs score ${s.totalScore.toFixed(1)}` : "";
          return `${t.agentName}: Logic ${t.logic}, Tactics ${t.tactics}, Rhetoric ${t.rhetoric} (${t.total} total${absScore})`;
        })
        .filter(Boolean)
        .join(" | ");

      // When scorecard and narrative disagree, generate a conflict resolution adjudication.
      if (!verdict.agreesWithScorecard && verdict.favouredAgentId) {
        try {
          const scorecardWinnerName = this.panel.scorecard.overallWinner
            ? this.panel.scorecard.winTallies[
                this.panel.scorecard.overallWinner
              ]?.agentName || "Unknown"
            : "Draw";
          const narrativeFavouredName =
            verdict.favouredAgentId === agentA.id ? agentA.name : agentB.name;

          const adjController = new AbortController();
          const adjTimer = setTimeout(() => adjController.abort(), 20_000);
          const claimedOverridePattern = extractClaimedOverridePattern(
            verdict.text,
          );
          const conflictResolutionText = await generateConflictResolution(
            judge,
            scorecardWinnerName,
            narrativeFavouredName,
            scorecardSummary,
            verdict.text,
            scorecardInternallyConsistent,
            claimedOverridePattern,
            adjController.signal,
          ).finally(() => clearTimeout(adjTimer));
          const cjkClean = conflictResolutionText
            .replace(CJK_CLEAN_RE, " ") // space not empty-string
            .replace(/  +/g, " ")
            .trim();
          if (cjkClean.length > 0) {
            verdict.conflictResolution = cjkClean;
          }
        } catch {
          // Adjudication failed — non-critical
        }
      }

      // Meta-judge harmonization — reconcile per-round scores with arc-level coherence.
      //
      // NOTE: `rubricConsistency` is treated as internal-only / enhanced-reporting metadata.
      // It is best-effort and may not be serialized or streamed to all downstream consumers;
      // callers that need this detail must explicitly opt in to handle it.
      //
      // Positional convergence detection runs in parallel with harmonization.
      // Only attempted for debates with ≥ 10 turns (5+ per agent).
      await Promise.all([
        (async () => {
          try {
            const harmController = new AbortController();
            const harmTimer = setTimeout(() => harmController.abort(), 15_000);
            const harmonizationText = await generateRubricHarmonization(
              judge,
              this.panel.scorecard.rounds,
              agentA.name,
              agentB.name,
              verdict.text,
              harmController.signal,
            ).finally(() => clearTimeout(harmTimer));
            if (harmonizationText.trim().length > 0) {
              verdict.rubricConsistency = harmonizationText.trim();
            }
          } catch {
            // Harmonization failed — non-critical
          }
        })(),
        (async () => {
          if (fullTranscript.length < 10) return;
          try {
            const convController = new AbortController();
            const convTimer = setTimeout(() => convController.abort(), 15_000);
            const convergence = await detectPositionalConvergence(
              judge,
              fullTranscript,
              agentA.name,
              agentB.name,
              topic,
              convController.signal,
              agentA.id,
              agentB.id,
            ).finally(() => clearTimeout(convTimer));
            verdict.convergence = convergence;
          } catch {
            // Convergence detection failed — non-critical
          }
        })(),
      ]);

      if (gapAdjustments.length > 0) verdict.gapAdjustments = gapAdjustments;

      return verdict;
    } catch (error) {
      console.error("[Narrative Judge] generateNarrativeVerdict threw:", error);
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
    judgeAnalyses: any[],
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
        rhetoricWins: 0,
      };
    } else {
      const agentScore = this.panel.currentScores[agent.id];
      agentScore.totalScore += scores.overallScore;
      agentScore.turnScores.push(scores);
      agentScore.momentumScore += momentumShift;
      agentScore.frameControlScore += frameControlShift;
      agentScore.tacticalEffectiveness =
        (agentScore.tacticalEffectiveness + scores.tacticalEffectiveness) / 2;
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
    const currentMomentum =
      this.panel.momentumTracker.currentMomentum[agent.id] || 0;
    this.panel.momentumTracker.currentMomentum[agent.id] =
      currentMomentum + momentumShift;
    this.panel.momentumTracker.lastMomentumShift[agent.id] = momentumShift;
    this.panel.momentumTracker.momentumHistory[this.panel.turnCount] = {
      ...this.panel.momentumTracker.momentumHistory[this.panel.turnCount],
      [agent.id]: currentMomentum + momentumShift,
    };

    if (momentumShift > 5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = "rising";
    } else if (momentumShift < -5) {
      this.panel.momentumTracker.momentumTrend[agent.id] = "falling";
    } else {
      this.panel.momentumTracker.momentumTrend[agent.id] = "stable";
    }

    const currentControl =
      this.panel.frameControlTracker.currentControl[agent.id] || 0;
    this.panel.frameControlTracker.currentControl[agent.id] =
      currentControl + frameControlShift;
    this.panel.frameControlTracker.lastControlShift[agent.id] =
      frameControlShift;
    this.panel.frameControlTracker.controlHistory[this.panel.turnCount] = {
      ...this.panel.frameControlTracker.controlHistory[this.panel.turnCount],
      [agent.id]: currentControl + frameControlShift,
    };

    const allControls = this.panel.frameControlTracker.currentControl;
    const entries = Object.entries(allControls);
    if (entries.length > 0) {
      const dominantAgent = entries.reduce((a, b) =>
        allControls[a[0]] > allControls[b[0]] ? a : b,
      );
      this.panel.frameControlTracker.dominantFrame = dominantAgent[0];
    }
  }

  getCurrentLeader(): {
    agentId: string;
    agentName: string;
    score: number;
  } | null {
    const scores = Object.entries(this.panel.currentScores);
    if (scores.length === 0) return null;
    const leader = scores.reduce((a, b) =>
      a[1].totalScore > b[1].totalScore ? a : b,
    );
    return {
      agentId: leader[0],
      agentName: leader[1].agentName,
      score: leader[1].totalScore,
    };
  }

  getScoreDifferential(): { leader: string; differential: number } | null {
    const scores = Object.values(this.panel.currentScores);
    if (scores.length < 2) return null;
    scores.sort((a, b) => b.totalScore - a.totalScore);
    return {
      leader: scores[0].agentName,
      differential: scores[0].totalScore - scores[1].totalScore,
    };
  }

  getMomentumLeader(): {
    agentId: string;
    momentum: number;
    trend: string;
  } | null {
    const momentum = Object.entries(this.panel.momentumTracker.currentMomentum);
    if (momentum.length === 0) return null;
    const leader = momentum.reduce((a, b) => (a[1] > b[1] ? a : b));
    return {
      agentId: leader[0],
      momentum: leader[1],
      trend: this.panel.momentumTracker.momentumTrend[leader[0]] || "stable",
    };
  }

  getFrameControlLeader(): { agentId: string; control: number } | null {
    const control = Object.entries(
      this.panel.frameControlTracker.currentControl,
    );
    if (control.length === 0) return null;
    const leader = control.reduce((a, b) => (a[1] > b[1] ? a : b));
    return { agentId: leader[0], control: leader[1] };
  }

  reset(
    debaterModelIds?: string[],
    mode: "debate" | "document_audit" = "debate",
  ): void {
    this.mode = mode;
    // Pick a new judge model if debater IDs provided
    const newJudgeModelId = debaterModelIds
      ? selectJudgeModel(debaterModelIds)
      : this.panel.judges[0]?.modelId || "kimi-k2:1t-cloud";

    this.panel.judges[0].modelId = newJudgeModelId;
    this.panel.judges[0].lastAnalysis = null;
    this.panel.judges[0].analysisCount = 0;

    this.panel.currentScores = {};
    this.panel.momentumTracker = {
      currentMomentum: {},
      momentumHistory: {},
      lastMomentumShift: {},
      momentumTrend: {},
    };
    this.panel.frameControlTracker = {
      currentControl: {},
      controlHistory: {},
      lastControlShift: {},
      dominantFrame: null,
    };
    this.panel.turnCount = 0;
    this.panel.scorecard = {
      rounds: [],
      winTallies: {},
      overallWinner: null,
      counterfactualTrack: {},
    };
    this.panel.previousTurn = null;
    this.panel.lastAbsoluteScores = {};
    this.panel.absoluteScoreHistory = {};
    this.panel.claimFlagRegister = [];
    this.panel.retroactiveDeltas = {};
    this.panel.convergenceDetectedTurn = undefined;
  }

  getPanelState(): LiveJudgePanel {
    return { ...this.panel };
  }

  getJudge(judgeId: string): LiveJudge | undefined {
    return this.panel.judges.find((j) => j.id === judgeId);
  }

  getAllJudges(): LiveJudge[] {
    return [...this.panel.judges];
  }
}

// ── Session-scoped instances (one LiveJudgeSystem per active debate) ──────────
//
// Each call to POST /api/chat generates a unique debateId (UUID) and creates
// an isolated LiveJudgeSystem for that debate.  All subsequent requests that
// belong to the same debate pass the debateId so they operate on the right
// instance rather than on a shared global.  This prevents state from leaking
// between concurrent users.

const _sessions = new Map<string, LiveJudgeSystem>();

/** Create (or replace) the isolated LiveJudgeSystem for a debate session. */
export function createLiveJudgeSession(
  sessionId: string,
  debaterModelIds?: string[],
  mode: "debate" | "document_audit" = "debate",
): void {
  const system = new LiveJudgeSystem();
  system.reset(debaterModelIds, mode);
  _sessions.set(sessionId, system);
}

/** Return the LiveJudgeSystem for an existing session. Throws if not found. */
export function getSessionSystem(sessionId: string): LiveJudgeSystem {
  const system = _sessions.get(sessionId);
  if (!system) {
    throw new Error(`No live judge session for ID: ${sessionId}`);
  }
  return system;
}

/** Remove the session from the map once the debate is fully over. */
export function deleteSession(sessionId: string): void {
  _sessions.delete(sessionId);
}

// ── Legacy singleton — kept for unit tests only ───────────────────────────────

let liveJudgeSystem: LiveJudgeSystem | null = null;

export function getLiveJudgeSystem(): LiveJudgeSystem {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  return liveJudgeSystem;
}

export function resetLiveJudgeSystem(
  debaterModelIds?: string[],
  mode: "debate" | "document_audit" = "debate",
): void {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  liveJudgeSystem.reset(debaterModelIds, mode);
}
