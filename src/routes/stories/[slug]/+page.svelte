<script lang="ts">
  let { data } = $props();
  const { title, premise, date, authors, html } = data;

  function formatDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
</script>

<svelte:head>
  <title>{title} — aistories</title>
  <meta name="description" content={premise} />
</svelte:head>

<div class="min-h-dvh flex flex-col items-center px-5 sm:px-8 py-10 sm:py-16">
  <div class="w-full max-w-2xl flex flex-col gap-8">

    <!-- Back link -->
    <a href="/stories" class="flex items-center gap-1.5 text-[--color-muted] hover:text-[#34d399] text-sm transition-colors w-fit">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
      </svg>
      All stories
    </a>

    <!-- Story header -->
    <header class="flex flex-col gap-4 border-b border-[--color-border] pb-8">
      <h1 class="font-display text-3xl sm:text-4xl font-bold text-white leading-tight">{title}</h1>

      {#if premise && premise !== title}
        <p class="text-[--color-muted] italic leading-relaxed border-l-4 border-[#34d399] pl-4 text-sm">
          {premise}
        </p>
      {/if}

      <div class="flex items-center gap-4 flex-wrap text-[11px] text-[--color-muted] uppercase tracking-widest">
        {#if date}
          <span>{formatDate(date)}</span>
        {/if}
        {#if authors.length > 0}
          <span class="text-[--color-border]">·</span>
          <span class="normal-case tracking-normal">
            {authors.join(', ')}
          </span>
        {/if}
      </div>
    </header>

    <!-- Story body -->
    <article class="story-body">
      {@html html}
    </article>

    <!-- Footer -->
    <footer class="flex items-center gap-3 pt-6 border-t border-[--color-border-subtle]">
      <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
      <span class="text-[11px] uppercase tracking-widest text-[--color-muted]">The End</span>
      <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
    </footer>

    <div class="flex items-center justify-center gap-4 pb-4">
      <a href="/stories" class="text-sm text-[--color-muted] hover:text-[#34d399] transition-colors">← All stories</a>
      <span class="text-[--color-border]">·</span>
      <a href="/story" class="text-sm text-[--color-muted] hover:text-[#34d399] transition-colors">Write a new story</a>
    </div>
  </div>
</div>

<style>
  .story-body :global(p) {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.0625rem;
    line-height: 1.85;
    letter-spacing: 0.01em;
    color: #e2e8f0;
    margin-bottom: 0;
  }

  .story-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border-subtle, #2a2a3a);
    margin: 1.75rem 0;
  }

  .story-body :global(em) {
    color: var(--color-muted, #9090a8);
    font-style: italic;
    font-size: 0.8125rem;
    font-family: ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.02em;
  }

  .story-body :global(strong) {
    color: #fff;
    font-weight: 600;
  }
</style>