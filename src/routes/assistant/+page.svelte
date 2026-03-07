<script lang="ts">
  import Nav from "$lib/Nav.svelte";

  const MODEL_OPTIONS = [
    {
      group: "Ollama — Cloud",
      options: [
        { id: "deepseek-v3.1:671b-cloud", name: "DeepSeek V3.1", color: "#4B8BF5" },
        { id: "deepseek-v3.2-cloud", name: "DeepSeek V3.2", color: "#3B7BFF" },
        { id: "devstral-small-2:24b-cloud", name: "Devstral Small 2", color: "#FF7000" },
        { id: "kimi-k2:1t-cloud", name: "Kimi K2 1T", color: "#A78BFA" },
      ],
    },
    {
      group: "Gemini",
      options: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", color: "#4285F4" },
        { id: "gemini-3-flash-preview-cloud", name: "Gemini 2.5 Flash", color: "#1A73E8" },
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", color: "#34A853" },
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
    role: "user" | "assistant";
    content: string;
  }

  let selectedModel = $state("gemini-2.0-flash");
  let useSearch = $state(true);
  let input = $state("");
  let messages = $state<ChatMessage[]>([]);
  let streaming = $state(false);
  let streamingText = $state("");
  let errorMsg = $state("");
  let chatEl = $state<HTMLElement | null>(null);
  let abortController = $state<AbortController | null>(null);

  let isGeminiModel = $derived(selectedModel.startsWith("gemini"));
  let modelInfo = $derived(getModelInfo(selectedModel));
  let canSend = $derived(!streaming && input.trim().length > 0);

  function newChat() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    messages = [];
    streaming = false;
    streamingText = "";
    errorMsg = "";
    input = "";
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && canSend) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    input = "";
    errorMsg = "";

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    messages = newMessages;

    streaming = true;
    streamingText = "";
    abortController = new AbortController();

    setTimeout(
      () => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: "smooth" }),
      20,
    );

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModel,
          messages: newMessages,
          useSearch: isGeminiModel && useSearch,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        errorMsg = `Server error: ${response.status}`;
        streaming = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "token") {
            streamingText += data.text;
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              10,
            );
          } else if (data.type === "message") {
            messages = [
              ...messages,
              { role: "assistant", content: data.text },
            ];
            streamingText = "";
            streaming = false;
            setTimeout(
              () =>
                chatEl?.scrollTo({
                  top: chatEl.scrollHeight,
                  behavior: "smooth",
                }),
              50,
            );
          } else if (data.type === "error") {
            errorMsg = data.message || "An error occurred.";
            streamingText = "";
            streaming = false;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        errorMsg = `Connection error: ${String(err)}`;
      }
    } finally {
      streaming = false;
      streamingText = "";
    }
  }
</script>

<div class="w-full max-w-2xl flex flex-col gap-6">
  <!-- Header -->
  <header class="text-center flex flex-col items-center gap-2">
    <div class="relative">
      <div
        class="absolute inset-0 blur-2xl opacity-30 bg-[#4285F4] rounded-full scale-150"
      ></div>
      <h1
        class="relative font-display text-5xl sm:text-6xl font-bold tracking-tight"
      >
        <span class="text-white">AI </span><span
          class="text-transparent bg-clip-text bg-gradient-to-r from-[#4285F4] to-[#c084fc]"
          >Ask</span
        >
      </h1>
    </div>
    <p class="text-sm text-[--color-muted] tracking-wide">
      ask anything · get accurate answers
    </p>
    <Nav />
  </header>

  <!-- Settings bar -->
  <div
    class="flex items-center gap-3 flex-wrap bg-[--color-panel] border border-[--color-border] rounded-2xl px-4 py-3"
  >
    <!-- Model dot + select -->
    <div class="flex items-center gap-2 flex-1 min-w-[160px]">
      <span
        class="w-2 h-2 rounded-full flex-shrink-0"
        style="background: {modelInfo.color}"
      ></span>
      <select
        bind:value={selectedModel}
        disabled={streaming}
        class="flex-1 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-2 text-sm text-white outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-left: 2px solid {modelInfo.color}"
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

    <!-- Web search toggle (Gemini only) -->
    {#if isGeminiModel}
      <button
        type="button"
        onclick={() => (useSearch = !useSearch)}
        disabled={streaming}
        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border transition-all cursor-pointer disabled:opacity-40 {useSearch
          ? 'border-[#4285F4] text-[#4285F4] bg-[#4285F4]/8'
          : 'border-[--color-border] text-[--color-muted] hover:border-[--color-muted] bg-[--color-surface]'}"
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
            d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
          />
        </svg>
        Web Search
      </button>
    {/if}

    <!-- New chat -->
    {#if messages.length > 0 || streaming}
      <button
        type="button"
        onclick={newChat}
        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border border-[--color-border] text-[--color-muted] hover:text-white hover:border-[--color-muted] bg-[--color-surface] transition-all cursor-pointer"
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
            d="M12 4v16m8-8H4"
          />
        </svg>
        New Chat
      </button>
    {/if}
  </div>

  <!-- Chat area -->
  <div
    bind:this={chatEl}
    class="flex flex-col rounded-2xl border border-[--color-border] bg-[--color-panel] overflow-y-auto scroll-smooth"
    style="min-height: 22rem; max-height: 62vh"
  >
    <!-- Empty state -->
    {#if messages.length === 0 && !streaming}
      <div
        class="flex flex-col items-center justify-center gap-5 flex-1 py-16 px-6 text-center"
      >
        <div
          class="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
          style="background: {modelInfo.color}15; border: 1px solid {modelInfo.color}30; color: {modelInfo.color}"
        >
          🤖
        </div>
        <div class="flex flex-col gap-1.5">
          <p class="text-base text-[--color-muted-fg] font-semibold">
            {modelInfo.name}
          </p>
          <p class="text-sm text-[--color-muted] max-w-xs leading-relaxed">
            Ask me anything — science, history, math, philosophy, technology,
            or whatever's on your mind.
          </p>
          {#if isGeminiModel && useSearch}
            <p
              class="text-xs mt-1 flex items-center justify-center gap-1"
              style="color: {modelInfo.color}"
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
                  d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
                />
              </svg>
              Web search enabled — answers grounded in live results
            </p>
          {/if}
        </div>
        <p class="text-xs text-[--color-muted]">
          <span class="text-white font-semibold">Enter</span> to send ·
          <span class="text-white font-semibold">Shift+Enter</span> for newline
        </p>
      </div>
    {/if}

    <!-- Messages -->
    {#each messages as msg, i (i)}
      {#if msg.role === "user"}
        <!-- User message -->
        <div
          class="flex justify-end px-5 py-4 border-t border-[--color-border-subtle]"
          style="animation: fadeSlide 0.15s ease both"
        >
          <div
            class="flex flex-col gap-1.5 items-end"
            style="max-width: calc(100% - 1rem)"
          >
            <span
              class="text-[10px] font-bold uppercase tracking-widest text-[--color-muted]"
              >You</span
            >
            <p
              class="text-[14.5px] leading-relaxed text-white px-4 py-3 rounded-2xl rounded-tr-sm whitespace-pre-wrap"
              style="background: #7c6af715; border: 1px solid #7c6af730;"
            >
              {msg.content}
            </p>
          </div>
        </div>
      {:else}
        <!-- Assistant message -->
        <div
          class="flex gap-3 px-5 py-4 border-t border-[--color-border-subtle]"
          style="animation: fadeSlide 0.15s ease both"
        >
          <div class="flex-shrink-0">
            <div
              class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
              style="background: {modelInfo.color}22; color: {modelInfo.color}; border: 1px solid {modelInfo.color}28"
            >
              {modelInfo.name[0]}
            </div>
          </div>
          <div class="flex flex-col gap-1.5 min-w-0 flex-1">
            <span
              class="text-[10px] font-bold uppercase tracking-widest"
              style="color: {modelInfo.color}">{modelInfo.name}</span
            >
            <div
              class="text-[14.5px] leading-relaxed text-[#d4d4e8] whitespace-pre-wrap prose-response"
            >
              {msg.content}
            </div>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Streaming message -->
    {#if streaming}
      <div
        class="flex gap-3 px-5 py-4 border-t border-[--color-border-subtle]"
        style="animation: fadeSlide 0.15s ease both"
      >
        <div class="flex-shrink-0">
          <div
            class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
            style="background: {modelInfo.color}22; color: {modelInfo.color}; border: 1px solid {modelInfo.color}40; box-shadow: 0 0 8px {modelInfo.color}30"
          >
            {modelInfo.name[0]}
          </div>
        </div>
        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
          <span
            class="text-[10px] font-bold uppercase tracking-widest"
            style="color: {modelInfo.color}">{modelInfo.name}</span
          >
          {#if streamingText}
            <p
              class="text-[14.5px] leading-relaxed text-[#d4d4e8] whitespace-pre-wrap"
            >
              {streamingText}<span
                class="inline-block w-[2px] h-[1em] ml-[1px] align-text-bottom rounded-sm animate-pulse"
                style="background: {modelInfo.color}"
              ></span>
            </p>
          {:else}
            <div class="flex gap-1 items-center pt-1">
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]"
                style="background: {modelInfo.color}"
              ></span>
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:160ms]"
                style="background: {modelInfo.color}"
              ></span>
              <span
                class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:320ms]"
                style="background: {modelInfo.color}"
              ></span>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Error -->
    {#if errorMsg}
      <div
        class="flex items-start gap-3 mx-5 my-3 bg-red-950/50 border border-red-900/50 rounded-xl px-4 py-3 text-sm text-red-400"
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

  <!-- Input area -->
  <div
    class="flex gap-3 items-end bg-[--color-panel] border border-[--color-border] rounded-2xl p-3 transition-all focus-within:border-[--color-accent] focus-within:shadow-[0_0_0_3px_#7c6af718]"
  >
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:value={input}
      onkeydown={onKeydown}
      placeholder="Ask anything…"
      disabled={streaming}
      autofocus
      rows={1}
      class="flex-1 bg-transparent text-base text-white placeholder:text-[--color-muted] outline-none resize-none disabled:opacity-40"
      style="field-sizing: content; max-height: 10rem; min-height: 1.5rem"
    ></textarea>
    <button
      type="button"
      onclick={sendMessage}
      disabled={!canSend}
      class="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-30 disabled:cursor-not-allowed text-white transition-all cursor-pointer shadow-[0_0_16px_#7c6af740]"
      title="Send (Enter)"
    >
      <svg
        class="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 19V5m-7 7 7-7 7 7"
        />
      </svg>
    </button>
  </div>
</div>

<style>
  @keyframes fadeSlide {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>