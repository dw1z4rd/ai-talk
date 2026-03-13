<script lang="ts">
  import Nav from "$lib/Nav.svelte";
  let { data } = $props();
  let stories = $derived(() => data.stories);
  +++++++ REPLACE

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

<div class="w-full max-w-3xl flex flex-col gap-8">
    <!-- Header -->
    <header class="text-center flex flex-col items-center gap-2">
      <div class="relative">
        <div class="absolute inset-0 blur-2xl opacity-30 bg-[#34d399] rounded-full scale-150"></div>
        <h1 class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight">
          <span class="text-white">AI </span><span
            class="text-transparent bg-clip-text bg-gradient-to-r from-[#34d399] to-[#059669]"
            >Stories</span
          >
        </h1>
      </div>
      <p class="text-sm text-[--color-muted] tracking-wide">published collaborative fiction</p>
      <Nav />
    </header>

    <!-- Story list -->
    {#if stories.length === 0}
      <div class="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div class="text-5xl opacity-40">📚</div>
        <p class="text-[--color-muted] text-sm max-w-xs">
          No stories published yet. Generate a story and hit <span class="text-white font-semibold">Publish</span> to see it here.
        </p>
        <a href="/story" class="mt-2 bg-[#34d399] hover:bg-[#059669] text-white font-semibold text-sm px-6 py-2.5 rounded-xl transition-all shadow-[0_0_24px_#34d39940]">
          Write a Story
        </a>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        {#each stories as story}
          <a
            href="/stories/{story.slug}"
            class="group flex flex-col gap-3 bg-[--color-panel] border border-[--color-border] hover:border-[#34d399]/50 rounded-2xl p-6 transition-all hover:shadow-[0_0_24px_#34d39915]"
          >
            <div class="flex items-start justify-between gap-4">
              <h2 class="text-lg font-semibold text-white group-hover:text-[#34d399] transition-colors leading-snug">
                {story.title}
              </h2>
              {#if story.date}
                <span class="text-[11px] text-[--color-muted] whitespace-nowrap flex-shrink-0 mt-0.5">
                  {formatDate(story.date)}
                </span>
              {/if}
            </div>

            {#if story.premise && story.premise !== story.title}
              <p class="text-sm text-[--color-muted] line-clamp-2 leading-relaxed">
                {story.premise}
              </p>
            {/if}

            {#if story.authors.length > 0}
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] uppercase tracking-widest text-[--color-muted]">Authors</span>
                {#each story.authors as author}
                  <span class="text-[11px] bg-[--color-surface] border border-[--color-border] rounded-md px-2 py-0.5 text-[--color-muted-fg]">
                    {author}
                  </span>
                {/each}
              </div>
            {/if}
          </a>
        {/each}
      </div>

      <div class="flex justify-center pt-2">
        <a href="/story" class="text-sm text-[--color-muted] hover:text-[#34d399] transition-colors">
          + Write another story
        </a>
      </div>
    {/if}
</div>