<script lang="ts">
  import { onMount } from 'svelte';
  import Nav from '$lib/Nav.svelte';
  import { derived } from 'svelte/store';

  // --- Completed victims (historical) ---
  interface Victim {
    sessionId: string;
    ip: string;
    path: string;
    trap_type: string;
    duration_seconds: number;
    filename?: string;
    content: string;
    timestamp: string;
    event: string;
  }
  let liveVictims = $state<Victim[]>([]);
  let liveTotalWasted = $state('0');

  // --- Bomb status ---
  let bombSizeBytes = $state<number | null>(null);
  let bombReady = $derived(bombSizeBytes !== null);

  // --- Active connections (in-flight bots) ---
  interface ActiveBot {
    sessionId: string;
    ip: string;
    path: string;
    userAgent: string;
    timestamp: string;
    type: 'pending' | 'bomb' | 'tarpit';
    filename?: string;
    content: string;
  }
  let activeBots = $state<Record<string, ActiveBot>>({});

  // --- UI state ---
  let nuking = $state(false);
  let expandedRows = $state<Set<string>>(new Set());

  // --- Tarpit mode ---
  type TarpitMode = 'random' | 'llm' | 'bomb';
  let tarpitMode = $state<TarpitMode>('random');
  let modeUpdating = $state(false);

  onMount(() => {
    const eventSource = new EventSource('/admin/tarpit/stream');

    eventSource.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'init') {
        liveVictims = msg.victims;
        liveTotalWasted = msg.totalWasted;
        bombSizeBytes = msg.bombSizeBytes;
        if (msg.mode) tarpitMode = msg.mode;
        if (msg.activeBots) activeBots = msg.activeBots;
        return;
      }

      if (msg.type === 'mode_changed') {
        tarpitMode = msg.mode;
        return;
      }

      if (msg.type === 'bomb_ready') {
        bombSizeBytes = msg.bombSizeBytes;
        return;
      }

      if (msg.type === 'bot_detected') {
        activeBots[msg.sessionId] = {
          sessionId: msg.sessionId,
          ip: msg.ip,
          path: msg.path,
          userAgent: msg.userAgent,
          timestamp: msg.timestamp,
          type: 'pending',
          content: '',
        };
        activeBots = { ...activeBots };
        return;
      }

      if (msg.type === 'bomb_served') {
        if (activeBots[msg.sessionId]) {
          activeBots[msg.sessionId].type = 'bomb';
          activeBots[msg.sessionId].filename = msg.filename;
          activeBots = { ...activeBots };
        }
        return;
      }

      if (msg.type === 'tarpit_chunk') {
        if (activeBots[msg.sessionId]) {
          activeBots[msg.sessionId].type = 'tarpit';
          const combined = activeBots[msg.sessionId].content + msg.text;
          activeBots[msg.sessionId].content = combined.length > 10240
            ? combined.slice(-10240)
            : combined;
          activeBots = { ...activeBots };
        }
        return;
      }

      if (msg.type === 'bot_disconnected') {
        const bot = activeBots[msg.sessionId];
        if (bot) {
          const victim = {
            sessionId: bot.sessionId,
            ip: bot.ip,
            path: bot.path,
            trap_type: bot.type === 'bomb' ? 'bomb' : 'tarpit',
            duration_seconds: msg.duration_seconds ?? 0,
            filename: bot.filename,
            content: bot.content,
            timestamp: bot.timestamp,
            event: 'connection_dropped',
          };
          liveVictims = [victim, ...liveVictims];
          liveTotalWasted = (Number(liveTotalWasted) + Number(msg.duration_seconds ?? 0)).toFixed(1);
        }
        delete activeBots[msg.sessionId];
        activeBots = { ...activeBots };
        return;
      }
    };

    return () => eventSource.close();
  });

  async function nukeLogs() {
    if (!confirm('Are you absolutely sure you want to obliterate the high scores?')) return;
    nuking = true;
    try {
      const res = await fetch('/admin/tarpit/stream', { method: 'DELETE' });
      if (res.ok) {
        liveVictims = [];
        liveTotalWasted = '0';
      }
    } finally {
      nuking = false;
    }
  }

  function formatTime(secondsStr: string | number) {
    const totalSeconds = typeof secondsStr === 'string' ? parseFloat(secondsStr) : secondsStr;
    if (isNaN(totalSeconds)) return '—';
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const remaining = (totalSeconds % 60).toFixed(1);
    return `${minutes}m ${remaining}s`;
  }

  function formatBytes(bytes: number) {
    return `~${(bytes / 1024 / 1024).toFixed(0)} MB`;
  }

  function toggleRow(id: string) {
    const next = new Set(expandedRows);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedRows = next;
  }

  async function setMode(mode: TarpitMode) {
    if (mode === tarpitMode || modeUpdating) return;
    modeUpdating = true;
    try {
      const res = await fetch('/admin/tarpit/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        tarpitMode = mode;
      }
    } finally {
      modeUpdating = false;
    }
  }

  let activeBotList = $derived(Object.values(activeBots));
</script>

<div class="w-full max-w-5xl flex flex-col gap-6">

  <!-- Header -->
  <header class="text-center flex flex-col items-center gap-2 mb-4">
    <div class="relative">
      <div class="absolute inset-0 blur-2xl opacity-30 bg-[#7c6af7] rounded-full scale-150"></div>
      <h1 class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight">
        <span class="text-white">Bot </span><span class="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-orange-400">Tarpit</span>
      </h1>
    </div>
    <p class="text-sm text-[--color-muted] tracking-wide">actively wasting bad bots' time</p>
    <Nav />
  </header>

  <!-- Controls card -->
  <div class="bg-[--color-panel] border border-[--color-border] rounded-2xl p-7 flex flex-col gap-6">

    <!-- Stats row -->
    <div class="flex items-center justify-between flex-wrap gap-4">
      <div class="flex flex-col gap-1">
        <span class="text-[11px] font-semibold uppercase tracking-widest text-[color-muted]">Total Time Stolen</span>
        <span class="text-3xl font-bold text-white tabular-nums transition-all duration-300">
          {formatTime(liveTotalWasted)}
        </span>
      </div>

      <!-- Live status indicators -->
      <div class="flex items-center gap-4">
        {#if bombReady}
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 bg-green-400 rounded-full shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>
            <span class="text-green-400 text-[11px] font-semibold tracking-widest uppercase">
              Bomb Armed {bombSizeBytes ? formatBytes(bombSizeBytes) : ''}
            </span>
          </div>
        {:else}
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.8)]"></div>
            <span class="text-yellow-400 text-[11px] font-semibold tracking-widest uppercase">Generating…</span>
          </div>
        {/if}
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
          <span class="text-red-500 text-[11px] font-semibold tracking-widest uppercase">Live</span>
        </div>
      </div>
    </div>

    <!-- Mode toggle + nuke row -->
    <div class="flex items-center gap-4 flex-wrap border-t border-[--color-border-subtle] pt-5">
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]">Trap Mode</span>
        <div class="inline-flex rounded-xl border border-[--color-border] overflow-hidden {modeUpdating ? 'opacity-50 pointer-events-none' : ''}">
          <button
            type="button"
            onclick={() => setMode('llm')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer
              {tarpitMode === 'llm'
                ? 'bg-green-500 text-black shadow-[0_0_10px_rgba(74,222,128,0.4)]'
                : 'bg-[--color-panel] text-[--color-muted] hover:text-white hover:bg-[--color-surface]'}"
          >
            🤖 LLM Stream
          </button>
          <button
            type="button"
            onclick={() => setMode('random')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200 border-x border-[--color-border] cursor-pointer
              {tarpitMode === 'random'
                ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]'
                : 'bg-[--color-panel] text-[--color-muted] hover:text-white hover:bg-[--color-surface]'}"
          >
            🎲 Random
          </button>
          <button
            type="button"
            onclick={() => setMode('bomb')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer
              {tarpitMode === 'bomb'
                ? 'bg-rose-500 text-black shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                : 'bg-[--color-panel] text-[--color-muted] hover:text-white hover:bg-[--color-surface]'}"
          >
            💣 Bomb
          </button>
        </div>
      </div>

      <div class="flex-1"></div>

      <button
        type="button"
        onclick={nukeLogs}
        disabled={nuking}
        class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
        </svg>
        {nuking ? 'Nuking…' : 'Nuke Logs'}
      </button>
    </div>
  </div>

  <!-- Active traps -->
  {#if activeBotList.length > 0}
    <div class="bg-[--color-panel] border border-[--color-border] rounded-2xl p-7 flex flex-col gap-4">
      <h2 class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]">
        ⚡ Active Traps
        <span class="ml-1.5 bg-rose-500/20 text-rose-400 rounded-full px-2 py-0.5 text-[10px]">{activeBotList.length}</span>
      </h2>
      <div class="flex flex-col gap-3">
        {#each activeBotList as bot (bot.sessionId)}
          <div class="border border-[--color-border] rounded-xl p-4 bg-[--color-surface] animate-[fadeIn_0.3s_ease-out]">
            <div class="flex items-center gap-3 flex-wrap">
              <span class="text-lg">
                {#if bot.type === 'bomb'}💣{:else if bot.type === 'tarpit'}🤖{:else}🔍{/if}
              </span>
              <span class="text-[--color-accent] font-bold">{bot.ip}</span>
              <span class="text-[--color-muted] text-sm font-mono">{bot.path}</span>
              {#if bot.type === 'bomb' && bot.filename}
                <span class="text-yellow-400 text-xs font-mono bg-yellow-400/10 px-2 py-0.5 rounded-lg border border-yellow-400/20">
                  {bot.filename}
                </span>
              {/if}
            </div>
            {#if bot.type === 'tarpit' && bot.content}
              <pre class="mt-3 text-xs text-[--color-muted-fg] font-mono bg-[--color-panel] rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all border border-[--color-border-subtle]">{bot.content}</pre>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- High scores table -->
  <div class="bg-[--color-panel] border border-[--color-border] rounded-2xl overflow-hidden">
    {#if liveVictims.length === 0}
      <div class="text-center text-[--color-muted] flex flex-col items-center py-16 px-6">
        <span class="text-5xl mb-4">🕸️</span>
        <p class="italic text-[--color-muted-fg]">The trap is set. Waiting for the first victim…</p>
      </div>
    {:else}
      <div class="px-7 py-5 border-b border-[--color-border-subtle]">
        <h2 class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]">🪤 High Scores</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr class="text-[--color-muted] text-[11px] border-b border-[--color-border-subtle]">
              <th class="px-6 py-3 font-semibold tracking-widest uppercase">Rank</th>
              <th class="px-6 py-3 font-semibold tracking-widest uppercase">Type</th>
              <th class="px-6 py-3 font-semibold tracking-widest uppercase">IP Address</th>
              <th class="px-6 py-3 font-semibold tracking-widest uppercase">Target Path</th>
              <th class="px-6 py-3 font-semibold tracking-widest uppercase text-right">Time Wasted</th>
            </tr>
          </thead>
          <tbody>
            {#each liveVictims as victim, index}
              {@const rowId = victim.sessionId ?? `${victim.ip}-${index}`}
              {@const isTarpit = victim.trap_type === 'tarpit'}
              {@const expanded = expandedRows.has(rowId)}
              <tr
                class="border-b border-[--color-border-subtle] hover:bg-[--color-surface] transition-colors animate-[fadeIn_0.5s_ease-out] {isTarpit ? 'cursor-pointer' : ''}"
                onclick={() => isTarpit && toggleRow(rowId)}
                title={isTarpit ? 'Click to read the LLM output' : undefined}
              >
                <td class="px-6 py-3.5 text-[--color-muted] tabular-nums">#{index + 1}</td>
                <td class="px-6 py-3.5 text-lg">{victim.trap_type === 'bomb' ? '💣' : '🤖'}</td>
                <td class="px-6 py-3.5 text-[--color-accent] font-bold font-mono">{victim.ip}</td>
                <td class="px-6 py-3.5 text-[--color-muted-fg] font-mono text-sm">
                  {victim.path}
                  {#if victim.trap_type === 'bomb' && victim.filename}
                    <span class="ml-2 text-yellow-400/70 text-xs">→ {victim.filename}</span>
                  {/if}
                </td>
                <td class="px-6 py-3.5 text-rose-400 font-bold text-right tabular-nums">{formatTime(victim.duration_seconds)}</td>
              </tr>
              {#if isTarpit && expanded && victim.content}
                <tr class="border-b border-[--color-border-subtle] bg-[--color-surface]/50">
                  <td colspan="5" class="px-6 pb-5 pt-2">
                    <pre class="text-xs text-[--color-muted-fg] font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-[--color-panel] rounded-xl p-4 border border-[--color-border-subtle]">{victim.content}</pre>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

</div>

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>