<script lang="ts">
  import type { ContextFile } from "$lib/debate/models";

  const MAX_FILE_BYTES = 80_000;
  const ACCEPTED = ".txt,.md,.csv,.json";

  interface Props {
    contextFiles: ContextFile[];
    running: boolean;
  }

  let { contextFiles = $bindable([]), running }: Props = $props();

  let dragging = $state(false);
  let fileError = $state("");

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
</script>

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
    >Drop files or <span class="text-[--color-accent]">browse</span></span
  >
  <span class="text-xs text-[--color-muted]">.txt · .md · .csv · .json · 80 KB max</span>
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
        <span class="text-xs text-[--color-muted-fg] max-w-[140px] truncate"
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
