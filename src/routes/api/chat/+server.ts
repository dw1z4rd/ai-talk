import type { RequestHandler } from "@sveltejs/kit";
import {
  buildAdaptiveAgents,
  generateAdaptiveReply,
  resetLiveJudgeDebate,
  generateDebateNarrativeVerdict,
  getDebateScorecard,
  MODEL_CATALOG,
} from "$lib/agents";
import type { Message } from "$lib/agents";

// Each SSE event is JSON: { type: 'token' | 'message' | 'judgeResult' | 'narrativeVerdict' | 'finalScorecard' | 'done' | 'error', ... }

export const POST: RequestHandler = async ({ request }) => {
  const { topic, turns, context, agentA, agentB, messages } =
    (await request.json()) as {
      topic: string;
      turns: number;
      context?: string;
      agentA?: string;
      agentB?: string;
      messages?: Message[];
    };

  const safeTopic = topic?.trim() || "What is consciousness?";
  const totalTurns = Math.min(Number(turns) || 12, 30) * 2; // Multiply by 2 debaters

  const agentAId = agentA ?? "kimi-k2:1t-cloud";
  const agentBId = agentB ?? "nemotron-3-super-cloud";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Reset live judge system, passing debater IDs so the judge
        // model can be selected to differ from the debaters.
        resetLiveJudgeDebate([agentAId, agentBId]);

        const history: Message[] = (messages || []).map((m: any) => {
          if (m.agentId === "moderator") {
            return {
              agentId: "moderator",
              agentName: "Moderator",
              text: `The debate was interrupted by the Moderator, who said: '${m.text}'. You must address this point before continuing your attack on your opponent.`,
            };
          }
          return m;
        });

        // When resuming, derive agent ordering from the first speaker so
        // turn parity is preserved; on a fresh debate, randomize.
        const firstSpeakerId = history.find(
          (m) => m.agentId !== "moderator",
        )?.agentId;
        const agents = buildAdaptiveAgents(
          agentAId,
          agentBId,
          undefined,
          undefined,
          firstSpeakerId,
        );

        const aiMessagesCount = history.filter(
          (m) => m.agentId !== "moderator",
        ).length;

        let turn = aiMessagesCount;

        // Per-agent pending judge: maps agentId → { promise, turnNumber, emitted }.
        // Results are emitted as soon as the promise resolves via .then() so the
        // UI gets them immediately rather than waiting until the flush point.
        // The flush (at the start of the same agent's next turn, N+2) still awaits
        // the promise to guarantee hiddenDirective is applied before the next reply.
        type PendingJudge = {
          promise: Promise<any>;
          turnNumber: number;
          emitted: boolean;
        };
        const pendingJudges = new Map<string, PendingJudge>();
        let inFlightJudges = 0;

        const emitJudgeResult = (jr: any) => {
          send({
            type: "judgeResult",
            agentId: jr.agentId,
            turnNumber: jr.turnNumber,
            scores: jr.scores,
            momentumShift: jr.momentumShift,
            frameControlShift: jr.frameControlShift,
            tacticalAnalysis: jr.tacticalAnalysis,
            reasoning: jr.reasoning,
            pairwiseRound: jr.pairwiseRound ?? null,
            scorecard: jr.scorecard ?? null,
            absoluteScores: jr.absoluteScores ?? null,
          });
        };

        const emitScoreUpdates = (jr: any) => {
          const flagUpdates: any[] = jr.pairwiseRound?.flagUpdates ?? [];
          for (const update of flagUpdates) {
            const def =
              MODEL_CATALOG[update.agentId] ??
              MODEL_CATALOG["kimi-k2:1t-cloud"];
            send({
              type: "scoreUpdate",
              targetTurn: update.targetTurn,
              agentId: update.agentId,
              agentName: def.name,
              agentColor: def.color,
              deltaLogic: update.deltaRaw * 4,
              reason: update.reason,
              flagId: update.flagId,
              updateType: update.updateType,
            });
          }
        };

        while (turn < totalTurns) {
          const agent = agents[turn % agents.length];
          const opponentAgent = agents[(turn + 1) % agents.length];
          const turnNumber = turn + 1;

          // Await this agent's previous judge before they speak again,
          // ensuring the hiddenDirective is ready for their next reply.
          // The actual SSE emit already happened in the .then() callback below.
          const myPending = pendingJudges.get(agent.id);
          if (myPending) {
            const jr = await myPending.promise;
            if (jr && !myPending.emitted) {
              myPending.emitted = true;
              emitJudgeResult(jr);
              emitScoreUpdates(jr);
            }
            pendingJudges.delete(agent.id);
          }

          const { reply, judgePromise } = await generateAdaptiveReply(
            agent,
            history,
            safeTopic,
            turnNumber,
            opponentAgent,
            context,
            (token) => {
              send({
                type: "token",
                agentId: agent.id,
                agentName: agent.name,
                color: agent.color,
                text: token,
              });
            },
            (reply) => {
              history.push({
                agentId: agent.id,
                agentName: agent.name,
                text: reply,
              });
              send({
                type: "message",
                agentId: agent.id,
                agentName: agent.name,
                color: agent.color,
                text: reply,
              });
            },
          );

          if (!reply) {
            turn++;
            continue;
          }

          // Judge is now running in background. Signal the UI and pipeline it.
          inFlightJudges++;
          send({ type: "judgeStatus", status: "scoring", turnNumber });
          const pendingEntry: PendingJudge = {
            promise: judgePromise,
            turnNumber,
            emitted: false,
          };
          // Emit the result immediately when the promise resolves so the client
          // sees each score as soon as it's ready rather than waiting for the flush.
          judgePromise
            .then((jr) => {
              if (jr && !pendingEntry.emitted) {
                pendingEntry.emitted = true;
                emitJudgeResult(jr);
                emitScoreUpdates(jr);
              }
            })
            .catch(() => {
              /* errors surfaced at the await below */
            })
            .finally(() => {
              inFlightJudges--;
              if (inFlightJudges === 0) {
                send({ type: "judgeStatus", status: null });
              }
            });
          pendingJudges.set(agent.id, pendingEntry);

          turn++;
          await new Promise((r) => setTimeout(r, 250));
        }

        // Await any remaining pending judges (last 1–2 turns) before the verdict.
        // Results were already emitted via .then(); this just ensures completion.
        for (const [, pending] of pendingJudges) {
          const jr = await pending.promise;
          if (jr && !pending.emitted) {
            pending.emitted = true;
            emitJudgeResult(jr);
            emitScoreUpdates(jr);
          }
        }
        pendingJudges.clear();

        // ── Post-debate: narrative verdict ────────────────────────────────
        const debateAgentHistory = history.filter(
          (m) => m.agentId !== "moderator",
        );
        const scorecard = getDebateScorecard();

        if (scorecard.rounds.length > 0) {
          send({ type: "judgeStatus", status: "writing_verdict" });
          try {
            const narrativeVerdict = await generateDebateNarrativeVerdict(
              debateAgentHistory,
              safeTopic,
              agents[0],
              agents[1],
            );

            if (narrativeVerdict) {
              send({
                type: "narrativeVerdict",
                text: narrativeVerdict.text,
                favouredAgentId: narrativeVerdict.favouredAgentId,
                agreesWithScorecard: narrativeVerdict.agreesWithScorecard,
                conflictResolution: narrativeVerdict.conflictResolution ?? null,
                scorecardInternallyConsistent:
                  narrativeVerdict.scorecardInternallyConsistent,
                convergence: narrativeVerdict.convergence ?? null,
              });
            }
          } catch (err) {
            console.error("[Server] Narrative verdict failed:", err);
          }

          // Send final scorecard summary
          send({
            type: "finalScorecard",
            scorecard,
            overallWinner: scorecard.overallWinner,
          });
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
