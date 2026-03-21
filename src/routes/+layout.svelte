<script>
  import "../app.css";
</script>

<div class="min-h-dvh flex flex-col items-center px-5 sm:px-8 py-10 sm:py-14">
  <slot />
</div>

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
