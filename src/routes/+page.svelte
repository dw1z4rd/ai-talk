<script lang="ts">
  import { tick } from "svelte";
  import { getModelInfo } from "$lib/debate/models";
  import type { ChatMessage, ContextFile } from "$lib/debate/models";
  import WinnerModal from "./WinnerModal.svelte";
  import DebateHeader from "./DebateHeader.svelte";
  import LiveJudgePanel from "./LiveJudgePanel.svelte";
  import DebateSetup from "./DebateSetup.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import ExportBar from "./ExportBar.svelte";
  import { flyInFromLeft, flyOutToRight } from "$lib/transitions";

  let topic = $state("");
  let turns = $state(4);
  let messages = $state<ChatMessage[]>([]);
  let running = $state(false);
  let isPaused = $state(false);
  let done = $state(false);
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let abortController = $state<AbortController | null>(null);
  let agentA = $state("kimi-k2:1t-cloud");
  let agentB = $state("devstral-small-2:24b-cloud");
  let leftAgentId = $state("kimi-k2:1t-cloud");
  let typingAgentName = $state("");
  let typingAgentColor = $state("");
  let streamingMessage = $state<ChatMessage | null>(null);

  // Files
  let contextFiles = $state<ContextFile[]>([]);

  // Derived progress
  let progress = $derived(
    turns > 0 ? Math.min((messages.length / (turns * 2)) * 100, 100) : 0,
  );

  // ── Live Judge Phase ─────────────────────────────────────────────────────────
  let naturallyEnded = $state(false);
  let showLiveJudgePanel = $state(false);

  let liveJudgeResults = $state<any[]>([]);
  let pairwiseRounds = $state<any[]>([]);
  let finalScorecard = $state<any>(null);
  let narrativeVerdict = $state<any>(null);
  let finalJudgePanel = $state<any>(null);
  let currentLeader = $state<any>(null);
  let momentumLeader = $state<any>(null);
  let frameControlLeader = $state<any>(null);

  // Judge activity indicator
  let judgeStatus = $state<'scoring' | 'writing_verdict' | null>(null);

  // Winner modal
  let winner = $state<{ id: string; name: string; color: string } | null>(null);
  let winnerScore = $state(0);
  let showWinnerModal = $state(false);

  // ── Live Judge logic ───────────────────────────────────────────────────────
  async function runLiveJudging() {
    try {
      const scorecardData = finalScorecard ?? null;
      let winnerId: string | null = null;

      if (scorecardData?.overallWinner) {
        winnerId = scorecardData.overallWinner;
      } else if (currentLeader?.agentId) {
        winnerId = currentLeader.agentId;
      }

      try {
        const response = await fetch("/api/judge");
        if (response.ok) {
          const data = await response.json();
          finalJudgePanel = data.panelState;

          if (finalJudgePanel?.momentumTracker) {
            const momentumEntries: [string, number][] = Object.entries(
              finalJudgePanel.momentumTracker.currentMomentum || {},
            );
            if (momentumEntries.length > 0) {
              const leaderEntry = momentumEntries.reduce((a, b) =>
                a[1] > b[1] ? a : b,
              );
              momentumLeader = {
                agentId: leaderEntry[0],
                momentum: leaderEntry[1],
              };
            }
          }
          frameControlLeader = finalJudgePanel?.frameControlTracker
            ?.dominantFrame
            ? { agentId: finalJudgePanel.frameControlTracker.dominantFrame }
            : null;
        }
      } catch {
        // Panel fetch failed — winner still determined from SSE events
      }

      if (winnerId) {
        winner = getModelInfo(winnerId);
        const tally = scorecardData?.winTallies?.[winnerId];
        winnerScore = tally ? tally.total : (currentLeader?.score ?? 0);

        await new Promise((r) => setTimeout(r, 800));
        showWinnerModal = true;
      }
    } catch (error) {
      console.error("Failed to run live judging:", error);
    }
  }

  function resetConversation() {
    messages = [];
    done = false;
    errorMsg = "";
    naturallyEnded = false;
    showLiveJudgePanel = false;
    liveJudgeResults = [];
    pairwiseRounds = [];
    finalScorecard = null;
    narrativeVerdict = null;
    finalJudgePanel = null;
    currentLeader = null;
    momentumLeader = null;
    frameControlLeader = null;
    winner = null;
    winnerScore = 0;
    showWinnerModal = false;
    judgeStatus = null;
  }

  function buildContext(): string | undefined {
    if (contextFiles.length === 0) return undefined;
    return contextFiles
      .map((f) => `--- ${f.name} ---\n${f.content}`)
      .join("\n\n");
  }

  function pauseConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    isPaused = true;
    typingAgentName = "";

    if (streamingMessage) {
      messages = [...messages, streamingMessage];
      streamingMessage = null;
    }
  }

  function stopConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    done = true;
    isPaused = false;
    typingAgentName = "";
    streamingMessage = null;
  }

  async function startConversation(resume = false) {
    if (!resume) {
      messages = [];
      leftAgentId = agentA;
      naturallyEnded = false;
      showLiveJudgePanel = false;
      liveJudgeResults = [];
      pairwiseRounds = [];
      finalScorecard = null;
      narrativeVerdict = null;
      finalJudgePanel = null;
      currentLeader = null;
      momentumLeader = null;
      frameControlLeader = null;
      winner = null;
      winnerScore = 0;
      showWinnerModal = false;
    }
    done = false;
    isPaused = false;
    errorMsg = "";
    running = true;
    typingAgentName = "";
    typingAgentColor = "";
    streamingMessage = null;
    judgeStatus = null;
    abortController = new AbortController();
    showLiveJudgePanel = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          turns,
          context: buildContext(),
          agentA,
          agentB,
          messages: resume ? messages : undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        errorMsg = `Server error: ${response.status}`;
        running = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "token") {
            if (!streamingMessage) {
              streamingMessage = {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              };
              typingAgentName = "";
              typingAgentColor = "";
            } else {
              streamingMessage = {
                agentId: streamingMessage.agentId,
                agentName: streamingMessage.agentName,
                color: streamingMessage.color,
                text: streamingMessage.text + data.text,
              };
            }
            await tick();
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              20,
            );
          } else if (data.type === "message") {
            streamingMessage = null;
            typingAgentName = "";
            typingAgentColor = "";
            messages = [
              ...messages,
              {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              },
            ];
            await tick();
            const aiCount = messages.filter(
              (m) => m.agentId !== "moderator",
            ).length;
            if (aiCount < turns * 2 - 1) {
              const nextId = data.agentId === agentA ? agentB : agentA;
              const next = getModelInfo(nextId);
              typingAgentName = next.name;
              typingAgentColor = next.color;
            }
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              50,
            );
          } else if (data.type === "judgeStatus") {
            judgeStatus = data.status ?? null;
          } else if (data.type === "judgeResult") {
            // Don't clear judgeStatus here — another judge may still be in flight.
            // judgeStatus is cleared only by writing_verdict / narrativeVerdict / done.
            liveJudgeResults = [
              ...liveJudgeResults,
              {
                turnNumber: data.turnNumber,
                agentId: data.agentId,
                scores: data.scores,
                momentumShift: data.momentumShift,
                frameControlShift: data.frameControlShift,
                tacticalAnalysis: data.tacticalAnalysis,
                reasoning: data.reasoning,
                absoluteScores: data.absoluteScores ?? null,
              },
            ];

            if (data.pairwiseRound) {
              pairwiseRounds = [...pairwiseRounds, data.pairwiseRound];
            }

            if (
              data.scorecard &&
              Object.keys(data.scorecard.winTallies || {}).length > 0
            ) {
              const tallies: [string, any][] = Object.entries(
                data.scorecard.winTallies,
              );
              const topTally = tallies.sort(
                (a: [string, any], b: [string, any]) => b[1].total - a[1].total,
              )[0];
              if (topTally && topTally[1].total > 0) {
                const info = getModelInfo(topTally[0]);
                currentLeader = {
                  agentId: topTally[0],
                  agentName: topTally[1].agentName || info.name,
                  score: topTally[1].total,
                  winTallies: data.scorecard.winTallies,
                };
              }
            } else {
              const scoreTotals: Record<string, number> = {};
              for (const r of liveJudgeResults) {
                scoreTotals[r.agentId] =
                  (scoreTotals[r.agentId] || 0) +
                  (r.scores?.overallScore ?? 50);
              }
              const topScorer = Object.entries(scoreTotals).sort(
                (a, b) => b[1] - a[1],
              )[0];
              if (topScorer) {
                const info = getModelInfo(topScorer[0]);
                currentLeader = {
                  agentId: topScorer[0],
                  agentName: info.name,
                  score: topScorer[1],
                };
              }
            }

            const momentumTotals: Record<string, number> = {};
            for (const r of liveJudgeResults) {
              momentumTotals[r.agentId] =
                (momentumTotals[r.agentId] || 0) + (r.momentumShift ?? 0);
            }
            const topMomentum = Object.entries(momentumTotals).sort(
              (a, b) => b[1] - a[1],
            )[0];
            momentumLeader = topMomentum
              ? { agentId: topMomentum[0], momentum: topMomentum[1] }
              : null;
          } else if (data.type === "narrativeVerdict") {
            judgeStatus = null;
            narrativeVerdict = {
              text: data.text,
              favouredAgentId: data.favouredAgentId,
              agreesWithScorecard: data.agreesWithScorecard,
              conflictResolution: data.conflictResolution ?? null,
              scorecardInternallyConsistent: data.scorecardInternallyConsistent,
              convergence: data.convergence ?? null,
            };
          } else if (data.type === "finalScorecard") {
            finalScorecard = data.scorecard;
            if (data.scorecard?.winTallies) {
              const tallies: [string, any][] = Object.entries(
                data.scorecard.winTallies,
              );
              const topTally = tallies.sort(
                (a: [string, any], b: [string, any]) => b[1].total - a[1].total,
              )[0];
              if (topTally) {
                const info = getModelInfo(topTally[0]);
                currentLeader = {
                  agentId: topTally[0],
                  agentName: topTally[1].agentName || info.name,
                  score: topTally[1].total,
                  winTallies: data.scorecard.winTallies,
                };
              }
            }
          } else if (data.type === "done") {
            judgeStatus = null;
            done = true;
            running = false;
            naturallyEnded = true;
            typingAgentName = "";
            runLiveJudging();
          } else if (data.type === "error") {
            errorMsg = data.message || "An AI failed to respond.";
            running = false;
            typingAgentName = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        // User manually stopped
      } else {
        errorMsg = `Connection error: ${String(err)}`;
      }
    } finally {
      running = false;
      typingAgentName = "";
      streamingMessage = null;
    }
  }
</script>

<WinnerModal
  bind:showWinnerModal
  {winner}
  {winnerScore}
  {finalScorecard}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-[90vw] max-w-[1600px] mx-auto flex flex-col gap-4 px-[6px]"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => e.preventDefault()}
>
  <DebateHeader />

  <!-- ── Two-column desktop layout ─────────────────────────────────────────── -->
  <div class="main-two-col">
    <!-- LEFT COLUMN: judge analysis panel -->
    {#if showLiveJudgePanel}
      <div
        class="left-col"
        in:flyInFromLeft={{ duration: 500 }}
        out:flyOutToRight={{ duration: 400 }}
      >
        <LiveJudgePanel
          {liveJudgeResults}
          {pairwiseRounds}
          {narrativeVerdict}
          {currentLeader}
          {judgeStatus}
        />
      </div>
    {/if}

    <!-- RIGHT COLUMN: debate setup + live chat -->
    <div class="right-col">
      <DebateSetup
        bind:topic
        bind:turns
        bind:agentA
        bind:agentB
        bind:contextFiles
        {running}
        {isPaused}
        {errorMsg}
        onstart={() => { if (!running && topic.trim()) startConversation(); }}
        onresume={() => startConversation(true)}
        onpause={pauseConversation}
        onstop={stopConversation}
        onmoderatormessage={(text) => {
          messages = [
            ...messages,
            {
              agentId: "moderator",
              agentName: "Moderator",
              color: "#ff4b4b",
              text,
            },
          ];
          startConversation(true);
        }}
      />

      <ChatPanel
        {messages}
        {running}
        {done}
        {progress}
        {turns}
        {streamingMessage}
        {typingAgentName}
        {typingAgentColor}
        {leftAgentId}
        {agentA}
        {agentB}
        bind:chatEl
      />
    </div>
  </div>
</div>

<!-- Export -->
{#if messages.length > 0}
  <ExportBar
    {messages}
    {topic}
    {turns}
    {agentA}
    {agentB}
    {pairwiseRounds}
    {finalScorecard}
    {currentLeader}
    {narrativeVerdict}
    {liveJudgeResults}
    onreset={resetConversation}
  />
{/if}

<style>
  /* Two-column desktop layout: judge panel left, setup+chat right. */
  .main-two-col {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    align-items: start;
    justify-content: center;
  }

  .left-col {
    width: 45vw;
    max-width: 760px;
    min-width: min(280px, 100%);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .right-col {
    width: 45vw;
    max-width: 760px;
    min-width: min(280px, 100%);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  @media (max-width: 1023px) {
    .left-col,
    .right-col {
      width: 100%;
      max-width: 100%;
    }
  }
</style>
