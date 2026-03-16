<script lang="ts">
  import AgentSelector from "./AgentSelector.svelte";
  import ContextFileUpload from "./ContextFileUpload.svelte";
  import type { ContextFile } from "$lib/debate/models";

  interface Props {
    topic: string;
    turns: number;
    agentA: string;
    agentB: string;
    contextFiles: ContextFile[];
    running: boolean;
    isPaused: boolean;
    errorMsg: string;
    onstart: () => void;
    onresume: () => void;
    onpause: () => void;
    onstop: () => void;
    onmoderatormessage: (text: string) => void;
  }

  let {
    topic = $bindable(),
    turns = $bindable(),
    agentA = $bindable(),
    agentB = $bindable(),
    contextFiles = $bindable(),
    running,
    isPaused,
    errorMsg,
    onstart,
    onresume,
    onpause,
    onstop,
    onmoderatormessage,
  }: Props = $props();

  let showFiles = $state(false);
  let moderatorInput = $state("");

  function onTopicKeydown(e: KeyboardEvent) {
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      !running &&
      !isPaused &&
      topic.trim()
    ) {
      e.preventDefault();
      onstart();
    }
  }

  function onModeratorKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && moderatorInput.trim()) {
      e.preventDefault();
      const text = moderatorInput.trim();
      moderatorInput = "";
      onmoderatormessage(text);
    }
  }
</script>

<div
  class="flex flex-col gap-6 bg-[--color-panel] border border-[--color-border] rounded-2xl p-4 sm:p-7"
>
  <!-- Topic -->
  <div class="flex flex-col gap-1.5">
    <label
      for="topic"
      class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
      >Topic</label
    >
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="topic"
      type="text"
      bind:value={topic}
      onkeydown={onTopicKeydown}
      placeholder="What should they debate?"
      disabled={running}
      autofocus
      class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-4 text-base text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] disabled:opacity-40 disabled:cursor-not-allowed"
    />
  </div>

  <!-- Agents row -->
  <AgentSelector bind:agentA bind:agentB {running} />

  <!-- Bottom row: turns + context toggle + actions -->
  <div class="flex items-center gap-3 flex-wrap">
    <div
      class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-2"
    >
      <label
        for="turns"
        class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap"
        >Turns</label
      >
      <input
        id="turns"
        type="number"
        bind:value={turns}
        min="2"
        max="30"
        disabled={running}
        class="w-12 bg-transparent text-sm text-white outline-none disabled:opacity-40 disabled:cursor-not-allowed text-center"
      />
    </div>

    <button
      type="button"
      onclick={() => {
        showFiles = !showFiles;
      }}
      class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border transition-all cursor-pointer
{showFiles
        ? 'border-[--color-accent] text-[--color-accent] bg-[#7c6af7]/5'
        : 'border-[--color-border] text-[--color-muted] hover:border-[--color-muted] bg-[--color-surface]'}"
    >
      <svg
        class="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M15.172 7l-6.586 6.586a2 2 0 1 0 2.828 2.828l6.414-6.586a4 4 0 0 0-5.656-5.656l-6.415 6.585a6 6 0 1 0 8.486 8.486L20.5 13"
        />
      </svg>
      Files {#if contextFiles.length > 0}<span
          class="ml-0.5 bg-[--color-accent] text-white rounded-full px-1.5 py-0 text-[10px] leading-4"
          >{contextFiles.length}</span
        >{/if}
    </button>

    <div class="flex-1"></div>

    {#if running}
      <button
        type="button"
        onclick={onpause}
        class="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
      >
        Pause
      </button>
      <button
        type="button"
        onclick={onstop}
        class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"
        ></span>
        Stop
      </button>
    {:else if isPaused}
      <button
        type="button"
        onclick={onresume}
        class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
        >Resume debate</button
      >
      <button
        type="button"
        onclick={onstop}
        class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
      >
        Stop
      </button>
    {:else}
      <button
        type="button"
        onclick={() => {
          if (!running && topic.trim()) onstart();
        }}
        disabled={!topic.trim()}
        class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
        >Start debate</button
      >
    {/if}
  </div>

  {#if isPaused}
    <div
      class="flex flex-col gap-1.5 pt-2 border-t border-[--color-border-subtle]"
    >
      <label
        for="moderatorInput"
        class="text-[11px] font-semibold uppercase tracking-widest text-[#ff4b4b]"
        >Moderator Intervention</label
      >
      <input
        id="moderatorInput"
        type="text"
        bind:value={moderatorInput}
        onkeydown={onModeratorKeydown}
        placeholder="Add a point, sub-topic, or rebuttal..."
        class="w-full bg-[--color-surface] border border-[#ff4b4b]/30 rounded-xl px-4 py-3 text-sm text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[#ff4b4b] focus:shadow-[0_0_0_3px_#ff4b4b22]"
      />
      <p class="text-xs text-[--color-muted]">
        Hit <span class="text-white font-semibold">Enter</span> to inject message
        and resume debate
      </p>
    </div>
  {/if}

  {#if errorMsg}
    <div
      class="flex items-start gap-3 bg-red-950/50 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400"
    >
      <svg
        class="w-4 h-4 flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
        />
      </svg>
      {errorMsg}
    </div>
  {/if}

  <!-- Context files (collapsible) -->
  {#if showFiles}
    <div
      class="flex flex-col gap-2 pt-1 border-t border-[--color-border-subtle]"
    >
      <ContextFileUpload bind:contextFiles {running} />
    </div>
  {/if}
</div>
