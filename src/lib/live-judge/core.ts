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

// ── Judge model selection ─────────────────────────────────────────────────────

const JUDGE_MODEL_ID = "kimi-k2:1t-cloud";

/**
 * Always returns Kimi K2 as the judge model.
 */
export function selectJudgeModel(_excludeModelIds: string[]): string {
  return JUDGE_MODEL_ID;
}

// ── LiveJudgeSystem ───────────────────────────────────────────────────────────

export class LiveJudgeSystem {
  private panel: LiveJudgePanel;

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
    const PER_JUDGE_TIMEOUT_MS = 45_000;

    let pairwiseRound: PairwiseRound | undefined;
    let aggregatedScores: JudgeScores;
    let judgeAnalyses: any[] = [];
    let absoluteScores: JudgeScores | undefined;

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
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          PER_JUDGE_TIMEOUT_MS,
        );
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
          controller.signal,
        ).finally(() => clearTimeout(timer));
        judge.lastAnalysis = openingAnalysis;
        judge.analysisCount++;
        judgeAnalyses = [openingAnalysis];
        aggregatedScores = openingAnalysis.scores;
        absoluteScores = openingAnalysis.scores;
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
        const controller = new AbortController();
        const timer = setTimeout(() => {
          console.warn(
            `[Pairwise Judge] Round ${roundNumber} timed out after ${PER_JUDGE_TIMEOUT_MS}ms`,
          );
          controller.abort();
        }, PER_JUDGE_TIMEOUT_MS);

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
          controller.signal,
          openFlagsForPrev.length > 0 ? openFlagsForPrev : undefined,
        );
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
          controller.signal,
          pairwiseResult.suspectClaims,
        )
          .catch(() => null)
          .finally(() => clearTimeout(timer));

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
              this.panel.claimFlagRegister.push({
                flagId,
                agentId: prevAgentId,
                agentName: prevAgentName,
                originTurn: prevTurnNumber,
                claim: claimText,
                status: "unresolved",
              });
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
          let curFlagsSeeded = 0;
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
              this.panel.claimFlagRegister.push({
                flagId,
                agentId: agent.id,
                agentName: agent.name,
                originTurn: turnNumber,
                claim: claimText,
                status: "unresolved",
              });
              curFlagsSeeded++;
            }
          }
          if (curFlagsSeeded > 0) {
            const curAgentSuspectClaims = pairwiseResult.suspectClaims.filter(
              (c) => c.toLowerCase().startsWith(agent.name.toLowerCase() + ":"),
            );
            console.log(
              `[Claim Flags] Round ${roundNumber} early-registered ${curFlagsSeeded}/${curAgentSuspectClaims.length} flag(s) for ${agent.name} T${turnNumber}`,
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
          for (const update of pairwiseResult.flagUpdates) {
            const { flagId, targetTurn, deltaRaw, updateType } = update;

            // Find the original flag so we can enforce the restore cap.
            const flag = this.panel.claimFlagRegister.find(
              (f) => f.flagId === flagId,
            );

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

            // Accumulate in retroactiveDeltas (values are deltas on the 0-40 scale)
            const scaledDelta = effectiveDelta * 4;
            const existing =
              this.panel.retroactiveDeltas[targetTurn]?.logicalCoherence ?? 0;
            this.panel.retroactiveDeltas[targetTurn] = {
              ...this.panel.retroactiveDeltas[targetTurn],
              logicalCoherence: existing + scaledDelta,
            };

            // Mirror the same delta into absoluteScoreHistory so re-reconciliation
            // uses the post-penalty score when re-evaluating tied rounds.
            const hist = this.panel.absoluteScoreHistory[targetTurn];
            if (hist) {
              this.panel.absoluteScoreHistory[targetTurn] = {
                ...hist,
                logicalCoherence: Math.max(
                  0,
                  hist.logicalCoherence + scaledDelta,
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
              `[Claim Flags] ${updateType} on ${flagId} → T${targetTurn} logicalCoherence ${effectiveDelta > 0 ? "+" : ""}${effectiveDelta * 4} (scaled)`,
            );
          }

          // ── Re-reconcile pairwise round winners ─────────────────────────────
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

              // Re-compute harmonization flags using post-penalty absolute scores
              // and the (possibly reconciled) pairwise winners. Flags computed at
              // round-processing time used pre-penalty lastAbsoluteScores and
              // become stale when retroactive penalties or restores mutate
              // absoluteScoreHistory — causing the export to show a flag whose
              // absolute-score leader disagrees with the current score table.
              const postPenaltyRound = this.panel.scorecard.rounds[ri];
              const recomputedFlags = computeHarmonizationFlags(
                postPenaltyRound,
                curAbs,
                prevAbs,
              );
              this.panel.scorecard.rounds[ri] = {
                ...postPenaltyRound,
                harmonizationFlags:
                  recomputedFlags.length > 0 ? recomputedFlags : undefined,
              };
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
          // Persist for next round's harmonization check and retroactive re-reconciliation
          this.panel.lastAbsoluteScores[agent.id] = absoluteScores;
          this.panel.absoluteScoreHistory[turnNumber] = absoluteScores;
        }

        // Reconcile pairwise winners with absolute scores: when both turns score
        // identically on a dimension, the winner is reset to "tie" so no scorecard
        // win is counted for either agent.
        if (absoluteScores && !pairwiseRound.isFallback) {
          pairwiseRound = reconcileRoundWinners(
            pairwiseRound,
            absoluteScores,
            this.panel.lastAbsoluteScores[pairwiseRound.prevTurn.agentId],
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
        // logicalCoherence stays binary (14/30 validated) and overallScore
        // stays win-count-mapped (30/45/65/82) to keep momentum calibration intact.
        if (absoluteScores) {
          aggregatedScores = {
            ...aggregatedScores,
            rhetoricalForce: absoluteScores.rhetoricalForce,
            tacticalEffectiveness: absoluteScores.tacticalEffectiveness,
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

    // Compute harmonization flags for this round (synchronous, no LLM)
    const harmonizationFlags: HarmonizationFlag[] =
      pairwiseRound && !pairwiseRound.isFallback
        ? computeHarmonizationFlags(
            pairwiseRound,
            absoluteScores,
            this.panel.lastAbsoluteScores[pairwiseRound.prevTurn.agentId],
          )
        : [];
    if (harmonizationFlags.length > 0) {
      harmonizationFlags.forEach((f) =>
        console.warn(
          `[Harmonization] Round ${f.roundNumber} ${f.dimension}: pairwise winner diverges from absolute scores by ${f.divergenceMagnitude} — ${f.note}`,
        ),
      );
      // Attach flags to the round and keep the scorecard's stored copy in sync
      // so the export and UI can surface them.
      if (pairwiseRound) {
        pairwiseRound = { ...pairwiseRound, harmonizationFlags };
        this.panel.scorecard = {
          ...this.panel.scorecard,
          rounds: this.panel.scorecard.rounds.map((r) =>
            r.roundNumber === pairwiseRound!.roundNumber ? pairwiseRound! : r,
          ),
        };
      }
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
    const hiddenDirective = generateHiddenDirective(
      aggregatedScores,
      turnNumber + 1,
      {
        noCounterfactualYet,
        mechanismFailureLastRound,
      },
    );
    if (hiddenDirective) {
      console.log(
        `[Hidden Directive] Turn ${turnNumber} → preview for Turn ${turnNumber + 1} (${agent.name}): ${hiddenDirective}`,
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
        harmonizationFlags.length > 0 ? harmonizationFlags : undefined,
      retroactiveDeltas:
        pairwiseRound?.flagUpdates && pairwiseRound.flagUpdates.length > 0
          ? { ...this.panel.retroactiveDeltas }
          : undefined,
    };
  }

  /**
   * Create a TurnAnalysis-compatible object from pairwise scores for pressure.ts.
   */
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
   * Generate the full-debate narrative verdict. Call this after all turns complete.
   */
  async generateNarrativeVerdict(
    fullTranscript: Message[],
    topic: string,
    agentA: Agent,
    agentB: Agent,
  ): Promise<NarrativeVerdict | null> {
    if (this.panel.scorecard.rounds.length === 0) return null;

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
          const trimmedConflictResolution = conflictResolutionText.trim();
          if (trimmedConflictResolution.length > 0) {
            verdict.conflictResolution = trimmedConflictResolution;
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

  reset(debaterModelIds?: string[]): void {
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

// ── Singleton ─────────────────────────────────────────────────────────────────

let liveJudgeSystem: LiveJudgeSystem | null = null;

export function getLiveJudgeSystem(): LiveJudgeSystem {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  return liveJudgeSystem;
}

export function resetLiveJudgeSystem(debaterModelIds?: string[]): void {
  if (!liveJudgeSystem) {
    liveJudgeSystem = new LiveJudgeSystem();
  }
  liveJudgeSystem.reset(debaterModelIds);
}
