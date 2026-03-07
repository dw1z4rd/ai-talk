<script lang="ts">
  import Nav from "$lib/Nav.svelte";
  const MODEL_OPTIONS = [
    {
      group: "Ollama — Cloud",
      options: [
        {
          id: "deepseek-v3.1:671b-cloud",
          name: "DeepSeek V3.1",
          color: "#4B8BF5",
        },
        { id: "deepseek-v3.2-cloud", name: "DeepSeek V3.2", color: "#3B7BFF" },
        { id: "llama3.3:70b-cloud", name: "Llama 3.3 70B", color: "#8B5CF6" },
        {
          id: "gemini-3-flash-preview-cloud",
          name: "Gemini 3 Flash",
          color: "#1A73E8",
        },
        {
          id: "devstral-small-2:24b-cloud",
          name: "Devstral Small 2",
          color: "#FF7000",
        },
        { id: "kimi-k2.5-cloud", name: "Kimi K2.5", color: "#00C2FF" },
        {
          id: "qwen3-next:80b-cloud",
          name: "Qwen3-Next 80B",
          color: "#34D399",
        },
      ],
    },
    {
      group: "Gemini",
      options: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", color: "#4285F4" },
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", color: "#34A853" },
      ],
    },
    {
      group: "Claude",
      options: [
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          color: "#D97706",
        },
        {
          id: "claude-3-5-sonnet-20241022",
          name: "Claude 3.5 Sonnet",
          color: "#B45309",
        },
      ],
    },
  ];

  function getModelInfo(id: string) {
    for (const group of MODEL_OPTIONS) {
      const found = group.options.find((o) => o.id === id);
      if (found) return found;
    }
    return { id, name: id, color: "#7c6af7" };
  }

  interface StoryParagraph {
    agentId: string;
    agentName: string;
    color: string;
    text: string;
  }

  let premise = $state("");
  let rounds = $state(6);
  let paragraphs = $state<StoryParagraph[]>([]);
  let running = $state(false);
  let done = $state(false);
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let abortController = $state<AbortController | null>(null);

  let agentA = $state("devstral-small-2:24b-cloud");
  let agentB = $state("deepseek-v3.2-cloud");
  let agentC = $state("gemini-2.0-flash");

  let typingAgentName = $state("");
  let typingAgentColor = $state("");
  let streamingParagraph = $state<StoryParagraph | null>(null);

  let publishing = $state(false);
  let publishedSlug = $state<string | null>(null);
  let publishError = $state("");

  async function publishStory() {
    publishing = true;
    publishError = "";
    publishedSlug = null;
    try {
      const res = await fetch("/api/story/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premise, paragraphs }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        publishError = err.message || `Error ${res.status}`;
      } else {
        const { slug } = await res.json();
        publishedSlug = slug;
      }
    } catch (e: any) {
      publishError = String(e);
    } finally {
      publishing = false;
    }
  }

  let progress = $derived(
    rounds > 0 ? Math.min((paragraphs.length / (rounds * 3)) * 100, 100) : 0,
  );

  function resetStory() {
    paragraphs = [];
    done = false;
    errorMsg = "";
  }

  function exportStory(format: "md" | "txt") {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle =
      premise
        .slice(0, 40)
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase() || "story";

    let content: string;
    let mime: string;
    let ext: string;

    if (format === "md") {
      content = `# Story\n\n**Premise:** ${premise}\n\n_Exported ${date}_\n\n---\n\n`;
      content += paragraphs
        .map((p) => `_${p.agentName}:_\n${p.text}`)
        .join("\n\n");
      mime = "text/markdown";
      ext = "md";
    } else {
      content = `STORY\nPremise: ${premise}\nExported: ${date}\n${"─".repeat(40)}\n\n`;
      content += paragraphs
        .map((p) => `[${p.agentName}]\n${p.text}`)
        .join("\n\n");
      mime = "text/plain";
      ext = "txt";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `story-${safeTitle}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function stopStory() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    done = true;
    typingAgentName = "";
    streamingParagraph = null;
  }

  function onPremiseKeydown(e: KeyboardEvent) {
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      !running &&
      premise.trim()
    ) {
      e.preventDefault();
      startStory();
    }
  }

  async function startStory() {
    paragraphs = [];
    done = false;
    errorMsg = "";
    running = true;
    typingAgentName = "";
    typingAgentColor = "";
    streamingParagraph = null;
    abortController = new AbortController();

    const agentIds = [agentA, agentB, agentC].filter(Boolean);

    try {
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premise, rounds, agentIds }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        errorMsg = `Server error: ${response.status}`;
        running = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "token") {
            if (!streamingParagraph) {
              streamingParagraph = {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              };
              typingAgentName = "";
              typingAgentColor = "";
            } else {
              streamingParagraph = {
                agentId: streamingParagraph.agentId,
                agentName: streamingParagraph.agentName,
                color: streamingParagraph.color,
                text: streamingParagraph.text + data.text,
              };
            }
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              20,
            );
          } else if (data.type === "paragraph") {
            streamingParagraph = null;
            typingAgentName = "";
            typingAgentColor = "";
            paragraphs = [
              ...paragraphs,
              {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              },
            ];

            if (paragraphs.length < rounds * agentIds.length) {
              const nextId = agentIds[paragraphs.length % agentIds.length];
              const next = getModelInfo(nextId);
              typingAgentName = next.name;
              typingAgentColor = next.color;
            }
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              50,
            );
          } else if (data.type === "done") {
            done = true;
            running = false;
            typingAgentName = "";
          } else if (data.type === "error") {
            errorMsg = data.message || "An AI failed to respond.";
            running = false;
            typingAgentName = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        // User manually stopped
      } else {
        errorMsg = `Connection error: ${String(err)}`;
      }
    } finally {
      running = false;
      typingAgentName = "";
      streamingParagraph = null;
    }
  }
</script>

<div class="w-full max-w-3xl flex flex-col gap-6">
    <!-- Header -->
    <header class="text-center flex flex-col items-center gap-2">
      <div class="relative">
        <div
          class="absolute inset-0 blur-2xl opacity-30 bg-[#34d399] rounded-full scale-150"
        ></div>
        <h1
          class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight"
        >
          <span class="text-white">AI </span><span
            class="text-transparent bg-clip-text bg-gradient-to-r from-[#34d399] to-[#059669]"
            >Story Generator</span
          >
        </h1>
      </div>
      <p class="text-sm text-[--color-muted] tracking-wide">
        collaborative fiction by language models
      </p>
      <Nav />
    </header>

    <!-- Setup card -->
    <div
      class="flex flex-col gap-6 bg-[--color-panel] border border-[--color-border] rounded-2xl p-7"
    >
      <!-- Premise -->
      <div class="flex flex-col gap-1.5">
        <label
          for="premise"
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
          >Premise</label
        >
        <textarea
          id="premise"
          bind:value={premise}
          onkeydown={onPremiseKeydown}
          placeholder="Describe the plot, characters, and setting you want the AIs to write about..."
          disabled={running}
          rows="3"
          class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-4 text-base text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[#34d399] focus:shadow-[0_0_0_3px_#34d39922] disabled:opacity-40 disabled:cursor-not-allowed resize-none"
        ></textarea>
      </div>

      <!-- Agents row -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {#each [{ id: "agentA", bind: () => agentA, set: (v: string) => (agentA = v), label: "Author 1" }, { id: "agentB", bind: () => agentB, set: (v: string) => (agentB = v), label: "Author 2" }, { id: "agentC", bind: () => agentC, set: (v: string) => (agentC = v), label: "Author 3" }] as agentConf}
          <div class="flex flex-col gap-1.5">
            <label
              for={agentConf.id}
              class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5"
              style="color: {getModelInfo(agentConf.bind()).color}"
            >
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style="background: {getModelInfo(agentConf.bind()).color}"
              ></span>
              {agentConf.label}
            </label>
            <select
              id={agentConf.id}
              value={agentConf.bind()}
              onchange={(e) => agentConf.set(e.currentTarget.value)}
              disabled={running}
              class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[#34d399] disabled:opacity-40 disabled:cursor-not-allowed"
              style="border-left: 2px solid {getModelInfo(agentConf.bind())
                .color}"
            >
              {#each MODEL_OPTIONS as group}
                <optgroup label={group.group}>
                  {#each group.options as opt}
                    <option value={opt.id}>{opt.name}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
        {/each}
      </div>

      <!-- Bottom row: rounds + actions -->
      <div class="flex items-center gap-3 flex-wrap">
        <div
          class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-2"
        >
          <label
            for="rounds"
            class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap"
            >Rounds</label
          >
          <input
            id="rounds"
            type="number"
            bind:value={rounds}
            min="1"
            max="20"
            disabled={running}
            class="w-12 bg-transparent text-sm text-white outline-none disabled:opacity-40 disabled:cursor-not-allowed text-center"
          />
        </div>

        <div class="flex-1"></div>

        {#if running}
          <button
            type="button"
            onclick={stopStory}
            class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"
            ></span>
            Stop
          </button>
        {:else}
          <button
            type="button"
            onclick={() => {
              if (!running && premise.trim()) startStory();
            }}
            disabled={!premise.trim()}
            class="bg-[#34d399] hover:bg-[#059669] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#34d39940] hover:shadow-[0_0_32px_#34d39960]"
            >Start Story</button
          >
        {/if}
      </div>

      {#if errorMsg}
        <div
          class="flex items-start gap-3 bg-red-950/50 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400"
        >
          <svg
            class="w-4 h-4 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
            />
          </svg>
          {errorMsg}
        </div>
      {/if}
    </div>

    <!-- Story View -->
    <div
      class="flex flex-col rounded-2xl border border-[--color-border] overflow-hidden bg-[--color-panel]"
    >
      <!-- Sticky progress bar -->
      {#if running || (done && paragraphs.length > 0)}
        <div
          class="flex items-center gap-3 px-6 py-3 border-b border-[--color-border-subtle] bg-[--color-panel]/80 backdrop-blur-sm sticky top-0 z-10"
        >
          <div
            class="flex-1 h-1 bg-[--color-border] rounded-full overflow-hidden"
          >
            <div
              class="h-full rounded-full transition-all duration-500"
              style="width: {progress}%; background: linear-gradient(to right, #34d399, #059669)"
            ></div>
          </div>
          <span
            class="text-[11px] font-semibold tabular-nums text-[--color-muted] whitespace-nowrap"
            >{paragraphs.length}<span class="text-[--color-border] mx-0.5"
              >/</span
            >{rounds * 3}</span
          >
          {#if done}
            <span
              class="text-[11px] uppercase tracking-widest text-[--color-muted]"
              >done</span
            >
          {/if}
        </div>
      {/if}

      <!-- Story body -->
      <div
        bind:this={chatEl}
        class="flex flex-col overflow-y-auto scroll-smooth px-6 py-8 md:px-12 md:py-10 text-lg leading-relaxed text-[#d4d4e8]"
        style="min-height: 24rem; max-height: 68vh"
      >
        <!-- Empty state -->
        {#if paragraphs.length === 0 && !running && !streamingParagraph}
          <div
            class="flex flex-col items-center justify-center gap-6 flex-1 py-10"
          >
            <div class="text-4xl">📖</div>
            <p class="text-sm text-[--color-muted] text-center max-w-sm">
              Hit <span class="text-white font-semibold">Start Story</span> to begin
              writing. The AI models will take turns writing the next paragraph.
            </p>
          </div>
        {/if}

        {#if paragraphs.length > 0 || streamingParagraph}
          <p
            class="mb-6 font-serif italic text-[#a1a1aa] border-l-4 border-[#34d399] pl-4"
          >
            {premise}
          </p>
        {/if}

        <!-- Paragraphs -->
        {#each paragraphs as p, i (i)}
          <div
            class="mb-6 group relative"
            style="animation: fadeSlide 0.2s ease both; animation-delay: {Math.min(
              i * 20,
              100,
            )}ms"
          >
            <div
              class="absolute -left-6 md:-left-10 top-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <div
                class="w-4 h-4 rounded-full flex items-center justify-center"
                style="background: {p.color}40; border: 1px solid {p.color}"
                title={p.agentName}
              ></div>
            </div>
            <p
              class="font-serif text-[17px] md:text-[19px] leading-[1.8] tracking-wide"
              style="color: {i === paragraphs.length - 1 && !running
                ? '#ffffff'
                : '#e2e8f0'}"
            >
              {p.text}
            </p>
          </div>
        {/each}

        <!-- Live stream / typing indicator -->
        {#if running}
          {#if streamingParagraph}
            <div
              class="mb-6 relative"
              style="animation: fadeSlide 0.15s ease both"
            >
              <div class="absolute -left-6 md:-left-10 top-1">
                <div
                  class="w-4 h-4 rounded-full flex items-center justify-center animate-pulse"
                  style="background: {streamingParagraph.color}80; border: 1px solid {streamingParagraph.color}"
                  title={streamingParagraph.agentName}
                ></div>
              </div>
              <p
                class="font-serif text-[17px] md:text-[19px] leading-[1.8] tracking-wide text-white"
              >
                {streamingParagraph.text}<span
                  class="inline-block w-[3px] h-[1em] ml-[2px] align-text-bottom rounded-sm animate-pulse"
                  style="background: {streamingParagraph.color}"
                ></span>
              </p>
            </div>
          {:else if typingAgentName}
            <div class="flex items-center gap-3 py-4">
              <div
                class="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0 ring-1"
                style="background: {typingAgentColor}15; color: {typingAgentColor}; ring-color: {typingAgentColor}30"
              >
                {typingAgentName[0]}
              </div>
              <div class="flex gap-1 items-center">
                <span
                  class="w-1 h-1 rounded-full animate-bounce [animation-delay:0ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
                <span
                  class="w-1 h-1 rounded-full animate-bounce [animation-delay:160ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
                <span
                  class="w-1 h-1 rounded-full animate-bounce [animation-delay:320ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
              </div>
              <span
                class="text-xs text-[--color-muted]"
                style="color: {typingAgentColor}AA"
                >{typingAgentName} is writing…</span
              >
            </div>
          {/if}
        {/if}

        {#if done}
          <div
            class="flex items-center gap-3 py-6 mt-4 border-t border-[--color-border-subtle]"
          >
            <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
            <span
              class="text-[11px] uppercase tracking-widest text-[--color-muted]"
              >The End</span
            >
            <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Export -->
    {#if paragraphs.length > 0}
      <div class="flex items-center gap-2">
        <span
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] mr-1"
          >Export</span
        >
        <button
          onclick={() => exportStory("md")}
          class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[#34d399] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4"
            /></svg
          >
          Markdown
        </button>
        <button
          onclick={() => exportStory("txt")}
          class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[#34d399] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4"
            /></svg
          >
          Plain text
        </button>
        {#if done && !publishedSlug}
          <button
            type="button"
            onclick={publishStory}
            disabled={publishing}
            class="flex items-center gap-1.5 bg-[#34d399]/10 text-[#34d399] hover:bg-[#34d399]/20 border border-[#34d399]/30 font-semibold text-xs px-4 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if publishing}
              <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Publishing…
            {:else}
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>
              Publish
            {/if}
          </button>
        {/if}

        {#if publishedSlug}
          <a
            href="/stories/{publishedSlug}"
            class="flex items-center gap-1.5 bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/40 font-semibold text-xs px-4 py-2 rounded-lg transition-all hover:bg-[#34d399]/20"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
            View published
          </a>
        {/if}

        <button
          onclick={resetStory}
          class="ml-auto flex items-center gap-1.5 text-[--color-muted] hover:text-red-400 text-xs font-medium px-3.5 py-2 rounded-lg border border-transparent hover:border-red-900/50 transition-all cursor-pointer"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
            /></svg
          >
          Clear
        </button>
      </div>

      {#if publishError}
        <div class="flex items-start gap-2 bg-red-950/50 border border-red-900/50 rounded-xl px-4 py-3 text-xs text-red-400">
          Publish failed: {publishError}
        </div>
      {/if}
    {/if}
</div>

<style>
</style>
