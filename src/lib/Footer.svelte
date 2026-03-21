<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicInOut } from 'svelte/easing';

  const year = new Date().getFullYear();

  // Desktop: fade-based show/hide (hover + 3s timer)
  let visible = true;
  // Mobile: translate-based show/hide (scroll direction + 3s timer)
  let mobileHidden = false;

  let isMobile = false;
  let hideTimer: ReturnType<typeof setTimeout>;
  let lastScrollY = 0;
  let touchStartY = 0;

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    isMobile = mq.matches;

    const onMqChange = (e: MediaQueryListEvent) => {
      isMobile = e.matches;
      clearTimeout(hideTimer);
      if (isMobile) {
        visible = true;
        mobileHidden = false;
      } else {
        mobileHidden = false;
        hideTimer = setTimeout(() => { visible = false; }, 3000);
      }
    };
    mq.addEventListener('change', onMqChange);

    // Desktop only: auto-hide after 3s
    if (!isMobile) {
      hideTimer = setTimeout(() => { visible = false; }, 3000);
    }

    // --- Mobile scroll detection ---
    lastScrollY = window.scrollY;

    // Window scroll (fires when the whole page scrolls)
    function onWindowScroll() {
      if (!isMobile) return;
      const y = window.scrollY;
      const delta = y - lastScrollY;
      if (delta > 4 && !mobileHidden) {
        mobileHidden = true;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { mobileHidden = false; }, 3000);
      } else if (delta < -4 && mobileHidden) {
        mobileHidden = false;
        clearTimeout(hideTimer);
      }
      lastScrollY = y;
    }

    // Touch events (fires for swipes inside overflow containers too)
    function onTouchStart(e: TouchEvent) {
      touchStartY = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      if (!isMobile) return;
      const dy = touchStartY - e.touches[0].clientY;
      if (dy > 20 && !mobileHidden) {
        // Swiping up → hide footer
        mobileHidden = true;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { mobileHidden = false; }, 3000);
        touchStartY = e.touches[0].clientY;
      } else if (dy < -20 && mobileHidden) {
        // Swiping down → show footer
        mobileHidden = false;
        clearTimeout(hideTimer);
        touchStartY = e.touches[0].clientY;
      }
    }

    window.addEventListener('scroll', onWindowScroll, { passive: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      clearTimeout(hideTimer);
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('scroll', onWindowScroll);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  });

  function handleMouseEnter() {
    if (isMobile) return;
    clearTimeout(hideTimer);
    visible = true;
  }

  function handleMouseLeave() {
    if (isMobile) return;
    hideTimer = setTimeout(() => { visible = false; }, 3000);
  }
</script>

<!-- Desktop hover trigger zone -->
<div
  class="fixed bottom-0 left-0 right-0 z-50 h-4"
  on:mouseenter={handleMouseEnter}
></div>

{#if visible}
  <footer
    transition:fade={{ duration: 1500, easing: cubicInOut }}
    class="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md bg-[--color-surface]/80 transition-transform duration-300 ease-in-out"
    class:translate-y-full={mobileHidden}
    style="border-top: 1px solid #0a0a12; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);"
    on:mouseleave={handleMouseLeave}
  >
    <div class="px-5 py-4 flex items-center justify-center text-xs text-[--color-muted]">
      <span class="font-extrabold text-sm">© {year} Ian Buchanan. All Rights Reserved.</span>
    </div>
  </footer>
{/if}
