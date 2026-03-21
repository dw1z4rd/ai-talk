<script lang="ts">
  import { flip } from "svelte/animate";
  import { flyInFromTop, flyOutToRight } from "$lib/transitions";

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

  let { notifications }: { notifications: ScoreUpdateNotification[] } = $props();
</script>

<div
  class="fixed bottom-6 right-6 z-50 flex flex-col-reverse gap-2 pointer-events-none"
  aria-live="polite"
>
  {#each notifications as n (n.id)}
    <div
      class="w-72 rounded-xl border border-[--color-border] bg-[--color-panel] shadow-xl pointer-events-auto overflow-hidden"
      style="border-left: 4px solid {n.updateType === 'penalty' ? '#f87171' : '#34d399'}"
      animate:flip={{ duration: 300 }}
      in:flyInFromTop
      out:flyOutToRight
    >
      <div class="px-3 py-2.5 flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span
            class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
            style="background: {n.updateType === 'penalty' ? '#f8717122' : '#34d39922'}; color: {n.updateType === 'penalty' ? '#f87171' : '#34d399'}"
          >
            T{n.targetTurn}
          </span>
          <span class="text-xs font-semibold truncate" style="color: {n.agentColor}">
            {n.agentName}
          </span>
          <span
            class="ml-auto font-mono font-bold text-xs"
            style="color: {n.updateType === 'penalty' ? '#f87171' : '#34d399'}"
          >
            {n.deltaLogic > 0 ? "+" : ""}{n.deltaLogic} Logic
          </span>
        </div>
        <p class="text-[11px] text-[--color-muted] line-clamp-2 leading-snug">
          {n.reason}
        </p>
      </div>
    </div>
  {/each}
</div>
