<script lang="ts">
  import AgentSelector from "./AgentSelector.svelte";
  import ContextFileUpload from "./ContextFileUpload.svelte";
  import { MODEL_OPTIONS, getModelInfo, type ContextFile } from "$lib/debate/models";

  interface Props {
    topic: string;
    turns: number;
    agentA: string;
    agentB: string;
    contextFiles: ContextFile[];
    docAnalysisMode: boolean;
    documentText: string;
    running: boolean;
    isPaused: boolean;
    errorMsg: string;
    onstart: () => void;
    onresume: () => void;
    onpause: () => void;
    onstop: () => void;
    onmoderatormessage: (text: string) => void;
  }

  let {
    topic = $bindable(),
    turns = $bindable(),
    agentA = $bindable(),
    agentB = $bindable(),
    contextFiles = $bindable(),
    docAnalysisMode = $bindable(),
    documentText = $bindable(),
    running,
    isPaused,
    errorMsg,
    onstart,
    onresume,
    onpause,
    onstop,
    onmoderatormessage,
  }: Props = $props();

  let showFiles = $state(false);
  let moderatorInput = $state("");
  let uploadError = $state("");
  let uploading = $state(false);

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // reset so same file can be re-selected
    if (!file) return;

    uploadError = "";
    uploading = true;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-document", { method: "POST", body: fd });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        uploadError = msg || `Error ${res.status}`;
        return;
      }
      const data = await res.json();
      documentText = data.text as string;
    } catch {
      uploadError = "Upload failed — please try again.";
    } finally {
      uploading = false;
    }
  }

  function onTopicKeydown(e: KeyboardEvent) {
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      !running &&
      !isPaused &&
      (topic.trim() || docAnalysisMode)
    ) {
      e.preventDefault();
      onstart();
    }
  }

  function onModeratorKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && moderatorInput.trim()) {
      e.preventDefault();
      const text = moderatorInput.trim();
      moderatorInput = "";
      onmoderatormessage(text);
    }
  }
</script>

<div
  class="flex flex-col bg-[--color-panel] border border-[--color-border] rounded-2xl {running ? 'gap-0 p-3 sm:p-4' : 'gap-6 p-4 sm:p-7'}"
>
  {#if running}
    <!-- Compact running bar: topic summary + controls -->
    <div class="flex items-center gap-3 min-w-0">
      <span class="text-[10px] font-bold uppercase tracking-widest text-[--color-muted] shrink-0">
        {docAnalysisMode ? 'Analysing' : 'Debating'}
      </span>
      {#if topic}
        <span class="text-sm text-[--color-muted-fg] truncate min-w-0">"{topic}"</span>
      {/if}
      <div class="ml-auto flex items-center gap-2 shrink-0">
        <button
          type="button"
          onclick={onpause}
          class="flex items-center gap-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/30 font-semibold text-sm px-4 py-1.5 rounded-xl transition-all cursor-pointer"
        >Pause</button>
        <button
          type="button"
          onclick={onstop}
          class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-4 py-1.5 rounded-xl transition-all cursor-pointer"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
          Stop
        </button>
      </div>
    </div>
  {:else}
  <!-- Topic -->
  <div class="flex flex-col gap-1.5">
    <label
      for="topic"
      class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]"
      >{docAnalysisMode ? 'Focus (optional)' : 'Topic'}</label
    >
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="topic"
      type="text"
      bind:value={topic}
      onkeydown={onTopicKeydown}
      placeholder={docAnalysisMode ? "What aspect to focus on? (leave blank to analyse all claims)" : "What should they debate?"}
      disabled={running}
      autofocus
      class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-4 text-base text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] disabled:opacity-40 disabled:cursor-not-allowed"
    />
  </div>

  {#if !docAnalysisMode}
    <!-- Agents row -->
    <AgentSelector bind:agentA bind:agentB {running} />
  {:else}
    <!-- Doc mode: only the auditor (Agent B) model is selectable -->
    <div class="flex flex-col gap-1.5">
      <label
        for="auditorModel"
        class="text-[11px] font-semibold uppercase tracking-widest flex items-center gap-1.5"
        style="color: {getModelInfo(agentB).color}"
      >
        <span
          class="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style="background: {getModelInfo(agentB).color}"
        ></span>
        Auditor model
      </label>
      <select
        id="auditorModel"
        bind:value={agentB}
        disabled={running}
        class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-[#ef4444] disabled:opacity-40 disabled:cursor-not-allowed"
        style="border-left: 2px solid {getModelInfo(agentB).color}"
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
  {/if}

  {#if docAnalysisMode}
    <!-- Document paste area -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <label
          for="documentText"
          class="text-[11px] font-semibold uppercase tracking-widest text-[#ef4444]"
          >Document</label
        >
        <!-- File upload button -->
        <label
          class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all cursor-pointer
            {uploading ? 'opacity-40 pointer-events-none' : ''}
            {running ? 'opacity-40 pointer-events-none' : ''}
            border-[#ef4444]/40 text-[#ef4444] hover:bg-[#ef4444]/10"
          title="Upload .txt, .md, .pdf, .doc or .docx"
        >
          {#if uploading}
            <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
            Loading…
          {:else}
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload file
          {/if}
          <input
            type="file"
            accept=".txt,.md,.pdf,.doc,.docx"
            class="sr-only"
            disabled={running || uploading}
            onchange={handleFileUpload}
          />
        </label>
      </div>
      {#if uploadError}
        <p class="text-xs text-red-400">{uploadError}</p>
      {/if}
      <textarea
        id="documentText"
        bind:value={documentText}
        placeholder="Paste your document here, or upload a file — articles, reports, policy papers, opinion pieces..."
        rows="8"
        disabled={running}
        class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[#ef4444] focus:shadow-[0_0_0_3px_#ef444422] disabled:opacity-40 disabled:cursor-not-allowed resize-y"
      ></textarea>
    </div>
  {/if}

  <!-- Bottom row: turns + context toggle + actions -->
  <div class="flex items-center gap-3 flex-wrap">
  {#if !docAnalysisMode}
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
  {/if}

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

    <button
      type="button"
      onclick={() => {
        docAnalysisMode = !docAnalysisMode;
      }}
      disabled={running}
      class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3 py-2 rounded-xl border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
{docAnalysisMode
        ? 'border-[#ef4444] text-[#ef4444] bg-[#ef4444]/5'
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
          d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
        />
      </svg>
      BS Detect
    </button>

    {#if isPaused}
      <button
        type="button"
        onclick={onresume}
        class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
        >Resume debate</button
      >
      <button
        type="button"
        onclick={onstop}
        class="flex items-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-sm px-5 py-2.5 rounded-xl transition-all cursor-pointer"
      >
        Stop
      </button>
    {:else}
      <button
        type="button"
        onclick={() => {
          if (!running && (topic.trim() || docAnalysisMode)) onstart();
        }}
        disabled={!topic.trim() && !docAnalysisMode}
        class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-7 py-2.5 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
        >{docAnalysisMode ? 'Analyse' : 'Start debate'}</button
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
      <ContextFileUpload bind:contextFiles {running} />
    </div>
  {/if}
  {/if}<!-- end {#if running} {:else} -->
</div>
