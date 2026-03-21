<script lang="ts">
  import type { ChatMessage } from "$lib/debate/models";
  import { formatMessage } from "$lib/debate/formatMessage";

  interface Props {
    msg: ChatMessage;
    index: number;
    leftAgentId: string;
  }

  let { msg, index, leftAgentId }: Props = $props();

  const isLeft = $derived(msg.agentId === leftAgentId);
</script>

{#if msg.agentId === "moderator"}
  <div
    class="flex flex-col items-center gap-2 px-6 py-6 border-t border-[--color-border-subtle]"
    style="animation: fadeSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: {Math.min(
      index * 250,
      250,
    )}ms"
  >
    <span
      class="text-[10px] font-bold uppercase tracking-widest text-[#ff4b4b] bg-[#ff4b4b]/10 px-3 py-1 rounded-full border border-[#ff4b4b]/20"
      >Moderator Intervened</span
    >
    <p
      class="text-[14.5px] leading-relaxed text-white text-center max-w-[95%] sm:max-w-[80%] italic"
    >
      "{msg.text}"
    </p>
  </div>
{:else}
  <div
    class="group flex gap-3 px-3 py-3 sm:px-6 sm:py-4 border-t border-[--color-border-subtle] {isLeft
      ? ''
      : 'sm:flex-row-reverse'}"
    style="animation: fadeSlide 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: {Math.min(
      index * 20,
      100,
    )}ms"
  >
    <!-- Avatar -->
    <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
      <div
        class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
        style="background: linear-gradient(135deg, {msg.color}22, {msg.color}0a); color: {msg.color}; border: 1px solid {msg.color}28"
      >
        {msg.agentName[0]}
      </div>
      <span
        class="text-[10px] tabular-nums text-[--color-border] group-hover:text-[--color-muted] transition-colors"
        >#{index + 1}</span
      >
    </div>
    <!-- Bubble -->
    <div
      class="flex flex-col gap-1.5 min-w-0 {isLeft
        ? 'items-start'
        : 'items-start sm:items-end'}"
      style="max-width: calc(100% - 3rem)"
    >
      <span
        class="text-[10px] font-bold uppercase tracking-widest"
        style="color: {msg.color}">{msg.agentName}</span
      >
      <div
        class="message-content text-[14px] sm:text-[15px] leading-relaxed sm:leading-[1.72] text-[#d4d4e8] px-3 py-3 sm:px-5 sm:py-4 rounded-2xl {isLeft
          ? 'rounded-tl-sm border-l-2'
          : 'rounded-tr-sm border-r-2'}"
        style="background-color: {msg.color}09; border-color: {msg.color}30; border-top: 1px solid {msg.color}1a; border-bottom: 1px solid {msg.color}1a; {isLeft
          ? ''
          : 'border-left: 1px solid ' + msg.color + '1a'}"
      >
        {@html formatMessage(msg.text)}
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeSlide {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

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
