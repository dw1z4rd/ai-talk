
<script lang="ts">
  import { flyInFromTop, flyOutToBottom } from "$lib/transitions";

  interface Props {
    docAnalysisMode?: boolean;
  }
  let { docAnalysisMode = false }: Props = $props();
</script>

<header class="text-center flex flex-col items-center gap-2">
  <div class="relative">
    <div
      class="absolute inset-0 blur-2xl opacity-30 rounded-full scale-150 transition-colors duration-700"
      style="background-color: {docAnalysisMode ? '#ef4444' : '#7c6af7'}"
    ></div>
    <h1
      class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight overflow-hidden"
    >
      {#key docAnalysisMode}
        <span
          class="block"
          in:flyInFromTop={{ duration: 500 }}
          out:flyOutToBottom={{ duration: 350 }}
        >
          {#if docAnalysisMode}
            <span class="text-white">Bullshit </span><span
              class="text-transparent bg-clip-text bg-gradient-to-r from-[#ef4444] to-[#f97316]"
              >Detector</span
            >
          {:else}
            <span class="text-white">AI </span><span
              class="text-transparent bg-clip-text bg-gradient-to-r from-[#7c6af7] to-[#c084fc]"
              >Debate</span
            >
          {/if}
        </span>
      {/key}
    </h1>
  </div>
  <p class="text-sm text-[--color-muted] tracking-wide">
    {#if docAnalysisMode}
      upload text, expose the gaps
    {:else}
      two AIs, one topic, no mercy
    {/if}
  </p>
</header>
