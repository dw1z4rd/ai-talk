<script lang="ts">
  import { MODEL_OPTIONS, getModelInfo } from "$lib/debate/models";

  interface Props {
    agentA: string;
    agentB: string;
    running: boolean;
  }

  let { agentA = $bindable(), agentB = $bindable(), running }: Props = $props();

  function swapAgents() {
    [agentA, agentB] = [agentB, agentA];
  }
</script>

<div class="grid grid-cols-[1fr_36px_1fr] items-end gap-2">
  <div class="flex flex-col gap-1.5">
    <label
      for="agentA"
      class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5"
      style="color: {getModelInfo(agentA).color}"
    >
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style="background: {getModelInfo(agentA).color}"
      ></span>
      Agent A
    </label>
    <select
      id="agentA"
      bind:value={agentA}
      disabled={running}
      class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
      style="border-left: 2px solid {getModelInfo(agentA).color}"
    >
      {#each MODEL_OPTIONS as group}
        <optgroup label={group.group}>
          {#each group.options as opt}
            <option value={opt.id}>{opt.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </div>

  <button
    type="button"
    onclick={swapAgents}
    disabled={running}
    title="Swap agents"
    class="h-[42px] flex items-center justify-center rounded-xl bg-[--color-surface] border border-[--color-border] hover:border-[--color-accent] hover:text-[--color-accent] text-[--color-muted] text-base transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
    >⇄</button
  >

  <div class="flex flex-col gap-1.5">
    <label
      for="agentB"
      class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5 justify-end"
      style="color: {getModelInfo(agentB).color}"
    >
      Agent B
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style="background: {getModelInfo(agentB).color}"
      ></span>
    </label>
    <select
      id="agentB"
      bind:value={agentB}
      disabled={running}
      class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
      style="border-right: 2px solid {getModelInfo(agentB).color}"
    >
      {#each MODEL_OPTIONS as group}
        <optgroup label={group.group}>
          {#each group.options as opt}
            <option value={opt.id}>{opt.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </div>
</div>
