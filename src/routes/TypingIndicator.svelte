<script lang="ts">
  import type { ChatMessage } from "$lib/debate/models";
  import { formatMessage } from "$lib/debate/formatMessage";

  interface Props {
    streamingMessage: ChatMessage | null;
    typingAgentName: string;
    typingAgentColor: string;
    leftAgentId: string;
    messageCount: number;
  }

  let {
    streamingMessage,
    typingAgentName,
    typingAgentColor,
    leftAgentId,
    messageCount,
  }: Props = $props();

  const isLeft = $derived(
    streamingMessage ? streamingMessage.agentId === leftAgentId : true,
  );
</script>

{#if streamingMessage}
  <div
    class="flex gap-3 px-3 py-3 sm:px-6 sm:py-4 border-t border-[--color-border-subtle] {isLeft
      ? ''
      : 'sm:flex-row-reverse'}"
    style="animation: fadeSlide 0.75s ease both"
  >
    <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
      <div
        class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ring-2 ring-offset-1 ring-offset-[--color-panel] transition-all"
        style="background: linear-gradient(135deg, {streamingMessage.color}22, {streamingMessage.color}0a); color: {streamingMessage.color}; border: 1px solid {streamingMessage.color}28; ring-color: {streamingMessage.color}"
      >
        {streamingMessage.agentName[0]}
      </div>
      <span class="text-[10px] tabular-nums text-[--color-muted]"
        >#{messageCount + 1}</span
      >
    </div>
    <div
      class="flex flex-col gap-1.5 min-w-0 {isLeft
        ? 'items-start'
        : 'items-start sm:items-end'}"
      style="max-width: calc(100% - 3rem)"
    >
      <span
        class="text-[10px] font-bold uppercase tracking-widest"
        style="color: {streamingMessage.color}"
        >{streamingMessage.agentName}</span
      >
      <div
        class="message-content text-[14px] sm:text-[15px] leading-relaxed sm:leading-[1.72] text-[#d4d4e8] px-3 py-3 sm:px-5 sm:py-4 rounded-2xl {isLeft
          ? 'rounded-tl-sm border-l-2'
          : 'rounded-tr-sm border-r-2'}"
        style="background-color: {streamingMessage.color}09; border-color: {streamingMessage.color}30; border-top: 1px solid {streamingMessage.color}1a; border-bottom: 1px solid {streamingMessage.color}1a; {isLeft
          ? ''
          : 'border-left: 1px solid ' + streamingMessage.color + '1a'}"
      >
        {@html formatMessage(streamingMessage.text)}<span
          class="inline-block w-[2px] h-[0.9em] ml-[2px] align-text-bottom rounded-sm animate-pulse"
          style="background: {streamingMessage.color}"
        ></span>
      </div>
    </div>
  </div>
{:else}
  <div
    class="flex items-center gap-3 px-6 py-4 {messageCount > 0
      ? 'border-t border-[--color-border-subtle]'
      : ''}"
  >
    {#if typingAgentName}
      <div
        class="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 ring-1"
        style="background: {typingAgentColor}15; color: {typingAgentColor}; ring-color: {typingAgentColor}30"
      >
        {typingAgentName[0]}
      </div>
    {/if}
    <div class="flex gap-1 items-center">
      <span
        class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]"
        style="background: {typingAgentColor || 'var(--color-muted)'}"
      ></span>
      <span
        class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:250ms]"
        style="background: {typingAgentColor || 'var(--color-muted)'}"
      ></span>
      <span
        class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:500ms]"
        style="background: {typingAgentColor || 'var(--color-muted)'}"
      ></span>
    </div>
    {#if typingAgentName}
      <span
        class="text-xs text-[--color-muted]"
        style="color: {typingAgentColor}AA"
        >{typingAgentName} is thinking…</span
      >
    {/if}
  </div>
{/if}

<style>
  .message-content :global(p) {
    margin-bottom: 0.6em;
    line-height: inherit;
  }
  .message-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .message-content :global(strong) {
    color: #f0f0fa;
    font-weight: 620;
  }
  .message-content :global(em) {
    font-style: italic;
    opacity: 0.88;
  }
  .message-content :global(code) {
    font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
    font-size: 0.84em;
    background: rgba(255, 255, 255, 0.07);
    padding: 0.1em 0.38em;
    border-radius: 0.3em;
    border: 1px solid rgba(255, 255, 255, 0.09);
  }
  .message-content :global(ul),
  .message-content :global(ol) {
    padding-left: 1.35em;
    margin-bottom: 0.6em;
    display: flex;
    flex-direction: column;
    gap: 0.28em;
  }
  .message-content :global(ul) {
    list-style: disc;
  }
  .message-content :global(ol) {
    list-style: decimal;
  }
  .message-content :global(ul:last-child),
  .message-content :global(ol:last-child) {
    margin-bottom: 0;
  }
  .message-content :global(li) {
    line-height: 1.6;
  }
  .message-content :global(li::marker) {
    opacity: 0.5;
  }
</style>
