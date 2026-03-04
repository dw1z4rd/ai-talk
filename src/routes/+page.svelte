<script lang="ts">
	interface ChatMessage {
		agentId: 'gemini' | 'claude';
		agentName: string;
		color: string;
		text: string;
	}

	interface ContextFile {
		name: string;
		content: string;
	}

	const MAX_FILE_BYTES = 80_000; // ~80 KB per file
	const ACCEPTED = '.txt,.md,.csv,.json';

	let topic = $state('Is free will an illusion?');
	let turns = $state(12);
	let messages = $state<ChatMessage[]>([]);
	let running = $state(false);
	let done = $state(false);
	let errorMsg = $state('');
	let chatEl = $state<HTMLElement | null>(null);
	let abortController = $state<AbortController | null>(null);

	// Files
	let contextFiles = $state<ContextFile[]>([]);
	let dragging = $state(false);
	let fileError = $state('');

	function buildContext(): string | undefined {
		if (contextFiles.length === 0) return undefined;
		return contextFiles
			.map((f) => `--- ${f.name} ---\n${f.content}`)
			.join('\n\n');
	}

	async function readFile(file: File): Promise<void> {
		if (contextFiles.find((f) => f.name === file.name)) return;
		if (file.size > MAX_FILE_BYTES) {
			fileError = `"${file.name}" is too large (max 80 KB).`;
			return;
		}
		const content = await file.text();
		contextFiles = [...contextFiles, { name: file.name, content }];
		fileError = '';
	}

	async function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		for (const file of Array.from(input.files ?? [])) await readFile(file);
		input.value = '';
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragging = false;
		for (const file of Array.from(e.dataTransfer?.files ?? [])) await readFile(file);
	}

	function removeFile(name: string) {
		contextFiles = contextFiles.filter((f) => f.name !== name);
	}

	function exportDebate(format: 'md' | 'txt') {
		const date = new Date().toISOString().slice(0, 10);
		const safeTitle = topic.slice(0, 60).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

		let content: string;
		let mime: string;
		let ext: string;

		if (format === 'md') {
			content = `# Debate: ${topic}\n\n_Exported ${date}_\n\n---\n\n`;
			content += messages.map((m) => `### ${m.agentName}\n\n${m.text}`).join('\n\n---\n\n');
			mime = 'text/markdown';
			ext = 'md';
		} else {
			content = `DEBATE: ${topic}\nExported: ${date}\n${'─'.repeat(40)}\n\n`;
			content += messages.map((m) => `[${m.agentName}]\n${m.text}`).join('\n\n');
			mime = 'text/plain';
			ext = 'txt';
		}

		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `debate-${safeTitle}.${ext}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function stopConversation() {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		running = false;
		done = true;
	}

	async function startConversation() {
		messages = [];
		done = false;
		errorMsg = '';
		running = true;
		abortController = new AbortController();

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ topic, turns, context: buildContext() }),
				signal: abortController.signal
			});

			if (!response.ok || !response.body) {
				errorMsg = `Server error: ${response.status}`;
				running = false;
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done: streamDone, value } = await reader.read();
				if (streamDone) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse complete SSE events (delimited by \n\n)
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';

				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data: ')) continue;
					const data = JSON.parse(line.slice(6));

					if (data.type === 'message') {
						messages = [...messages, {
							agentId: data.agentId,
							agentName: data.agentName,
							color: data.color,
							text: data.text
						}];
						setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 50);
					} else if (data.type === 'done') {
						done = true;
						running = false;
					} else if (data.type === 'error') {
						errorMsg = data.message || 'An AI failed to respond.';
						running = false;
					}
				}
			}
		} catch (err: any) {
			if (err.name === 'AbortError') {
				// User manually stopped the conversation
			} else {
				errorMsg = `Connection error: ${String(err)}`;
			}
		} finally {
			running = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="min-h-dvh flex flex-col items-center px-4 py-12 sm:py-16"
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => e.preventDefault()}
>
	<div class="w-full max-w-2xl flex flex-col gap-8">

		<!-- Header -->
		<header class="text-center flex flex-col items-center gap-2">
			<h1 class="font-display text-5xl font-bold tracking-tight">
				<span class="text-white">ai</span><span
					class="text-transparent bg-clip-text bg-linear-to-r from-[#7c6af7] to-[#a78bfa]">talk</span>
			</h1>
			<p class="text-sm text-[--color-muted-fg] tracking-wide">
				Gemini vs Claude — live AI debate
			</p>
		</header>

		<!-- Controls -->
		<div class="flex flex-col gap-3">
			<form onsubmit={(e) => { e.preventDefault(); startConversation(); }} class="flex gap-2 items-end">
				<div class="flex flex-col gap-1.5 flex-1">
					<label for="topic" class="text-[10px] font-semibold uppercase tracking-widest text-[--color-muted]">
						Topic
					</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="topic"
						type="text"
						bind:value={topic}
						placeholder="What should they debate?"
						disabled={running}
						autofocus
						class="w-full bg-[--color-panel] border border-[--color-border] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-[--color-muted] outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
					/>
				</div>
				<div class="flex flex-col gap-1.5 w-20">
					<label for="turns" class="text-[10px] font-semibold uppercase tracking-widest text-[--color-muted]">
						Turns
					</label>
					<input
						id="turns"
						type="number"
						bind:value={turns}
						min="2"
						max="30"
						disabled={running}
						class="w-full bg-[--color-panel] border border-[--color-border] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
					/>
				</div>
				{#if running}
					<button
						type="button"
						onclick={stopConversation}
						class="bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
					>
						Stop
					</button>
				{:else}
					<button
						type="submit"
						class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
					>
						Start
					</button>
				{/if}
			</form>

			{#if errorMsg}
				<div class="bg-red-950/60 border border-red-900/60 rounded-lg px-4 py-3 text-sm text-red-400">
					{errorMsg}
				</div>
			{/if}
		</div>

		<!-- Context files -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<span class="text-[10px] font-semibold uppercase tracking-widest text-[--color-muted]">
					Context files
				</span>
				<span class="text-[10px] text-[--color-muted]">.txt · .md · .csv · .json · max 80 KB each</span>
			</div>

			<!-- Drop zone -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<label
				for="file-input"
				class="relative flex flex-col items-center justify-center gap-2 border border-dashed rounded-xl px-6 py-5 cursor-pointer transition-colors
					{dragging
						? 'border-[--color-accent] bg-[#7c6af7]/5'
						: 'border-[--color-border] hover:border-[--color-muted] bg-[--color-panel]'}"
				ondragover={(e) => { e.preventDefault(); dragging = true; }}
				ondragleave={() => { dragging = false; }}
				ondrop={onDrop}
			>
				<svg class="w-5 h-5 text-[--color-muted]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
						d="M12 16v-8m0 0-3 3m3-3 3 3M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
				</svg>
				<span class="text-xs text-[--color-muted-fg]">
					Drop files here or <span class="text-[--color-accent]">browse</span>
				</span>
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

			{#if fileError}
				<p class="text-xs text-red-400">{fileError}</p>
			{/if}

			<!-- File chips -->
			{#if contextFiles.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each contextFiles as file (file.name)}
						<div class="flex items-center gap-2 bg-[--color-panel] border border-[--color-border] rounded-lg pl-3 pr-2 py-1.5">
							<svg class="w-3.5 h-3.5 text-[--color-accent] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
							</svg>
							<span class="text-xs text-[--color-muted-fg] max-w-[160px] truncate">{file.name}</span>
							<span class="text-[10px] text-[--color-muted]">
								{(file.content.length / 1024).toFixed(1)} KB
							</span>
							<button
								onclick={() => removeFile(file.name)}
								disabled={running}
								class="text-[--color-muted] hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer ml-0.5"
								aria-label="Remove {file.name}"
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Chat -->
		<div
			bind:this={chatEl}
			class="flex flex-col gap-0 bg-[--color-panel] border border-[--color-border] rounded-2xl overflow-y-auto min-h-72 max-h-[68vh] scroll-smooth"
		>
			{#if messages.length === 0 && !running}
				<div class="flex flex-col items-center justify-center gap-6 flex-1 py-16 px-6">
					<div class="flex items-center gap-5">
						<div class="flex flex-col items-center gap-1.5">
							<div class="w-10 h-10 rounded-full bg-[--color-gemini-dim] flex items-center justify-center">
								<span class="text-[--color-gemini] text-lg font-bold">G</span>
							</div>
							<span class="text-xs font-semibold text-[--color-gemini] tracking-wide">Gemini</span>
						</div>
						<span class="text-xl font-light text-[--color-muted]">vs</span>
						<div class="flex flex-col items-center gap-1.5">
							<div class="w-10 h-10 rounded-full bg-[--color-claude-dim] flex items-center justify-center">
								<span class="text-[--color-claude] text-lg font-bold">C</span>
							</div>
							<span class="text-xs font-semibold text-[--color-claude] tracking-wide">Claude</span>
						</div>
					</div>
					<p class="text-sm text-[--color-muted] text-center">
						Set a topic and hit <span class="text-white font-medium">Start</span> to watch them argue.
					</p>
				</div>
			{/if}

			{#each messages as msg, i (i)}
				{@const isGemini = msg.agentId === 'gemini'}
				<div
					class="flex gap-3 px-5 py-4 {i > 0 ? 'border-t border-[--color-border-subtle]' : ''} {isGemini ? 'flex-row' : 'flex-row-reverse'}"
					style="animation: fadeSlide 0.2s ease both"
				>
					<div
						class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mt-0.5"
						style="background-color: {isGemini ? 'var(--color-gemini-dim)' : 'var(--color-claude-dim)'}; color: {isGemini ? 'var(--color-gemini)' : 'var(--color-claude)'}"
					>
						{isGemini ? 'G' : 'C'}
					</div>
					<div class="flex flex-col gap-1 max-w-[82%] {isGemini ? 'items-start' : 'items-end'}">
						<span
							class="text-[10px] font-semibold uppercase tracking-widest"
							style="color: {isGemini ? 'var(--color-gemini)' : 'var(--color-claude)'}"
						>
							{msg.agentName}
						</span>
						<p
							class="text-sm leading-relaxed text-[#d4d4e0] {isGemini ? 'border-l-2 pl-3' : 'border-r-2 pr-3 text-right'}"
							style="border-color: {isGemini ? 'var(--color-gemini)' : 'var(--color-claude)'}"
						>
							{msg.text}
						</p>
					</div>
				</div>
			{/each}

			{#if running}
				<div class="flex gap-1.5 px-6 py-4 {messages.length > 0 ? 'border-t border-[--color-border-subtle]' : ''}">
					<span class="w-1.5 h-1.5 rounded-full bg-[--color-muted] animate-bounce [animation-delay:0ms]"></span>
					<span class="w-1.5 h-1.5 rounded-full bg-[--color-muted] animate-bounce [animation-delay:150ms]"></span>
					<span class="w-1.5 h-1.5 rounded-full bg-[--color-muted] animate-bounce [animation-delay:300ms]"></span>
				</div>
			{/if}

			{#if done}
				<div class="text-center text-[10px] tracking-widest text-[--color-muted] py-4 border-t border-[--color-border-subtle]">
					— debate ended —
				</div>
			{/if}
		</div>

		<!-- Export -->
		{#if messages.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-[10px] font-semibold uppercase tracking-widest text-[--color-muted] mr-1">Export</span>
				<button
					onclick={() => exportDebate('md')}
					class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] text-[--color-muted-fg] hover:text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
				>
					<span class="opacity-70">↓</span> Markdown
				</button>
				<button
					onclick={() => exportDebate('txt')}
					class="flex items-center gap-1.5 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] text-[--color-muted-fg] hover:text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
				>
					<span class="opacity-70">↓</span> Plain text
				</button>
			</div>
		{/if}

	</div>
</div>

<style>
	@keyframes fadeSlide {
		from { opacity: 0; transform: translateY(5px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>
