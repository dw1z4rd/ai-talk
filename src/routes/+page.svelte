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
        {
          id: "devstral-small-2:24b-cloud",
          name: "Devstral Small 2",
          color: "#FF7000",
        },
        { id: "qwen3:72b-cloud", name: "Qwen 3 72B", color: "#34D399" },
        {
          id: "llama4-maverick-cloud",
          name: "Llama 4 Maverick",
          color: "#A78BFA",
        },
      ],
    },
    {
      group: "Gemini",
      options: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", color: "#4285F4" },
        {
          id: "gemini-3-flash-preview-cloud",
          name: "Gemini 2.5 Flash",
          color: "#1A73E8",
        },
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

  interface ChatMessage {
    agentId: string;
    agentName: string;
    color: string;
    text: string;
  }

  interface ContextFile {
    name: string;
    content: string;
  }

  const MAX_FILE_BYTES = 80_000;
  const ACCEPTED = ".txt,.md,.csv,.json";

  let topic = $state("Is free will an illusion?");
  let turns = $state(20);
  let messages = $state<ChatMessage[]>([]);
  let running = $state(false);
  let isPaused = $state(false);
  let moderatorInput = $state("");
  let done = $state(false);
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let abortController = $state<AbortController | null>(null);
  let agentA = $state("gemini-2.0-flash");
  let agentB = $state("devstral-small-2:24b-cloud");
  let leftAgentId = $state("gemini-2.0-flash");
  let typingAgentName = $state("");
  let typingAgentColor = $state("");
  let streamingMessage = $state<ChatMessage | null>(null);

  // Files
  let contextFiles = $state<ContextFile[]>([]);
  let dragging = $state(false);
  let fileError = $state("");

  // Derived progress
  let progress = $derived(
    turns > 0 ? Math.min((messages.length / turns) * 100, 100) : 0,
  );

  // UI state
  let showFiles = $state(false);

  function swapAgents() {
    [agentA, agentB] = [agentB, agentA];
  }

  function resetConversation() {
    messages = [];
    done = false;
    errorMsg = "";
  }

  function buildContext(): string | undefined {
    if (contextFiles.length === 0) return undefined;
    return contextFiles
      .map((f) => `--- ${f.name} ---\n${f.content}`)
      .join("\n\n");
  }

  async function readFile(file: File): Promise<void> {
    if (contextFiles.find((f) => f.name === file.name)) return;
    if (file.size > MAX_FILE_BYTES) {
      fileError = `"${file.name}" is too large (max 80 KB).`;
      return;
    }
    const content = await file.text();
    contextFiles = [...contextFiles, { name: file.name, content }];
    fileError = "";
  }

  async function onFileInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) await readFile(file);
    input.value = "";
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    for (const file of Array.from(e.dataTransfer?.files ?? []))
      await readFile(file);
  }

  function removeFile(name: string) {
    contextFiles = contextFiles.filter((f) => f.name !== name);
  }

  function exportDebate(format: "md" | "txt") {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = topic
      .slice(0, 60)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    let content: string;
    let mime: string;
    let ext: string;

    if (format === "md") {
      content = `# Debate: ${topic}\n\n_Exported ${date}_\n\n---\n\n`;
      content += messages
        .map((m) => `### ${m.agentName}\n\n${m.text}`)
        .join("\n\n---\n\n");
      mime = "text/markdown";
      ext = "md";
    } else {
      content = `DEBATE: ${topic}\nExported: ${date}\n${"─".repeat(40)}\n\n`;
      content += messages
        .map((m) => `[${m.agentName}]\n${m.text}`)
        .join("\n\n");
      mime = "text/plain";
      ext = "txt";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debate-${safeTitle}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function pauseConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    isPaused = true;
    typingAgentName = "";

    // If there was a streaming message, commit it to history so it's not lost
    if (streamingMessage) {
      messages = [...messages, streamingMessage];
      streamingMessage = null;
    }
  }

  function stopConversation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    running = false;
    done = true;
    isPaused = false;
    typingAgentName = "";
    streamingMessage = null;
  }

  function onTopicKeydown(e: KeyboardEvent) {
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      !running &&
      !isPaused &&
      topic.trim()
    ) {
      e.preventDefault();
      startConversation();
    }
  }

  function onModeratorKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && moderatorInput.trim()) {
      e.preventDefault();
      const text = moderatorInput.trim();
      moderatorInput = "";
      messages = [
        ...messages,
        {
          agentId: "moderator",
          agentName: "Moderator",
          color: "#ff4b4b",
          text,
        },
      ];
      startConversation(true);
    }
  }

  async function startConversation(resume = false) {
    if (!resume) {
      messages = [];
      leftAgentId = agentA;
    }
    done = false;
    isPaused = false;
    errorMsg = "";
    running = true;
    typingAgentName = "";
    typingAgentColor = "";
    streamingMessage = null;
    abortController = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          turns,
          context: buildContext(),
          agentA,
          agentB,
          messages: resume ? messages : undefined,
        }),
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
            if (!streamingMessage) {
              // First token — create the streaming bubble and hide typing dots
              streamingMessage = {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              };
              typingAgentName = "";
              typingAgentColor = "";
            } else {
              streamingMessage = {
                agentId: streamingMessage.agentId,
                agentName: streamingMessage.agentName,
                color: streamingMessage.color,
                text: streamingMessage.text + data.text,
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
          } else if (data.type === "message") {
            streamingMessage = null;
            typingAgentName = "";
            typingAgentColor = "";
            messages = [
              ...messages,
              {
                agentId: data.agentId,
                agentName: data.agentName,
                color: data.color,
                text: data.text,
              },
            ];
            // Set the next typing agent
            const aiCount = messages.filter(
              (m) => m.agentId !== "moderator",
            ).length;
            if (aiCount < turns) {
              const nextId = data.agentId === agentA ? agentB : agentA;
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
      streamingMessage = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-full max-w-2xl flex flex-col gap-6"
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => e.preventDefault()}
>
    <!-- Header -->
    <header class="text-center flex flex-col items-center gap-2">
      <div class="relative">
        <div
          class="absolute inset-0 blur-2xl opacity-30 bg-[#7c6af7] rounded-full scale-150"
        ></div>
        <h1
          class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight"
        >
          <span class="text-white">AI </span><span
            class="text-transparent bg-clip-text bg-gradient-to-r from-[#7c6af7] to-[#c084fc]"
            >Debate</span
          >
        </h1>
      </div>
      <p class="text-sm text-[--color-muted] tracking-wide">
        two AIs, one topic, no mercy
      </p>
      <Nav />
    </header>

    <!-- Setup card -->
    <div
      class="flex flex-col gap-6 bg-[--color-panel] border border-[--color-border] rounded-2xl p-7"
    >
      <!-- Topic -->
      <div class="flex flex-col gap-1.5">
        <label
          for="topic"
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
          >Topic</label
        >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          id="topic"
          type="text"
          bind:value={topic}
          onkeydown={onTopicKeydown}
          placeholder="What should they debate?"
          disabled={running}
          autofocus
          class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-4 text-base text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] disabled:opacity-40 disabled:cursor-not-allowed"
        />
      </div>

      <!-- Agents row -->
      <div class="grid grid-cols-[1fr_36px_1fr] items-end gap-2">
        <div class="flex flex-col gap-1.5">
          <label
            for="agentA"
            class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5"
            style="color: {getModelInfo(agentA).color}"
          >
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style="background: {getModelInfo(agentA).color}"
            ></span>
            Agent A
          </label>
          <select
            id="agentA"
            bind:value={agentA}
            disabled={running}
            class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
            style="border-left: 2px solid {getModelInfo(agentA).color}"
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

        <button
          type="button"
          onclick={swapAgents}
          disabled={running}
          title="Swap agents"
          class="h-[42px] flex items-center justify-center rounded-xl bg-[--color-surface] border border-[--color-border] hover:border-[--color-accent] hover:text-[--color-accent] text-[--color-muted] text-base transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >⇄</button
        >

        <div class="flex flex-col gap-1.5">
          <label
            for="agentB"
            class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5 justify-end"
            style="color: {getModelInfo(agentB).color}"
          >
            Agent B
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style="background: {getModelInfo(agentB).color}"
            ></span>
          </label>
          <select
            id="agentB"
            bind:value={agentB}
            disabled={running}
            class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
            style="border-right: 2px solid {getModelInfo(agentB).color}"
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
      </div>

      <!-- Bottom row: turns + context toggle + actions -->
      <div class="flex items-center gap-3 flex-wrap">
        <div
          class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-2"
        >
          <label
            for="turns"
            class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap"
            >Turns</label
          >
          <input
            id="turns"
            type="number"
            bind:value={turns}
            min="2"
            max="30"
            disabled={running}
            class="w-12 bg-transparent text-sm text-white outline-none disabled:opacity-40 disabled:cursor-not-allowed text-center"
          />
        </div>

        <button
          type="button"
          onclick={() => {
            showFiles = !showFiles;
          }}
          class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border transition-all cursor-pointer
						{showFiles
            ? 'border-[--color-accent] text-[--color-accent] bg-[#7c6af7]/5'
            : 'border-[--color-border] text-[--color-muted] hover:border-[--color-muted] bg-[--color-surface]'}"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M15.172 7l-6.586 6.586a2 2 0 1 0 2.828 2.828l6.414-6.586a4 4 0 0 0-5.656-5.656l-6.415 6.585a6 6 0 1 0 8.486 8.486L20.5 13"
            />
          </svg>
          Files {#if contextFiles.length > 0}<span
              class="ml-0.5 bg-[--color-accent] text-white rounded-full px-1.5 py-0 text-[10px] leading-4"
              >{contextFiles.length}</span
            >{/if}
        </button>

        <div class="flex-1"></div>

        {#if running}
          <button
            type="button"
            onclick={pauseConversation}
            class="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
          >
            Pause
          </button>
          <button
            type="button"
            onclick={stopConversation}
            class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"
            ></span>
            Stop
          </button>
        {:else if isPaused}
          <button
            type="button"
            onclick={() => startConversation(true)}
            class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
            >Resume debate</button
          >
          <button
            type="button"
            onclick={stopConversation}
            class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
          >
            Stop
          </button>
        {:else}
          <button
            type="button"
            onclick={() => {
              if (!running && topic.trim()) startConversation();
            }}
            disabled={!topic.trim()}
            class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
            >Start debate</button
          >
        {/if}
      </div>

      {#if isPaused}
        <div
          class="flex flex-col gap-1.5 pt-2 border-t border-[--color-border-subtle]"
        >
          <label
            for="moderatorInput"
            class="text-[11px] font-semibold uppercase tracking-widest text-[#ff4b4b]"
            >Moderator Intervention</label
          >
          <input
            id="moderatorInput"
            type="text"
            bind:value={moderatorInput}
            onkeydown={onModeratorKeydown}
            placeholder="Add a point, sub-topic, or rebuttal..."
            autofocus
            class="w-full bg-[--color-surface] border border-[#ff4b4b]/30 rounded-xl px-4 py-3 text-sm text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[#ff4b4b] focus:shadow-[0_0_0_3px_#ff4b4b22]"
          />
          <p class="text-xs text-[--color-muted]">
            Hit <span class="text-white font-semibold">Enter</span> to inject message
            and resume debate
          </p>
        </div>
      {/if}

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

      <!-- Context files (collapsible) -->
      {#if showFiles}
        <div
          class="flex flex-col gap-2 pt-1 border-t border-[--color-border-subtle]"
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <label
            for="file-input"
            class="flex items-center justify-center gap-2.5 border border-dashed rounded-xl px-5 py-3.5 cursor-pointer transition-all
							{dragging
              ? 'border-[--color-accent] bg-[#7c6af7]/5'
              : 'border-[--color-border] hover:border-[--color-muted]'}"
            ondragover={(e) => {
              e.preventDefault();
              dragging = true;
            }}
            ondragleave={() => {
              dragging = false;
            }}
            ondrop={onDrop}
          >
            <svg
              class="w-4 h-4 text-[--color-muted] flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 16v-8m0 0-3 3m3-3 3 3M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
              />
            </svg>
            <span class="text-sm text-[--color-muted-fg]"
              >Drop files or <span class="text-[--color-accent]">browse</span
              ></span
            >
            <span class="text-xs text-[--color-muted]"
              >.txt · .md · .csv · .json · 80 KB max</span
            >
            <input
              id="file-input"
              type="file"
              accept={ACCEPTED}
              multiple
              class="sr-only"
              onchange={onFileInput}
              disabled={running}
            />
          </label>
          {#if fileError}<p class="text-xs text-red-400">{fileError}</p>{/if}
          {#if contextFiles.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each contextFiles as file (file.name)}
                <div
                  class="flex items-center gap-2 bg-[--color-surface] border border-[--color-border] rounded-lg pl-3 pr-2 py-1.5"
                >
                  <svg
                    class="w-3 h-3 text-[--color-muted] flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"
                    />
                  </svg>
                  <span
                    class="text-xs text-[--color-muted-fg] max-w-[140px] truncate"
                    >{file.name}</span
                  >
                  <span class="text-[10px] text-[--color-muted]"
                    >{(file.content.length / 1024).toFixed(1)}KB</span
                  >
                  <button
                    onclick={() => removeFile(file.name)}
                    disabled={running}
                    class="text-[--color-muted] hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer ml-0.5"
                    aria-label="Remove {file.name}"
                  >
                    <svg
                      class="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Chat -->
    <div
      class="flex flex-col rounded-2xl border border-[--color-border] overflow-hidden bg-[--color-panel]"
    >
      <!-- Sticky progress bar -->
      {#if running || (done && messages.length > 0)}
        <div
          class="flex items-center gap-3 px-6 py-3 border-b border-[--color-border-subtle] bg-[--color-panel]/80 backdrop-blur-sm sticky top-0 z-10"
        >
          <div
            class="flex-1 h-1 bg-[--color-border] rounded-full overflow-hidden"
          >
            <div
              class="h-full rounded-full transition-all duration-500"
              style="width: {progress}%; background: linear-gradient(to right, #7c6af7, #c084fc)"
            ></div>
          </div>
          <span
            class="text-[11px] font-semibold tabular-nums text-[--color-muted] whitespace-nowrap"
            >{messages.length}<span class="text-[--color-border] mx-0.5">/</span
            >{turns}</span
          >
          {#if done}
            <span
              class="text-[11px] uppercase tracking-widest text-[--color-muted]"
              >done</span
            >
          {/if}
        </div>
      {/if}

      <!-- Chat body -->
      <div
        bind:this={chatEl}
        class="flex flex-col overflow-y-auto scroll-smooth"
        style="min-height: 24rem; max-height: 68vh"
      >
        <!-- Empty state -->
        {#if messages.length === 0 && !running}
          <div
            class="flex flex-col items-center justify-center gap-8 flex-1 py-16 px-6"
          >
            <div class="flex items-center gap-8">
              <div class="flex flex-col items-center gap-2.5">
                <div
                  class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
                  style="background: linear-gradient(135deg, {getModelInfo(
                    agentA,
                  ).color}22, {getModelInfo(agentA)
                    .color}08); color: {getModelInfo(agentA)
                    .color}; border: 1px solid {getModelInfo(agentA).color}30"
                >
                  {getModelInfo(agentA).name[0]}
                </div>
                <span
                  class="text-xs font-semibold text-center max-w-[100px] leading-snug"
                  style="color: {getModelInfo(agentA).color}"
                  >{getModelInfo(agentA).name}</span
                >
              </div>

              <div class="flex flex-col items-center gap-1">
                <span
                  class="text-[11px] font-bold uppercase tracking-[0.4em] text-[--color-muted]"
                  >vs</span
                >
                <div class="flex gap-1">
                  <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                  <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                  <span class="w-1 h-1 rounded-full bg-[--color-border]"></span>
                </div>
              </div>

              <div class="flex flex-col items-center gap-2.5">
                <div
                  class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg"
                  style="background: linear-gradient(135deg, {getModelInfo(
                    agentB,
                  ).color}22, {getModelInfo(agentB)
                    .color}08); color: {getModelInfo(agentB)
                    .color}; border: 1px solid {getModelInfo(agentB).color}30"
                >
                  {getModelInfo(agentB).name[0]}
                </div>
                <span
                  class="text-xs font-semibold text-center max-w-[100px] leading-snug"
                  style="color: {getModelInfo(agentB).color}"
                  >{getModelInfo(agentB).name}</span
                >
              </div>
            </div>
            {#if topic.trim()}
              <div class="max-w-sm text-center">
                <p
                  class="text-xs uppercase tracking-widest text-[--color-muted] mb-2"
                >
                  Topic
                </p>
                <p
                  class="text-base text-[--color-muted-fg] font-medium leading-snug"
                >
                  "{topic}"
                </p>
              </div>
            {/if}
            <p class="text-sm text-[--color-muted] text-center">
              Hit <span class="text-white font-semibold">Start debate</span> to begin
              · Ctrl+Enter
            </p>
          </div>
        {/if}

        <!-- Messages -->
        {#each messages as msg, i (i)}
          {@const isModerator = msg.agentId === "moderator"}
          {@const isLeft = !isModerator && msg.agentId === leftAgentId}
          {#if isModerator}
            <div
              class="flex flex-col items-center gap-2 px-6 py-6 border-t border-[--color-border-subtle]"
              style="animation: fadeSlide 0.2s ease both; animation-delay: {Math.min(
                i * 20,
                100,
              )}ms"
            >
              <span
                class="text-[10px] font-bold uppercase tracking-widest text-[#ff4b4b] bg-[#ff4b4b]/10 px-3 py-1 rounded-full border border-[#ff4b4b]/20"
                >Moderator Intervened</span
              >
              <p
                class="text-[14.5px] leading-relaxed text-white text-center max-w-[80%] italic"
              >
                "{msg.text}"
              </p>
            </div>
          {:else}
            <div
              class="group flex gap-3 px-6 py-4 border-t border-[--color-border-subtle] {isLeft
                ? ''
                : 'flex-row-reverse'}"
              style="animation: fadeSlide 0.2s ease both; animation-delay: {Math.min(
                i * 20,
                100,
              )}ms"
            >
              <!-- Avatar -->
              <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div
                  class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                  style="background: linear-gradient(135deg, {msg.color}22, {msg.color}0a); color: {msg.color}; border: 1px solid {msg.color}28"
                >
                  {msg.agentName[0]}
                </div>
                <span
                  class="text-[10px] tabular-nums text-[--color-border] group-hover:text-[--color-muted] transition-colors"
                  >#{i + 1}</span
                >
              </div>
              <!-- Bubble -->
              <div
                class="flex flex-col gap-1.5 min-w-0 {isLeft
                  ? 'items-start'
                  : 'items-end'}"
                style="max-width: calc(100% - 3rem)"
              >
                <span
                  class="text-[10px] font-bold uppercase tracking-widest"
                  style="color: {msg.color}">{msg.agentName}</span
                >
                <p
                  class="text-[14.5px] leading-relaxed text-[#d4d4e8] px-4 py-3.5 rounded-2xl {isLeft
                    ? 'rounded-tl-sm border-l-2'
                    : 'rounded-tr-sm border-r-2'}"
                  style="background-color: {msg.color}09; border-color: {msg.color}30; border-top: 1px solid {msg.color}1a; border-bottom: 1px solid {msg.color}1a; {isLeft
                    ? ''
                    : 'border-left: 1px solid ' + msg.color + '1a'}"
                >
                  {msg.text}
                </p>
              </div>
            </div>
          {/if}
        {/each}

        <!-- Live stream / typing indicator -->
        {#if running}
          {#if streamingMessage}
            {@const isLeft = streamingMessage.agentId === leftAgentId}
            <div
              class="flex gap-3 px-6 py-4 border-t border-[--color-border-subtle] {isLeft
                ? ''
                : 'flex-row-reverse'}"
              style="animation: fadeSlide 0.15s ease both"
            >
              <div class="flex-shrink-0 flex flex-col items-center gap-1.5">
                <div
                  class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ring-2 ring-offset-1 ring-offset-[--color-panel] transition-all"
                  style="background: linear-gradient(135deg, {streamingMessage.color}22, {streamingMessage.color}0a); color: {streamingMessage.color}; border: 1px solid {streamingMessage.color}28; ring-color: {streamingMessage.color}"
                >
                  {streamingMessage.agentName[0]}
                </div>
                <span class="text-[10px] tabular-nums text-[--color-muted]"
                  >#{messages.length + 1}</span
                >
              </div>
              <div
                class="flex flex-col gap-1.5 min-w-0 {isLeft
                  ? 'items-start'
                  : 'items-end'}"
                style="max-width: calc(100% - 3rem)"
              >
                <span
                  class="text-[10px] font-bold uppercase tracking-widest"
                  style="color: {streamingMessage.color}"
                  >{streamingMessage.agentName}</span
                >
                <p
                  class="text-[14.5px] leading-relaxed text-[#d4d4e8] px-4 py-3.5 rounded-2xl {isLeft
                    ? 'rounded-tl-sm border-l-2'
                    : 'rounded-tr-sm border-r-2'}"
                  style="background-color: {streamingMessage.color}09; border-color: {streamingMessage.color}30; border-top: 1px solid {streamingMessage.color}1a; border-bottom: 1px solid {streamingMessage.color}1a; {isLeft
                    ? ''
                    : 'border-left: 1px solid ' +
                      streamingMessage.color +
                      '1a'}"
                >
                  {streamingMessage.text}<span
                    class="inline-block w-[2px] h-[1em] ml-[1px] align-text-bottom rounded-sm animate-pulse"
                    style="background: {streamingMessage.color}"
                  ></span>
                </p>
              </div>
            </div>
          {:else}
            <div
              class="flex items-center gap-3 px-6 py-4 {messages.length > 0
                ? 'border-t border-[--color-border-subtle]'
                : ''}"
            >
              {#if typingAgentName}
                <div
                  class="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 ring-1"
                  style="background: {typingAgentColor}15; color: {typingAgentColor}; ring-color: {typingAgentColor}30"
                >
                  {typingAgentName[0]}
                </div>
              {/if}
              <div class="flex gap-1 items-center">
                <span
                  class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
                <span
                  class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:160ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
                <span
                  class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:320ms]"
                  style="background: {typingAgentColor || 'var(--color-muted)'}"
                ></span>
              </div>
              {#if typingAgentName}
                <span
                  class="text-xs text-[--color-muted]"
                  style="color: {typingAgentColor}AA"
                  >{typingAgentName} is thinking…</span
                >
              {/if}
            </div>
          {/if}
        {/if}

        {#if done}
          <div
            class="flex items-center gap-3 px-6 py-4 border-t border-[--color-border-subtle]"
          >
            <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
            <span
              class="text-[11px] uppercase tracking-widest text-[--color-muted]"
              >Debate ended · {messages.filter((m) => m.agentId !== "moderator")
                .length} turns</span
            >
            <div class="flex-1 h-px bg-[--color-border-subtle]"></div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Export -->
    {#if messages.length > 0}
      <div class="flex items-center gap-2">
        <span
          class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] mr-1"
          >Export</span
        >
        <button
          onclick={() => exportDebate("md")}
          class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
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
          onclick={() => exportDebate("txt")}
          class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] hover:text-white text-[--color-muted-fg] text-xs font-medium px-3.5 py-2 rounded-lg transition-all cursor-pointer"
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
        <button
          onclick={resetConversation}
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
    {/if}
</div>

<style>
</style>
