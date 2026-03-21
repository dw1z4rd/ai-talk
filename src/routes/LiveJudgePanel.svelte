<script lang="ts">
  import { flip } from "svelte/animate";
  import {
    flyInFromTop,
    flyInFromLeft,
    flyOutToRight,
    flyOutToBottom,
  } from "$lib/transitions";
  import { getModelInfo, getWinnerInfo } from "$lib/debate/models";
  import { cubicInOut } from "svelte/easing";

  interface Props {
    liveJudgeResults: any[];
    pairwiseRounds: any[];
    narrativeVerdict: any;
    currentLeader: any;
    finalScorecard?: any;
    judgeStatus?: 'scoring' | 'writing_verdict' | null;
    scoreDeltas?: Record<number, number>;
    agentOverrides?: Record<string, { name: string; color: string }>;
  }

  let { liveJudgeResults, pairwiseRounds, narrativeVerdict, currentLeader, finalScorecard = null, judgeStatus = null, scoreDeltas = {}, agentOverrides = {} }: Props = $props();

  // Track which turn audit panels are expanded (turn number → boolean)
  let expandedBreakdowns = $state<Set<number>>(new Set());
  function toggleBreakdown(turnNumber: number) {
    const next = new Set(expandedBreakdowns);
    if (next.has(turnNumber)) next.delete(turnNumber);
    else next.add(turnNumber);
    expandedBreakdowns = next;
  }
  function ratingColor(r: string) {
    return r === "above" ? "#34d399" : r === "below" ? "#f87171" : "#9ca3af";
  }

  // Recompute agreement against the FINAL scorecard (not at generation time)
  // to avoid false flags caused by fallback rounds skewing mid-run tallies.
  const verdictAgreesWithScorecard = $derived(
    !narrativeVerdict
      ? true
      : narrativeVerdict.favouredAgentId !== null &&
          narrativeVerdict.favouredAgentId !== undefined &&
          finalScorecard?.overallWinner !== undefined &&
          narrativeVerdict.favouredAgentId === finalScorecard?.overallWinner,
  );

  function resolveAgent(id: string): { id: string; name: string; color: string } {
    if (id === "tie") return { id: "tie", name: "Draw", color: "#6b7280" };
    const override = agentOverrides[id];
    if (override) return { id, ...override };
    return getModelInfo(id);
  }
</script>

<div id="live-judge-panel" class="flex flex-col gap-4 judge-panel">
  <!-- Section header -->
  <div class="flex items-center gap-3 mt-2 judge-header">
    <div class="flex-1 h-px bg-[--color-border]"></div>
    <span
      class="text-[11px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border"
      style="color: #c084fc; border-color: #7c6af740; background: #7c6af708"
      >⚖️ Live Judge Analysis</span
    >
    <div class="flex-1 h-px bg-[--color-border]"></div>
  </div>

  <!-- Judge activity indicator -->
  {#if judgeStatus}
    <div
      class="flex items-center gap-2.5 px-3 py-2 rounded-xl border"
      style="border-color: #7c6af730; background: #7c6af708; animation: fadeSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1) both"
    >
      <span class="flex gap-1 items-center">
        <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" style="background:#c084fc"></span>
        <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:250ms]" style="background:#c084fc"></span>
        <span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:500ms]" style="background:#c084fc"></span>
      </span>
      <span class="text-[11px]" style="color:#c084fc99">
        {judgeStatus === 'writing_verdict' ? 'Writing verdict\u2026' : 'Scoring turn\u2026'}
      </span>
    </div>
  {/if}

  <!-- Narrative verdict + Turn Scores in a keyed list so flip animates the push-down -->
  {#each [
    ...(narrativeVerdict ? [{ id: 'verdict' }] : []),
    ...(liveJudgeResults.some((r) => r.absoluteScores) ? [{ id: 'scores' }] : []),
  ] as section (section.id)}
    <div animate:flip={{ duration: 320, easing: cubicInOut }}>

      {#if section.id === 'verdict'}
        <!-- Narrative verdict (shown after debate completes) -->
        <div
          class="rounded-2xl border overflow-hidden bg-[--color-panel]"
          style="border-color: {verdictAgreesWithScorecard
            ? '#7c6af740'
            : '#f59e0b40'}"
          in:flyInFromTop={{ duration: 300, distance: 14 }}
          out:flyOutToBottom={{ duration: 220, distance: 24 }}
        >
          <div
            class="flex items-center gap-3 px-4 py-3 border-b"
            style="border-color: {verdictAgreesWithScorecard
              ? '#7c6af725'
              : '#f59e0b25'}; background: {verdictAgreesWithScorecard
              ? '#7c6af708'
              : '#f59e0b08'}"
          >
            <div class="flex flex-col">
              <span
                class="text-sm font-bold"
                style="color: {verdictAgreesWithScorecard
                  ? '#c084fc'
                  : '#fbbf24'}"
              >
                {verdictAgreesWithScorecard
                  ? "Narrative Verdict"
                  : "⚡ Narrative Arc Diverges"}
              </span>
              <span class="text-[10px] text-[--color-muted]"
                >arc-level · cumulative thesis coherence</span
              >
            </div>
            {#if narrativeVerdict.favouredAgentId}
              {@const favouredInfo = resolveAgent(narrativeVerdict.favouredAgentId)}
              <span
                class="ml-auto text-xs font-semibold"
                style="color: {favouredInfo.color}"
                >→ {favouredInfo.name}</span
              >
            {/if}
          </div>
          {#if narrativeVerdict.convergence?.detected}
            {@const conv = narrativeVerdict.convergence}
            <div class="px-4 pb-4 pt-0">
              <div
                class="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5"
              >
                <p class="text-[11px] font-semibold text-sky-400 mb-1">
                  ⚠ Positional convergence detected!
                  {#if conv.convergenceTurnRange}
                    · {conv.convergenceTurnRange}{/if}
                </p>
                {#if conv.positionalGapDescription}
                  <p
                    class="text-[11px] text-[--color-muted-fg] leading-relaxed mb-1"
                  >
                    {conv.positionalGapDescription}
                  </p>
                {/if}
                <p class="text-[11px] text-[--color-muted] leading-relaxed">
                  Remaining disagreement: <span class="text-sky-300/80"
                    >{conv.remainingDisagreementType}</span
                  >
                  · Motion viability:
                  <span class="text-sky-300/80"
                    >{conv.motionViability === "degenerate_convergence"
                      ? "degenerate — opposition collapsed"
                      : conv.motionViability}</span
                  >
                </p>
              </div>
            </div>
          {/if}
          <div class="px-4 py-4">
            <p
              class="text-sm text-[--color-muted-fg] leading-relaxed whitespace-pre-line"
            >
              {narrativeVerdict.text}
            </p>
          </div>
          {#if narrativeVerdict.conflictResolution}
            <div class="px-4 pb-4 pt-0">
              <div
                class="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5"
              >
                {#if narrativeVerdict.scorecardInternallyConsistent === false}
                  <p class="text-[11px] font-semibold text-amber-400 mb-1">
                    Why they diverged · scorecard internally split
                  </p>
                {:else}
                  <p class="text-[11px] font-semibold text-amber-400 mb-1">
                    Why they diverged
                  </p>
                {/if}
                <p class="text-[11px] text-[--color-muted-fg] leading-relaxed">
                  {narrativeVerdict.conflictResolution}
                </p>
              </div>
            </div>
          {/if}
        </div>

      {:else}
        <!-- Per-turn absolute scores -->
        {@const scoredTurns = liveJudgeResults.filter((r) => r.absoluteScores).sort((a, b) => a.turnNumber - b.turnNumber)}
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-[--color-muted-fg] px-1">
            Turn Scores
          </h3>
          <div
            class="rounded-xl border bg-[--color-panel] overflow-hidden"
            style="border-color: #7c6af720"
          >
            <div
              class="grid text-[10px] font-semibold uppercase tracking-wide text-[--color-muted] px-3 py-2 border-b border-[--color-border] turn-scores-grid"
            >
              <span>Turn</span>
              <span>Agent</span>
              <span class="text-center">Logic</span>
              <span class="text-center">Rhet.</span>
              <span class="text-center">Tact.</span>
              <span class="text-center">Score</span>
            </div>
            {#each scoredTurns as r, i (r.turnNumber)}
              {@const info = resolveAgent(r.agentId)}
              {@const s = r.absoluteScores}
              {@const bd = r.scoreBreakdown}
              {@const isExpanded = expandedBreakdowns.has(r.turnNumber)}
              <div
                class="border-b border-[--color-border] last:border-0"
                in:flyInFromLeft={{ duration: 240, distance: 18 }}
                out:flyOutToRight={{ duration: 180, distance: 18 }}
              >
                <!-- Score row -->
                <div
                  class="grid items-center px-3 py-2 text-xs gap-1 judge-row turn-scores-grid"
                  style="animation-delay: {i * 50}ms"
                >
                  <span class="text-[--color-muted] text-[11px]">T{r.turnNumber}</span>
                  <span class="font-medium truncate" style="color: {info.color}"
                    >{info.name}</span
                  >
                  <span
                    class="flex flex-col items-center leading-tight"
                    title="Logic: {s.logicalCoherence}/40{scoreDeltas[r.turnNumber] ? ' (retroactively adjusted: ' + (scoreDeltas[r.turnNumber] > 0 ? '+' : '') + scoreDeltas[r.turnNumber] + ')' : ''}"
                  >
                    <span class="font-mono text-[12px]">{s.logicalCoherence}</span>
                    <span class="text-[9px] text-[--color-muted]">/40</span>
                    {#if scoreDeltas[r.turnNumber]}
                      {@const d = scoreDeltas[r.turnNumber]}
                      <span
                        class="font-mono text-[9px] font-bold mt-0.5 px-1 rounded"
                        style="color: {d < 0 ? '#f87171' : '#34d399'}; background: {d < 0 ? '#f8717118' : '#34d39918'}"
                      >{d > 0 ? '+' : ''}{d}</span>
                    {/if}
                  </span>
                  <span
                    class="flex flex-col items-center leading-tight"
                    title="Rhetoric: {s.rhetoricalForce}/30"
                  >
                    <span class="font-mono text-[12px]">{s.rhetoricalForce}</span>
                    <span class="text-[9px] text-[--color-muted]">/30</span>
                  </span>
                  <span
                    class="flex flex-col items-center leading-tight"
                    title="Tactics: {s.tacticalEffectiveness}/30"
                  >
                    <span class="font-mono text-[12px]">{s.tacticalEffectiveness}</span>
                    <span class="text-[9px] text-[--color-muted]">/30</span>
                  </span>
                  <!-- Score total + audit toggle -->
                  <button
                    onclick={() => toggleBreakdown(r.turnNumber)}
                    class="flex items-center justify-center gap-1 font-mono text-[11px] font-semibold rounded hover:opacity-80 transition-opacity"
                    style="color: {info.color}"
                    title="{bd ? 'Show/hide scoring rubric' : 'No breakdown available'}"
                    disabled={!bd}
                  >
                    {s.logicalCoherence + s.rhetoricalForce + s.tacticalEffectiveness}
                    {#if bd}
                      <span class="text-[9px] text-[--color-muted] transition-transform" style="transform: rotate({isExpanded ? '90deg' : '0deg'})">▸</span>
                    {/if}
                  </button>
                </div>

                <!-- Audit breakdown panel (collapsible) -->
                {#if isExpanded && bd}
                  <div
                    class="px-3 pb-3 border-t border-[--color-border] bg-[--color-panel]"
                    style="background: #7c6af705"
                  >
                    <div class="pt-2 flex flex-col gap-3">

                      <!-- Logic steps -->
                      {#if bd.logicSteps?.length > 0}
                        <div>
                          <p class="text-[10px] font-bold uppercase tracking-wide text-[--color-muted] mb-1">Logic rubric · {s.logicalCoherence}/40 (raw {bd.logicRaw}/10)</p>
                          <div class="flex flex-col gap-0.5">
                            {#each bd.logicSteps as step}
                              <div class="flex items-baseline justify-between gap-2 text-[11px]">
                                <span class="text-[--color-muted-fg] leading-relaxed">{step.rule}</span>
                                <span
                                  class="font-mono font-bold shrink-0"
                                  style="color: {step.delta > 0 ? '#34d399' : step.delta < 0 ? '#f87171' : '#9ca3af'}"
                                >{step.delta > 0 ? '+' : ''}{step.delta}</span>
                              </div>
                            {/each}
                          </div>
                          {#if bd.pairwiseFloorApplied}
                            <p class="text-[10px] text-amber-400 mt-1.5 leading-relaxed">⚡ {bd.pairwiseFloorNote}</p>
                          {/if}
                        </div>
                      {/if}

                      <!-- Rhetoric components -->
                      {#if bd.rhetoricalComponents}
                        {@const rc = bd.rhetoricalComponents}
                        <div>
                          <p class="text-[10px] font-bold uppercase tracking-wide text-[--color-muted] mb-1">
                            Rhetoric rubric · {s.rhetoricalForce}/30 (raw {bd.rhetoricalRaw}/10 = 5+{bd.rhetoricalAboveCount}−{bd.rhetoricalBelowCount})
                          </p>
                          <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
                            {#each [['Expression', rc.expression], ['Structure', rc.structure], ['Audience', rc.audience], ['Framing', rc.framing]] as [label, rating]}
                              <div class="flex items-center justify-between text-[11px]">
                                <span class="text-[--color-muted-fg]">{label}</span>
                                <span class="font-semibold capitalize" style="color: {ratingColor(rating)}">{rating}</span>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <!-- Tactics note -->
                      {#if bd.tacticsNote}
                        <div>
                          <p class="text-[10px] font-bold uppercase tracking-wide text-[--color-muted] mb-1">Tactics · {s.tacticalEffectiveness}/30 (raw {bd.tacticsRaw}/10)</p>
                          <p class="text-[11px] text-[--color-muted-fg] leading-relaxed">{bd.tacticsNote}</p>
                        </div>
                      {/if}

                      <!-- Evidence gating -->
                      {#if bd.evidenceGatingNote}
                        <div class="rounded-lg border px-2.5 py-2" style="border-color: {bd.evidenceDetected ? '#34d39930' : '#f8717130'}; background: {bd.evidenceDetected ? '#34d39908' : '#f8717108'}">
                          <p class="text-[10px] font-bold mb-0.5" style="color: {bd.evidenceDetected ? '#34d399' : '#f87171'}">
                            {bd.evidenceDetected ? '✓ Citations detected' : '⚠ No citations'}
                          </p>
                          {#if bd.evidenceCitations?.length}
                            <p class="text-[10px] text-[--color-muted] mb-1 leading-relaxed font-mono break-all">{bd.evidenceCitations.slice(0, 3).join(' · ')}{bd.evidenceCitations.length > 3 ? ` +${bd.evidenceCitations.length - 3} more` : ''}</p>
                          {/if}
                          <p class="text-[10px] text-[--color-muted-fg] leading-relaxed">{bd.evidenceGatingNote}</p>
                        </div>
                      {/if}

                      <!-- Artifact repair -->
                      {#if bd.artifactRepairApplied}
                        <div class="rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2">
                          <p class="text-[10px] font-bold text-sky-400 mb-0.5">🔧 Artifact repair applied</p>
                          <p class="text-[10px] text-[--color-muted-fg] leading-relaxed">{bd.artifactRepairNote}</p>
                        </div>
                      {/if}

                    </div>
                  </div>
                {/if}

              </div>
            {/each}
          </div>
        </div>
      {/if}

    </div>
  {/each}
</div>

<!-- 3-col analysis grid: most items span full row, round cards take 1 col each -->
<div class="judge-main-grid">
  <!-- Scorecard + language warning (full row) -->
  <div class="col-span-full flex flex-col gap-3 relative">
    <!-- Scorecard — win tallies -->
    {#if currentLeader?.winTallies}
      {@const tallies = currentLeader.winTallies}
      <div
        class="rounded-2xl border overflow-hidden bg-[--color-panel] judge-card"
        style="border-color: #7c6af740; animation-delay: 250ms"
        in:flyInFromLeft={{ duration: 260, distance: 16 }}
        out:flyOutToRight={{ duration: 200, distance: 16 }}
      >
        <div
          class="flex items-center gap-3 px-4 py-3 border-b"
          style="border-color: #7c6af725; background: #7c6af708"
        >
          <span class="text-sm font-bold" style="color: #c084fc">Scorecard</span>
          <span class="text-[10px] text-[--color-muted] ml-1"
            >turn-by-turn · per-round argument quality</span
          >
        </div>
        <div class="px-4 py-3 flex flex-col gap-2">
          {#each Object.entries(tallies) as [agentId, tallyObj]}
            {@const tally = tallyObj as {
              agentName: string;
              logic: number;
              tactics: number;
              rhetoric: number;
              total: number;
            }}
            {@const info = resolveAgent(agentId)}
            {@const isLeader = agentId === currentLeader.agentId}
            <div class="flex items-center gap-3">
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                style="background: {info.color}18; color: {info.color}; border: 1px solid {info.color}28"
              >
                {info.name[0]}
              </div>
              <span
                class="text-sm font-medium flex-1 {isLeader
                  ? ''
                  : 'text-[--color-muted-fg]'}"
                style={isLeader ? `color: ${info.color}` : ""}
              >
                {tally.agentName}
              </span>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span title="Logic wins" class="flex flex-col items-center">
                  <span class="text-[--color-muted] text-[10px]">Logic</span>
                  <span
                    style="color: {tally.logic > 0 ? '#34d399' : '#6b7280'}"
                    >{tally.logic}</span
                  >
                </span>
                <span title="Tactics wins" class="flex flex-col items-center">
                  <span class="text-[--color-muted] text-[10px]">Tactics</span>
                  <span
                    style="color: {tally.tactics > 0 ? '#60a5fa' : '#6b7280'}"
                    >{tally.tactics}</span
                  >
                </span>
                <span title="Rhetoric wins" class="flex flex-col items-center">
                  <span class="text-[--color-muted] text-[10px]">Rhetoric</span>
                  <span
                    style="color: {tally.rhetoric > 0 ? '#f472b6' : '#6b7280'}"
                    >{tally.rhetoric}</span
                  >
                </span>
                <span
                  title="Total wins"
                  class="flex flex-col items-center border-l border-[--color-border] pl-3"
                >
                  <span class="text-[--color-muted] text-[10px]">Total</span>
                  <span class="font-bold" style="color: {info.color}"
                    >{tally.total}</span
                  >
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if currentLeader}
      <!-- Fallback leader display before first pairwise round -->
      {@const leaderInfo = resolveAgent(currentLeader.agentId)}
      <div
        class="rounded-2xl border overflow-hidden bg-[--color-panel] judge-card"
        style="border-color: #7c6af740; animation-delay: 350ms"
        in:flyInFromLeft={{ duration: 260, distance: 16 }}
        out:flyOutToRight={{ duration: 200, distance: 16 }}
      >
        <div class="px-4 py-3 flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
            style="background: {leaderInfo.color}15; color: {leaderInfo.color}"
          >
            {leaderInfo.name[0]}
          </div>
          <div>
            <div
              class="text-sm font-semibold"
              style="color: {leaderInfo.color}"
            >
              {leaderInfo.name}
            </div>
            <div class="text-[10px] text-[--color-muted]">
              Early leader — pairwise scoring starts Turn 2
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Language warning -->
    {#if pairwiseRounds.some((r) => r.languageWarning)}
      <div
        class="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-400 judge-card"
        style="animation-delay: 0ms"
        in:flyInFromLeft={{ duration: 260, distance: 16 }}
        out:flyOutToRight={{ duration: 200, distance: 16 }}
      >
        {pairwiseRounds.find((r) => r.languageWarning)?.languageWarning}
      </div>
    {/if}
  </div>

  <!-- Recent Rounds -->
  {#if pairwiseRounds.length > 0}
    <div class="col-span-full flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-[--color-muted-fg] px-1">
        Recent Rounds
      </h3>
      <div class="judge-rounds-grid flex flex-col gap-3">
      {#each pairwiseRounds.slice(-3).reverse() as round, i (round.roundNumber)}
      {@const logicWinnerInfo = resolveAgent(round.logicWinner)}
      {@const tacticsWinnerInfo = resolveAgent(round.tacticsWinner)}
      {@const rhetoricWinnerInfo = resolveAgent(round.rhetoricWinner)}
      <div
        class="rounded-xl border bg-[--color-panel] p-3 judge-card"
        style="border-color: #7c6af720; animation-delay: {i * 45}ms"
        in:flyInFromTop={{ duration: 280, delay: i * 50, distance: 12 }}
        out:flyOutToBottom={{ duration: 200, distance: 20 }}
        animate:flip={{ duration: 300, easing: cubicInOut }}
      >
        <!-- Round header -->
        <div class="flex items-center gap-2 mb-3 min-w-0">
          <span
            class="text-[10px] font-bold uppercase tracking-widest text-[--color-muted] shrink-0"
            >Round {round.roundNumber}</span
          >
          <span class="text-[10px] text-[--color-muted] shrink-0">·</span>
          <span class="text-[10px] text-[--color-muted] min-w-0 truncate"
            >T{round.prevTurn.turnNumber} ({round.prevTurn.agentName})
            vs T{round.curTurn.turnNumber} ({round.curTurn.agentName})</span
          >
          {#if round.isFallback}
            <span class="ml-auto shrink-0 text-[10px] text-yellow-500"
              >fallback</span
            >
          {/if}
        </div>

        <!-- Winner chips -->
        <div class="flex flex-wrap gap-x-4 gap-y-2 mb-3">
          <div class="flex flex-col gap-1">
            <span
              class="text-[10px] text-[--color-muted] uppercase tracking-wide"
              >Logic</span
            >
            <span
              class="text-xs font-semibold truncate"
              style="color: {logicWinnerInfo.color}"
              >{logicWinnerInfo.name}</span
            >
          </div>
          <div class="flex flex-col gap-1">
            <span
              class="text-[10px] text-[--color-muted] uppercase tracking-wide"
              >Tactics</span
            >
            <span
              class="text-xs font-semibold truncate"
              style="color: {tacticsWinnerInfo.color}"
              >{tacticsWinnerInfo.name}</span
            >
          </div>
          <div class="flex flex-col gap-1">
            <span
              class="text-[10px] text-[--color-muted] uppercase tracking-wide"
              >Rhetoric</span
            >
            <span
              class="text-xs font-semibold truncate"
              style="color: {rhetoricWinnerInfo.color}"
              >{rhetoricWinnerInfo.name}</span
            >
          </div>
        </div>

        <!-- Logic delta (2-3 sentences) -->
        <div class="pt-2 border-t border-[--color-border]">
          <p class="text-[11px] text-[--color-muted-fg] leading-relaxed">
            {round.logicDelta}
          </p>
        </div>
      </div>
      {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes fadeSlide {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes judgePulse {
    0%, 100% { opacity: 0.25; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  @keyframes judgeReveal {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes judgeHeaderReveal {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .judge-panel {
    animation: judgeReveal 0.35s cubic-bezier(0.25, 1, 0.5, 1) both;
  }
  :global(.judge-card) {
    animation: judgeReveal 0.4s cubic-bezier(0.25, 1, 0.5, 1) both;
  }
  :global(.judge-row) {
    animation: judgeReveal 0.3s cubic-bezier(0.25, 1, 0.5, 1) both;
  }
  .judge-header {
    animation: judgeHeaderReveal 0.35s cubic-bezier(0.25, 1, 0.5, 1) both;
    animation-delay: 150ms;
  }

  /* 3-col grid inside the judge panel — collapses to 1 col on mobile */
  :global(.judge-main-grid) {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    align-content: start;
  }
  /* Turn scores table — fixed 6-col layout, denominators hidden on mobile */
  :global(.turn-scores-grid) {
    grid-template-columns: 2.5rem 1fr 3rem 3rem 3rem 2.75rem;
  }
  @media (max-width: 639px) {
    :global(.judge-main-grid) {
      grid-template-columns: 1fr;
    }
    :global(.judge-rounds-grid) {
      grid-template-columns: 1fr !important;
    }
    :global(.turn-scores-grid) {
      grid-template-columns: 2rem 1fr 2.75rem 2.75rem 2.75rem 2.5rem;
    }
  }
</style>
