import type { RequestHandler } from "@sveltejs/kit";
import { getLiveJudgeState, resetLiveJudgeDebate } from "$lib/agents";

// Get current live judge panel state.
// Pass ?debateId=<uuid> to read the session-scoped state for a specific debate.
export const GET: RequestHandler = async ({ url }) => {
  try {
    const debateId = url.searchParams.get("debateId") ?? undefined;
    const judgeState = getLiveJudgeState(debateId);

    return new Response(
      JSON.stringify({
        success: true,
        panelState: judgeState,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
};

// Reset live judge system
export const DELETE: RequestHandler = async () => {
  try {
    resetLiveJudgeDebate();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Live judge system reset successfully",
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
};
