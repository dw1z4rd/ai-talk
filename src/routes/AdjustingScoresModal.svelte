<script lang="ts">
  import { popIn, popOut } from "$lib/transitions";
  import { fade } from "svelte/transition";

  interface Props {
    show: boolean;
    count: number;
  }

  let { show, count }: Props = $props();
</script>

{#if show}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
    in:fade={{ duration: 220 }}
    out:fade={{ duration: 300 }}
  >
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none"></div>

    <!-- Content -->
    <div
      class="relative z-10 flex flex-col items-center gap-5 text-center px-10 py-10 rounded-3xl border border-[#7c6af740] bg-[#0d0d1a]/90"
      style="box-shadow: 0 0 80px #7c6af722, 0 8px 64px #0008"
      in:popIn
      out:popOut
    >
      <!-- Animated icon -->
      <div class="relative flex items-center justify-center">
        <div
          class="absolute inset-0 rounded-full blur-2xl opacity-40 scale-150"
          style="background: #c084fc"
        ></div>
        <svg
          class="relative w-14 h-14 animate-spin"
          style="animation-duration: 2.4s"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="24" cy="24" r="20"
            stroke="#7c6af740"
            stroke-width="4"
          />
          <path
            d="M24 4 a20 20 0 0 1 20 20"
            stroke="#c084fc"
            stroke-width="4"
            stroke-linecap="round"
          />
          <!-- scale icon inside -->
          <text x="24" y="30" text-anchor="middle" font-size="16" fill="#c084fc">⚖</text>
        </svg>
      </div>

      <div class="flex flex-col gap-1.5">
        <h2
          class="font-black uppercase tracking-[0.08em]"
          style="font-size: clamp(1.6rem, 5vw, 2.4rem); color: white; text-shadow: 0 0 40px #c084fc88"
        >
          Adjusting scores
        </h2>
        <p class="text-sm text-[#c084fc] font-semibold uppercase tracking-widest">
          Logic gap enforcement pass
        </p>
        {#if count > 0}
          <p class="text-xs text-[--color-muted] mt-1">
            {count} turn{count === 1 ? '' : 's'} corrected
          </p>
        {/if}
      </div>

      <p class="text-xs text-[--color-muted] max-w-xs leading-relaxed">
        Ensuring every round winner holds at least a 6-point Logic advantage over their opponent.
      </p>
    </div>
  </div>
{/if}
