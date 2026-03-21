<script lang="ts">
  import { page } from '$app/stores';

  const NAV_ITEMS = [
    { href: '/', label: '⚔️ Debate' },
    { href: '/about', label: '🤔 About' },
  ];

  function isActive(href: string): boolean {
    return $page.url.pathname === href;
  }

  function activeColor(_href: string): string {
    return 'var(--color-accent)';
  }
</script>

<div class="flex items-center gap-1 mt-1 bg-[--color-panel] border border-[--color-border] rounded-xl p-1 flex-wrap justify-center">
  {#each NAV_ITEMS as item}
    {#if isActive(item.href)}
      <span
        class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg"
        style="background: {activeColor(item.href)}1a; color: {activeColor(item.href)}"
      >{item.label}</span>
    {:else}
      <a
        href={item.href}
        class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg text-[--color-muted] hover:text-white transition-colors"
      >{item.label}</a>
    {/if}
  {/each}
</div>