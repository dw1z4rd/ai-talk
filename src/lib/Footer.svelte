<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  const year = new Date().getFullYear();
  let visible = true;
  let hideTimer: ReturnType<typeof setTimeout>;

  onMount(() => {
    hideTimer = setTimeout(() => { visible = false; }, 3000);
    return () => clearTimeout(hideTimer);
  });

  function handleMouseEnter() {
    clearTimeout(hideTimer);
    visible = true;
  }

  function handleMouseLeave() {
    hideTimer = setTimeout(() => { visible = false; }, 3000);
  }
</script>

<!-- Always-present trigger zone at the bottom edge -->
<div
  class="fixed bottom-0 left-0 right-0 z-50 h-4"
  on:mouseenter={handleMouseEnter}
></div>

{#if visible}
  <footer
    transition:fade={{ duration: 500, easing: quintOut }}
    class="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md bg-[--color-surface]/80"
    style="border-top: 1px solid #0a0a12; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);"
    on:mouseleave={handleMouseLeave}
  >
    <div class="px-5 py-4 flex items-center justify-center text-xs text-[--color-muted]">
      <span class="font-extrabold text-sm">© {year} Ian Buchanan. All Rights Reserved.</span>
    </div>
  </footer>
{/if}
