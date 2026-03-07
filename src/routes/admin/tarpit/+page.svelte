<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // --- Completed victims (historical) ---
  let liveVictims = $state(data.victims);
  let liveTotalWasted = $state(data.totalWasted);

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
          // Cap at 10 KB to keep the UI responsive
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
          // Promote to completed victims list so it stays visible
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
  <div class="border border-border bg-panel rounded-xl p-6 sm:p-8 lg:p-10 shadow-lg relative">

    <!-- Status pills -->
    <div class="absolute top-6 right-6 flex items-center gap-3">
      <!-- Bomb status -->
      {#if bombReady}
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 bg-green-400 rounded-full shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>
          <span class="text-green-400 text-xs font-bold tracking-widest uppercase">
            BOMB ARMED {bombSizeBytes ? formatBytes(bombSizeBytes) : ''}
          </span>
        </div>
      {:else}
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 bg-yellow-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.8)]"></div>
          <span class="text-yellow-400 text-xs font-bold tracking-widest uppercase">GENERATING...</span>
        </div>
      {/if}
      <!-- Live indicator -->
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
        <span class="text-red-500 text-xs font-bold tracking-widest uppercase">Live</span>
      </div>
    </div>

    <header class="text-center mb-10 border-b border-dashed border-border pb-8">
      <h1 class="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-widest mb-4">🪤 TARPIT HIGH SCORES</h1>

      <p class="text-base sm:text-lg mb-6">
        TOTAL TIME STOLEN:
        <span class="bg-accent text-white px-3 py-1 font-bold ml-2 rounded transition-all duration-300">
          {formatTime(liveTotalWasted)}
        </span>
      </p>

      <!-- Mode toggle -->
      <div class="mb-6">
        <span class="text-xs font-bold tracking-widest uppercase text-muted block mb-2">Trap Mode</span>
        <div class="inline-flex rounded-lg border border-border overflow-hidden {modeUpdating ? 'opacity-50 pointer-events-none' : ''}">
          <button
            type="button"
            onclick={() => setMode('llm')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200
              {tarpitMode === 'llm'
                ? 'bg-green-500 text-black shadow-[0_0_10px_rgba(74,222,128,0.4)]'
                : 'bg-panel text-muted-fg hover:bg-surface'}"
          >
            🤖 LLM Stream
          </button>
          <button
            type="button"
            onclick={() => setMode('random')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200 border-x border-border
              {tarpitMode === 'random'
                ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]'
                : 'bg-panel text-muted-fg hover:bg-surface'}"
          >
            🎲 Random
          </button>
          <button
            type="button"
            onclick={() => setMode('bomb')}
            class="px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all duration-200
              {tarpitMode === 'bomb'
                ? 'bg-rose-500 text-black shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                : 'bg-panel text-muted-fg hover:bg-surface'}"
          >
            💣 Bomb
          </button>
        </div>
      </div>

      <button
        type="button"
        onclick={nukeLogs}
        disabled={nuking}
        class="border-2 border-rose-600 text-rose-500 font-bold px-6 py-2.5 rounded-lg uppercase tracking-wider hover:bg-rose-600 hover:text-white hover:shadow-[0_0_15px_rgba(225,29,72,0.4)] transition-all duration-200 disabled:opacity-50 text-sm"
      >
        {nuking ? 'Nuking...' : 'Nuke Logs'}
      </button>
    </header>

    <!-- Active traps section -->
    {#if activeBotList.length > 0}
      <section class="mb-10">
        <h2 class="text-xs font-bold tracking-widest uppercase text-muted mb-4 border-b border-border pb-2">
          ⚡ Active Traps ({activeBotList.length})
        </h2>
        <div class="flex flex-col gap-3">
          {#each activeBotList as bot (bot.sessionId)}
            <div class="border border-border rounded-lg p-4 bg-surface animate-[fadeIn_0.3s_ease-out]">
              <div class="flex items-center gap-3 flex-wrap">
                <span class="text-lg" title={bot.type}>
                  {#if bot.type === 'bomb'}💣{:else if bot.type === 'tarpit'}🤖{:else}🔍{/if}
                </span>
                <span class="text-accent font-bold">{bot.ip}</span>
                <span class="text-muted text-sm">{bot.path}</span>
                {#if bot.type === 'bomb' && bot.filename}
                  <span class="text-yellow-400 text-xs font-mono bg-yellow-400/10 px-2 py-0.5 rounded">
                    {bot.filename}
                  </span>
                {/if}
              </div>
              {#if bot.type === 'tarpit' && bot.content}
                <pre class="mt-3 text-xs text-muted-fg font-mono bg-surface rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">{bot.content}</pre>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- High scores table -->
    {#if liveVictims.length === 0}
      <div class="text-center text-muted flex flex-col items-center py-14">
        <span class="text-5xl mb-4">🕸️</span>
        <p class="italic text-base">The trap is set. Waiting for the first victim...</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr class="text-muted text-xs border-b border-border">
              <th class="p-3 font-normal tracking-widest uppercase">Rank</th>
              <th class="p-3 font-normal tracking-widest uppercase">Type</th>
              <th class="p-3 font-normal tracking-widest uppercase">IP Address</th>
              <th class="p-3 font-normal tracking-widest uppercase">Target Path</th>
              <th class="p-3 font-normal tracking-widest uppercase text-right">Time Wasted</th>
            </tr>
          </thead>
          <tbody>
            {#each liveVictims as victim, index}
              {@const rowId = victim.sessionId ?? `${victim.ip}-${index}`}
              {@const isTarpit = victim.trap_type === 'tarpit'}
              {@const expanded = expandedRows.has(rowId)}
              <tr
                class="border-b border-border/50 hover:bg-surface transition-colors animate-[fadeIn_0.5s_ease-out] {isTarpit ? 'cursor-pointer' : ''}"
                onclick={() => isTarpit && toggleRow(rowId)}
                title={isTarpit ? 'Click to read the LLM output' : undefined}
              >
                <td class="p-3 text-muted">#{index + 1}</td>
                <td class="p-3 text-lg">{victim.trap_type === 'bomb' ? '💣' : '🤖'}</td>
                <td class="p-3 text-accent font-bold">{victim.ip}</td>
                <td class="p-3 text-muted">
                  {victim.path}
                  {#if victim.trap_type === 'bomb' && victim.filename}
                    <span class="ml-2 text-yellow-400/70 text-xs font-mono">→ {victim.filename}</span>
                  {/if}
                </td>
                <td class="p-3 text-rose-500 font-bold text-right">{formatTime(victim.duration_seconds)}</td>
              </tr>
              {#if isTarpit && expanded && victim.content}
                <tr class="border-b border-border/50 bg-surface/50">
                  <td colspan="5" class="px-4 pb-4 pt-1">
                    <pre class="text-xs text-muted-fg font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto">{victim.content}</pre>
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
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>