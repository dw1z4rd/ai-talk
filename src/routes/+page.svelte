<script lang="ts">
  import { tick } from "svelte";
  import { getModelInfo } from "$lib/debate/models";
  import type { ChatMessage, ContextFile } from "$lib/debate/models";
  import WinnerModal from "./WinnerModal.svelte";
  import ScoreUpdateToast from "./ScoreUpdateToast.svelte";
  import DebateHeader from "./DebateHeader.svelte";
  import LiveJudgePanel from "./LiveJudgePanel.svelte";
  import DebateSetup from "./DebateSetup.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import ExportBar from "./ExportBar.svelte";
  import { flyInFromLeft, flyOutToRight } from "$lib/transitions";
  import { splitDocumentIntoChunks } from "$lib/doc-chunker";
  import { repairSpaceDrops } from "$lib/live-judge/text-utils";

  let topic = $state("");
  let turns = $state(4);
  let messages = $state<ChatMessage[]>([]);
  let running = $state(false);
  let isPaused = $state(false);
  let done = $state(false);
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let userScrolled = $state(false);
  let abortController = $state<AbortController | null>(null);

  // Debounced scroll — one rAF per burst of tokens, not one per token.
  // `force` bypasses the pending guard for message-completion events so the
  // final scroll always fires even if a token rAF is already queued.
  let _scrollPending = false;
  function scheduleScroll(force = false) {
    if (userScrolled) return;
    if (!force && _scrollPending) return;
    _scrollPending = true;
    requestAnimationFrame(() => {
      _scrollPending = false;
      if (!userScrolled) chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: "smooth" });
    });
  }
  let docAnalysisMode = $state(false);
  let documentText = $state("");

  $effect(() => {
    const el = chatEl;
    if (!el) return;
    let prevScrollTop = el.scrollTop;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      const scrolledUp = el.scrollTop < prevScrollTop;
      prevScrollTop = el.scrollTop;
      if (atBottom) {
        userScrolled = false;
      } else if (scrolledUp) {
        userScrolled = true;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  });

  let leftColEl = $state<HTMLElement | null>(null);
  let leftColHeight = $state(0);
  $effect(() => {
    const el = leftColEl;
    if (!el) return;
    const ro = new ResizeObserver(() => { leftColHeight = el.offsetHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  });

  let rightColEl = $state<HTMLElement | null>(null);
  let rightColTop = $state(0);
  $effect(() => {
    const el = rightColEl;
    if (!el) return;
    const measure = () => { rightColTop = el.getBoundingClientRect().top + window.scrollY; };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    return () => window.removeEventListener('resize', measure);
  });

  let rightColStyle = $derived(
    [
      rightColTop > 0 ? `min-height: calc(100dvh - ${rightColTop}px)` : 'min-height: 32rem',
      showLiveJudgePanel && leftColHeight > 0 ? `height: ${leftColHeight}px` : '',
    ].filter(Boolean).join('; ')
  );

  let agentA = $state("kimi-k2.5:cloud");
  let agentB = $state("qwen3-next:80b-cloud");
  let leftAgentId = $state("qwen3-next:80b-cloud");
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

  // Scopes all live-judge reads to the debate that produced this stream.
  // Set from the 'debateId' SSE event; prevents cross-user state leakage.
  let currentDebateId = $state<string | null>(null);

  let liveJudgeResults = $state<any[]>([]);
  // Cumulative retroactive logic deltas per turn number (from flag_updates)
  let scoreDeltas = $state<Record<number, number>>({});
  let pairwiseRounds = $state<any[]>([]);
  let finalScorecard = $state<any>(null);
  let narrativeVerdict = $state<any>(null);
  let finalJudgePanel = $state<any>(null);
  let currentLeader = $state<any>(null);
  let momentumLeader = $state<any>(null);
  let frameControlLeader = $state<any>(null);
  // Incremental accumulators — updated in O(1) per judgeResult event
  let _scoreTotals = $state<Record<string, number>>({});
  let _momentumTotals = $state<Record<string, number>>({});

  // Judge activity indicator
  let judgeStatus = $state<'scoring' | 'writing_verdict' | null>(null);

  // Score update toasts
  interface ScoreUpdateNotification {
    id: string;
    targetTurn: number;
    agentId: string;
    agentName: string;
    agentColor: string;
    deltaLogic: number;
    reason: string;
    updateType: "penalty" | "partial_restore";
  }
  let scoreUpdateNotifications = $state<ScoreUpdateNotification[]>([]);

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
        const response = await fetch(
          currentDebateId ? `/api/judge?debateId=${currentDebateId}` : "/api/judge"
        );
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
        const overrides = docAnalysisMode ? { [agentA]: { name: "Document", color: "#94a3b8" } } : {};
        const override = overrides[winnerId];
        winner = override ? { id: winnerId, ...override } : getModelInfo(winnerId);
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
    userScrolled = false;
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
    _scoreTotals = {};
    _momentumTotals = {};
    currentDebateId = null;
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

    // Discard any partial generation — the interrupted agent's turn was incomplete.
    // On resume the server recomputes whose turn it is from history length, so
    // discarding here means they start that turn over from the beginning.
    streamingMessage = null;
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
      userScrolled = false;
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
      scoreDeltas = {};
      _scoreTotals = {};
      _momentumTotals = {};
      currentDebateId = null;
    }
    done = false;
    isPaused = false;
    errorMsg = "";

    // Guard: doc mode requires document content
    if (docAnalysisMode && !documentText.trim()) {
      errorMsg = "Paste or upload a document before analysing.";
      return;
    }

    running = true;
    typingAgentName = "";
    typingAgentColor = "";
    streamingMessage = null;
    judgeStatus = null;
    abortController = new AbortController();
    showLiveJudgePanel = true;

    try {
      const chunks =
        docAnalysisMode && documentText.trim()
          ? splitDocumentIntoChunks(documentText)
          : null;
      // Sync turns state so the progress bar reflects actual chunk count.
      if (chunks) turns = chunks.length;
      const documentSegments = chunks
        ? chunks.map((text) => ({
            agentId: agentA,
            agentName: "Document",
            color: "#94a3b8",
            text,
          }))
        : undefined;

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
          documentSegments,
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

          if (data.type === "debateId") {
            currentDebateId = data.debateId;
          } else if (data.type === "turn_start") {
            typingAgentName = data.agentName;
            typingAgentColor = data.color;
          } else if (data.type === "token") {
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
              // Mutate the property in-place on Svelte 5's reactive proxy—
              // avoids allocating a new object + copying 3 unchanged fields on every token
              streamingMessage.text += data.text;
              // Repair fused function-word pairs (space-drop artefacts) eagerly
              // whenever a word boundary just closed (space or newline in the new token).
              if (data.text.includes(' ') || data.text.includes('\n')) {
                streamingMessage.text = repairSpaceDrops(streamingMessage.text);
              }
            }
            await tick();
            scheduleScroll();
          } else if (data.type === "message") {
            streamingMessage = null;
            // Clear the indicator; the next turn_start will re-set it with the
            // correct agent before any tokens arrive. This also ensures the
            // indicator shows generic dots (no name) during the post-debate
            // verdict phase when no turn_start is forthcoming.
            typingAgentName = "";
            typingAgentColor = "";
            messages = [
              ...messages,
              {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: repairSpaceDrops(data.text),
              },
            ];
            await tick();
            scheduleScroll(true);
          } else if (data.type === "judgeStatus") {
            judgeStatus = data.status ?? null;
          } else if (data.type === "judgeResult") {
            // Don't clear judgeStatus here — another judge may still be in flight.
            // judgeStatus is cleared only by writing_verdict / narrativeVerdict / done.
            liveJudgeResults.push({
                turnNumber: data.turnNumber,
                agentId: data.agentId,
                scores: data.scores,
                momentumShift: data.momentumShift,
                frameControlShift: data.frameControlShift,
                tacticalAnalysis: data.tacticalAnalysis,
                reasoning: data.reasoning,
                absoluteScores: data.absoluteScores ?? null,
                scoreBreakdown: data.scoreBreakdown ?? null,
            });

            if (data.pairwiseRound) {
              pairwiseRounds.push(data.pairwiseRound);
              pairwiseRounds.sort((a, b) => a.roundNumber - b.roundNumber);
            }

            // Incrementally update score/momentum accumulators (O(1) per event)
            _scoreTotals[data.agentId] = (_scoreTotals[data.agentId] ?? 0) + (data.scores?.overallScore ?? 50);
            _momentumTotals[data.agentId] = (_momentumTotals[data.agentId] ?? 0) + (data.momentumShift ?? 0);

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
              const topScorer = Object.entries(_scoreTotals).sort(
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

            const topMomentum = Object.entries(_momentumTotals).sort(
              (a, b) => b[1] - a[1],
            )[0];
            momentumLeader = topMomentum
              ? { agentId: topMomentum[0], momentum: topMomentum[1] }
              : null;
          } else if (data.type === "scoreUpdate") {
            // Retroactively patch the absoluteScores entry for the target turn.
            const idx = liveJudgeResults.findIndex(
              (r) => r.turnNumber === data.targetTurn && r.agentId === data.agentId,
            );
            if (idx !== -1 && liveJudgeResults[idx].absoluteScores) {
              // Mutate deeply via $state proxy — no spread allocation needed.
              liveJudgeResults[idx].absoluteScores.logicalCoherence =
                (liveJudgeResults[idx].absoluteScores.logicalCoherence ?? 0) + data.deltaLogic;
            }
            // Accumulate delta for the badge display in the score table
            scoreDeltas[data.targetTurn] = (scoreDeltas[data.targetTurn] ?? 0) + data.deltaLogic;
            const notifId = crypto.randomUUID();
            scoreUpdateNotifications.push({
                id: notifId,
                targetTurn: data.targetTurn,
                agentId: data.agentId,
                agentName: data.agentName,
                agentColor: data.agentColor,
                deltaLogic: data.deltaLogic,
                reason: data.reason,
                updateType: data.updateType,
            });
            setTimeout(() => {
              const i = scoreUpdateNotifications.findIndex((n) => n.id === notifId);
              if (i !== -1) scoreUpdateNotifications.splice(i, 1);
            }, 3500);
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
            // Sync pairwiseRounds to the server's final reconciled rounds so the
            // export display is consistent with the scorecard tallies. Re-reconciliation
            // (triggered by retroactive flag penalties) updates scorecard.rounds on the
            // server but never pushes updated round objects to the client — leaving the
            // client's append-only pairwiseRounds array stale. Using the final scorecard
            // rounds here ensures both the tally numbers and the per-round verdicts
            // shown in the export reflect the same post-reconciliation state.
            if (Array.isArray(data.scorecard?.rounds) && data.scorecard.rounds.length > 0) {
              pairwiseRounds = [...data.scorecard.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
            }
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

<ScoreUpdateToast notifications={scoreUpdateNotifications} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-[90vw] max-w-[1600px] mx-auto flex flex-col gap-4 px-[6px]"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => e.preventDefault()}
>
  <DebateHeader {docAnalysisMode} />

  <!-- ── Two-column desktop layout ─────────────────────────────────────────── -->
  <div class="main-two-col">
    <!-- LEFT COLUMN: judge analysis panel -->
    {#if showLiveJudgePanel}
      <div
        class="left-col"
        bind:this={leftColEl}
        in:flyInFromLeft={{ duration: 400 }}
        out:flyOutToRight={{ duration: 300 }}
      >
        <LiveJudgePanel
          {liveJudgeResults}
          {pairwiseRounds}
          {narrativeVerdict}
          {currentLeader}
          {finalScorecard}
          {judgeStatus}
          {scoreDeltas}
          agentOverrides={docAnalysisMode ? { [agentA]: { name: "Document", color: "#94a3b8" } } : {}}
        />
      </div>
    {/if}

    <!-- RIGHT COLUMN: debate setup + live chat -->
    <div class="right-col" bind:this={rightColEl} style={rightColStyle}>
      <DebateSetup
        bind:topic
        bind:turns
        bind:agentA
        bind:agentB
        bind:contextFiles
        bind:docAnalysisMode
        bind:documentText
        {running}
        {isPaused}
        {errorMsg}
        onstart={() => { if (!running && (topic.trim() || docAnalysisMode)) startConversation(); }}
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
        {docAnalysisMode}
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
    {scoreDeltas}
    agentOverrides={docAnalysisMode ? { [agentA]: { name: "Document", color: "#94a3b8" } } : {}}
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
    overflow: hidden;
  }

  @media (max-width: 1023px) {
    .left-col,
    .right-col {
      width: 100%;
      max-width: 100%;
    }
  }
</style>
