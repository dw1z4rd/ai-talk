<script lang="ts">
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>Admin — Unlock</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-sm flex flex-col gap-6">

    <header class="text-center flex flex-col items-center gap-2">
      <div class="relative">
        <div class="absolute inset-0 blur-2xl opacity-25 bg-[--color-accent] rounded-full scale-150"></div>
        <h1 class="relative font-display text-4xl font-bold tracking-tight">
          <span class="text-white">Tarpit </span><span class="text-transparent bg-clip-text bg-gradient-to-r from-[--color-accent] to-purple-400">Command</span>
        </h1>
      </div>
      <p class="text-sm text-[--color-muted] tracking-wide">classified access only</p>
    </header>

    <form
      method="POST"
      class="bg-[--color-panel] border border-[--color-border] rounded-2xl p-7 flex flex-col gap-5"
    >
      {#if form?.error}
        <div class="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm font-medium">
          {form.error}
        </div>
      {/if}

      <div class="flex flex-col gap-2">
        <label
          for="password"
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-white placeholder-[--color-muted] focus:outline-none focus:border-[--color-accent] transition-colors text-sm"
          placeholder="Enter admin password"
        />
      </div>

      <button
        type="submit"
        class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold py-3 px-6 rounded-xl transition-colors cursor-pointer tracking-wide"
      >
        Unlock
      </button>
    </form>

  </div>
</div>
