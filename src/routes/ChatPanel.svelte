<script lang="ts">
  import ChatMessage from "./ChatMessage.svelte";
  import TypingIndicator from "./TypingIndicator.svelte";
  import type { ChatMessage as ChatMessageType } from "$lib/debate/models";
  import { getModelInfo } from "$lib/debate/models";

  interface Props {
    messages: ChatMessageType[];
    running: boolean;
    done: boolean;
    progress: number;
    turns: number;
    streamingMessage: ChatMessageType | null;
    typingAgentName: string;
    typingAgentColor: string;
    leftAgentId: string;
    agentA: string;
    agentB: string;
    docAnalysisMode?: boolean;
    chatEl: HTMLElement | null;
  }

  let {
    messages,
    running,
    done,
    progress,
    turns,
    streamingMessage,
    typingAgentName,
    typingAgentColor,
    leftAgentId,
    agentA,
    agentB,
    docAnalysisMode = false,
    chatEl = $bindable(null),
  }: Props = $props();
</script>

<div
  class="chat-panel flex-1 min-w-0 flex flex-col rounded-2xl border border-[--color-border] overflow-hidden bg-[--color-panel]"
>
  <!-- Sticky progress bar -->
  {#if running || (done && messages.length > 0)}
    <div
      class="flex items-center gap-3 px-6 py-1 border-b border-[--color-border-subtle] bg-[--color-panel]/80 backdrop-blur-sm sticky top-0 z-10"
    >
      <div
        class="flex-1 h-1 bg-[--color-border] rounded-full overflow-hidden"
      >
        <div
          class="h-full rounded-full transition-all duration-500"
          style="width: {progress}%; background: linear-gradient(to right, #7c6af7, #c084fc)"
        ></div>
      </div>
      <span
        class="text-[11px] font-semibold tabular-nums text-[--color-muted] whitespace-nowrap"
        >{messages.length}<span class="text-[--color-border] mx-0.5">/</span
        >{turns * 2}</span
      >
      {#if done}
        <span
          class="text-[11px] uppercase tracking-widest text-[--color-muted]"
          >done</span
        >
      {/if}
    </div>
  {/if}

  <!-- Chat body -->
  <div
    bind:this={chatEl}
    class="chat-body flex flex-col overflow-y-auto scroll-smooth flex-1"
    style="min-height: 0"
  >
    <!-- Empty state -->
    {#if messages.length === 0 && !running}
      <div
        class="flex flex-col items-center justify-center gap-8 flex-1 py-16 px-6"
      >
        <div class="flex items-center gap-8">
          {#if docAnalysisMode}
            <!-- Doc mode: document icon + auditor -->
            <div class="flex flex-col items-center gap-2.5">
              <div
                class="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg border border-[--color-border]"
                style="background: #94a3b822"
              >
                <svg class="w-7 h-7 text-[#94a3b8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span class="text-xs font-semibold text-center max-w-[100px] leading-snug text-[#94a3b8]"
                >Document</span
              >
            </div>

            <div class="flex flex-col items-center gap-1">
              <span class="text-[11px] font-bold uppercase tracking-[0.4em] text-[#ef4444]/60">audit</span>
              <div class="flex gap-1">
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
              </div>
            </div>

            <div class="flex flex-col items-center gap-2.5">
              <div
                class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
                style="background: linear-gradient(135deg, {getModelInfo(agentB).color}22, {getModelInfo(agentB).color}08); color: {getModelInfo(agentB).color}; border: 1px solid {getModelInfo(agentB).color}30"
              >
                {getModelInfo(agentB).name[0]}
              </div>
              <span
                class="text-xs font-semibold text-center max-w-[100px] leading-snug"
                style="color: {getModelInfo(agentB).color}"
                >{getModelInfo(agentB).name}</span
              >
            </div>
          {:else}
            <div class="flex flex-col items-center gap-2.5">
            <div
              class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
              style="background: linear-gradient(135deg, {getModelInfo(
                agentA,
              ).color}22, {getModelInfo(agentA)
                .color}08); color: {getModelInfo(agentA)
                .color}; border: 1px solid {getModelInfo(agentA).color}30"
            >
              {getModelInfo(agentA).name[0]}
            </div>
            <span
              class="text-xs font-semibold text-center max-w-[100px] leading-snug"
              style="color: {getModelInfo(agentA).color}"
              >{getModelInfo(agentA).name}</span
            >
          </div>

          <div class="flex flex-col items-center gap-1">
            <span
              class="text-[11px] font-bold uppercase tracking-[0.4em] text-[--color-muted]"
              >vs</span
            >
            <div class="flex gap-1">
              <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
              <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
              <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
            </div>
          </div>

          <div class="flex flex-col items-center gap-2.5">
            <div
              class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
              style="background: linear-gradient(135deg, {getModelInfo(
                agentB,
              ).color}22, {getModelInfo(agentB)
                .color}08); color: {getModelInfo(agentB)
                .color}; border: 1px solid {getModelInfo(agentB).color}30"
            >
              {getModelInfo(agentB).name[0]}
            </div>
            <span
              class="text-xs font-semibold text-center max-w-[100px] leading-snug"
              style="color: {getModelInfo(agentB).color}"
              >{getModelInfo(agentB).name}</span
            >
          </div>
          {/if}
        </div>
        <p class="text-sm text-[--color-muted] text-center">
          {#if docAnalysisMode}
            Hit <span class="text-white font-semibold">Analyse</span> to begin · Ctrl+Enter
          {:else}
            Hit <span class="text-white font-semibold">Start debate</span> to begin
            · Ctrl+Enter
          {/if}
        </p>
      </div>
    {/if}

    <!-- Messages -->
    {#each messages as msg, i (i)}
      <ChatMessage {msg} index={i} {leftAgentId} />
    {/each}

    <!-- Live stream / typing indicator -->
    {#if running}
      <TypingIndicator
        {streamingMessage}
        {typingAgentName}
        {typingAgentColor}
        {leftAgentId}
        messageCount={messages.length}
      />
    {/if}

    {#if done}
      <div
        class="flex items-center gap-3 px-6 py-4 border-t border-[--color-border-subtle]"
      >
        <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
        <span
          class="text-[11px] uppercase tracking-widest text-[--color-muted]"
          >Debate ended · {messages.filter(
            (m) => m.agentId !== "moderator",
          ).length} turns</span
        >
        <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
      </div>
    {/if}
  </div>
</div>

<style>
  @media (max-width: 1023px) {
    /* Chat panel gets a real minimum height on mobile so it's always usably tall */
    .chat-panel {
      min-height: 55dvh;
    }
    /* Inner scroll area also needs a floor so it doesn't collapse */
    .chat-body {
      min-height: 40dvh;
    }
  }
</style>
