<script>
  import "../app.css";
  import Footer from "$lib/Footer.svelte";
</script>

<div class="min-h-dvh flex flex-col items-center px-5 sm:px-8 pt-10 sm:pt-14 pb-20">
  <slot />
</div>
<Footer />

<style>
  :global {
    @keyframes fadeSlide {
      from {
        opacity: 0;
        transform: translateY(6px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  }
</style>
