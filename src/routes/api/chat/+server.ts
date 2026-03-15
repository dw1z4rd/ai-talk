import type { RequestHandler } from "@sveltejs/kit";
import {
  buildAdaptiveAgents,
  generateAdaptiveReply,
  resetLiveJudgeDebate,
  generateDebateNarrativeVerdict,
  getDebateScorecard,
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
  const agentBId = agentB ?? "devstral-small-2:24b-cloud";

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
        while (turn < totalTurns) {
          const agent = agents[turn % agents.length];
          const opponentAgent = agents[(turn + 1) % agents.length];
          const turnNumber = turn + 1;

          const result = await generateAdaptiveReply(
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

          if (!result.reply) {
            turn++;
            continue;
          }

          // Send judge results: includes pairwise round data if available
          if (result.judgeResult) {
            const jr = result.judgeResult;
            send({
              type: "judgeResult",
              agentId: agent.id,
              turnNumber: jr.turnNumber,
              scores: jr.scores,
              momentumShift: jr.momentumShift,
              frameControlShift: jr.frameControlShift,
              tacticalAnalysis: jr.tacticalAnalysis,
              reasoning: jr.reasoning,
              // Pairwise scoring fields (undefined on Turn 1 opening)
              pairwiseRound: jr.pairwiseRound ?? null,
              scorecard: jr.scorecard ?? null,
              absoluteScores: jr.absoluteScores ?? null,
            });
          }

          turn++;
          await new Promise((r) => setTimeout(r, 250));
        }

        // ── Post-debate: narrative verdict ────────────────────────────────
        const debateAgentHistory = history.filter(
          (m) => m.agentId !== "moderator",
        );
        const scorecard = getDebateScorecard();

        if (scorecard.rounds.length > 0) {
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
