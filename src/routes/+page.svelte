<script lang="ts">

	const MODEL_OPTIONS = [
		{ group: 'Ollama — Cloud', options: [
			{ id: 'deepseek-v3.1:671b-cloud', name: 'DeepSeek V3.1', color: '#4B8BF5' },
			{ id: 'llama3.3:70b-cloud', name: 'Llama 3.3 70B', color: '#8B5CF6' },
			{ id: 'qwq:32b-cloud', name: 'QwQ 32B', color: '#06B6D4' },
			{ id: 'phi4:14b-cloud', name: 'Phi-4 14B', color: '#10B981' },
		]},
		{ group: 'Ollama — Local', options: [
			{ id: 'llama3.2', name: 'Llama 3.2 3B', color: '#A78BFA' },
			{ id: 'mistral', name: 'Mistral 7B', color: '#F59E0B' },
			{ id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', color: '#34D399' },
		]},
		{ group: 'Gemini', options: [
			{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', color: '#4285F4' },
			{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', color: '#34A853' },
		]},
		{ group: 'Claude', options: [
			{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', color: '#D97706' },
			{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', color: '#B45309' },
		]},
	];

	function getModelInfo(id: string) {
		for (const group of MODEL_OPTIONS) {
			const found = group.options.find((o) => o.id === id);
			if (found) return found;
		}
		return { id, name: id, color: '#7c6af7' };
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
	const ACCEPTED = '.txt,.md,.csv,.json';

	let topic = $state('Is free will an illusion?');
	let turns = $state(20);
	let messages = $state<ChatMessage[]>([]);
	let running = $state(false);
	let done = $state(false);
	let errorMsg = $state('');
	let chatEl = $state<HTMLElement | null>(null);
	let abortController = $state<AbortController | null>(null);
	let agentA = $state('deepseek-v3.1:671b-cloud');
	let agentB = $state('llama3.3:70b-cloud');
	let leftAgentId = $state('deepseek-v3.1:671b-cloud');
	let typingAgentName = $state('');
	let typingAgentColor = $state('');
	let streamingMessage = $state<ChatMessage | null>(null);

	// Files
	let contextFiles = $state<ContextFile[]>([]);
	let dragging = $state(false);
	let fileError = $state('');

	// Derived progress
	let progress = $derived(turns > 0 ? Math.min((messages.length / turns) * 100, 100) : 0);

	function swapAgents() {
		[agentA, agentB] = [agentB, agentA];
	}

	function resetConversation() {
		messages = [];
		done = false;
		errorMsg = '';
	}

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
		typingAgentName = '';
		streamingMessage = null;
	}

	function onTopicKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running && topic.trim()) {
			e.preventDefault();
			startConversation();
		}
	}

	async function startConversation() {
		messages = [];
		done = false;
		errorMsg = '';
		running = true;
		typingAgentName = '';
		typingAgentColor = '';
		streamingMessage = null;
		leftAgentId = agentA;
		abortController = new AbortController();

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ topic, turns, context: buildContext(), agentA, agentB }),
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

				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';

				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data: ')) continue;
					const data = JSON.parse(line.slice(6));

					if (data.type === 'token') {
						if (!streamingMessage) {
							// First token — create the streaming bubble and hide typing dots
							streamingMessage = { agentId: data.agentId, agentName: data.agentName, color: data.color, text: data.text };
							typingAgentName = '';
							typingAgentColor = '';
						} else {
							const cur = streamingMessage!;
							streamingMessage = { agentId: cur.agentId, agentName: cur.agentName, color: cur.color, text: cur.text + data.text };
						}
						setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 20);
					} else if (data.type === 'message') {
						streamingMessage = null;
						typingAgentName = '';
						typingAgentColor = '';
						messages = [...messages, {
							agentId: data.agentId,
							agentName: data.agentName,
							color: data.color,
							text: data.text
						}];
						// Set the next typing agent
						if (messages.length < turns) {
							const nextId = data.agentId === agentA ? agentB : agentA;
							const next = getModelInfo(nextId);
							typingAgentName = next.name;
							typingAgentColor = next.color;
						}
						setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 50);
					} else if (data.type === 'done') {
						done = true;
						running = false;
						typingAgentName = '';
					} else if (data.type === 'error') {
						errorMsg = data.message || 'An AI failed to respond.';
						running = false;
						typingAgentName = '';
					}
				}
			}
		} catch (err: any) {
			if (err.name === 'AbortError') {
				// User manually stopped
			} else {
				errorMsg = `Connection error: ${String(err)}`;
			}
			} finally {
				running = false;
				typingAgentName = '';
				streamingMessage = null;
			}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="min-h-dvh flex flex-col items-center px-6 py-16 sm:py-20"
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => e.preventDefault()}
>
	<div class="w-full max-w-3xl flex flex-col gap-10">

		<!-- Header -->
		<header class="text-center flex flex-col items-center gap-3">
			<h1 class="font-display text-6xl font-bold tracking-tight">
				<span class="text-white">ai</span><span
					class="text-transparent bg-clip-text bg-linear-to-r from-[#7c6af7] to-[#a78bfa]">talk</span>
			</h1>
			<p class="text-base text-[--color-muted-fg]">watch two AIs argue</p>
			<div class="h-px w-20 bg-linear-to-r from-transparent via-[#7c6af7]/50 to-transparent mt-1"></div>
		</header>

		<!-- Setup -->
		<div class="flex flex-col gap-6 bg-[--color-panel] border border-[--color-border] rounded-2xl p-8">

			<!-- Topic -->
			<div class="flex flex-col gap-2">
				<label for="topic" class="text-xs font-semibold uppercase tracking-widest text-[--color-muted]">Topic</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="topic"
					type="text"
					bind:value={topic}
					onkeydown={onTopicKeydown}
					placeholder="What should they debate?"
					disabled={running}
					autofocus
					class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-5 py-5 text-lg text-white placeholder:text-[--color-muted] outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
				/>
			</div>

			<!-- Agents -->
			<div class="grid grid-cols-[1fr_44px_1fr] items-end gap-3">
				<div class="flex flex-col gap-2">
					<label for="agentA" class="text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5" style="color: {getModelInfo(agentA).color}">
						● Agent A
					</label>
					<select
						id="agentA"
						bind:value={agentA}
						disabled={running}
						class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3.5 text-base text-white outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
						style="border-left: 3px solid {getModelInfo(agentA).color}"
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
					class="h-[50px] flex items-center justify-center rounded-xl bg-[--color-surface] border border-[--color-border] hover:border-[--color-accent] text-[--color-muted] hover:text-white text-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
				>⇄</button>

				<div class="flex flex-col gap-2">
					<label for="agentB" class="text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5" style="color: {getModelInfo(agentB).color}">
						● Agent B
					</label>
					<select
						id="agentB"
						bind:value={agentB}
						disabled={running}
						class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3.5 text-base text-white outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
						style="border-right: 3px solid {getModelInfo(agentB).color}"
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

			<!-- Turns + Submit -->
			<div class="flex items-center gap-4 pt-2">
				<label for="turns" class="text-xs font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap">Turns</label>
				<input
					id="turns"
					type="number"
					bind:value={turns}
					min="2"
					max="30"
					disabled={running}
					class="w-20 bg-[--color-surface] border border-[--color-border] rounded-xl px-3 py-3 text-base text-white outline-none transition-colors focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed text-center"
				/>
				<div class="flex-1"></div>
				{#if running}
					<button
						type="button"
						onclick={stopConversation}
						class="bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 font-semibold text-base px-8 py-3 rounded-xl transition-colors cursor-pointer"
					>Stop</button>
				{:else}
					<button
						type="button"
						onclick={() => { if (!running && topic.trim()) startConversation(); }}
						disabled={!topic.trim()}
						class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base px-10 py-3 rounded-xl transition-colors cursor-pointer shadow-[0_0_28px_#7c6af755]"
					>Start debate</button>
				{/if}
			</div>

			{#if errorMsg}
				<div class="bg-red-950/60 border border-red-900/60 rounded-xl px-5 py-3 text-sm text-red-400">{errorMsg}</div>
			{/if}
		</div>

		<!-- Context files -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold uppercase tracking-widest text-[--color-muted]">Context files</span>
				<span class="text-xs text-[--color-muted]">.txt · .md · .csv · .json · max 80 KB each</span>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<label
				for="file-input"
				class="flex items-center justify-center gap-3 border border-dashed rounded-xl px-6 py-4 cursor-pointer transition-colors
					{dragging ? 'border-[--color-accent] bg-[#7c6af7]/5' : 'border-[--color-border] hover:border-[--color-muted] bg-[--color-panel]'}"
				ondragover={(e) => { e.preventDefault(); dragging = true; }}
				ondragleave={() => { dragging = false; }}
				ondrop={onDrop}
			>
				<svg class="w-4 h-4 text-[--color-muted] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 16v-8m0 0-3 3m3-3 3 3M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
				</svg>
				<span class="text-sm text-[--color-muted-fg]">Drop files here or <span class="text-[--color-accent]">browse</span></span>
				<input id="file-input" type="file" accept={ACCEPTED} multiple class="sr-only" onchange={onFileInput} disabled={running} />
			</label>
			{#if fileError}<p class="text-xs text-red-400">{fileError}</p>{/if}
			{#if contextFiles.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each contextFiles as file (file.name)}
						<div class="flex items-center gap-2 bg-[--color-panel] border border-[--color-border] rounded-lg pl-3 pr-2 py-1.5">
							<span class="text-xs text-[--color-muted-fg] max-w-[160px] truncate">{file.name}</span>
							<span class="text-[10px] text-[--color-muted]">{(file.content.length / 1024).toFixed(1)} KB</span>
							<button onclick={() => removeFile(file.name)} disabled={running} class="text-[--color-muted] hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer" aria-label="Remove {file.name}">
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Progress -->
		{#if running || (done && messages.length > 0)}
			<div class="flex flex-col gap-2">
				<div class="flex justify-between items-center">
					<span class="text-xs font-semibold uppercase tracking-widest text-[--color-muted]">Progress</span>
					<span class="text-xs text-[--color-muted]">{messages.length} / {turns} turns</span>
				</div>
				<div class="h-1.5 bg-[--color-border] rounded-full overflow-hidden">
					<div class="h-full rounded-full transition-all duration-500" style="width: {progress}%; background: linear-gradient(to right, #7c6af7, #a78bfa)"></div>
				</div>
			</div>
		{/if}

		<!-- Chat -->
		<div
			bind:this={chatEl}
			class="flex flex-col bg-[--color-panel] border border-[--color-border] rounded-2xl overflow-y-auto min-h-96 max-h-[72vh] scroll-smooth"
		>
			{#if messages.length === 0 && !running}
				<div class="flex flex-col items-center justify-center gap-10 flex-1 py-20 px-8">
					<div class="flex items-center gap-10">
						<div class="flex flex-col items-center gap-3">
							<div class="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
								style="background-color: {getModelInfo(agentA).color}18; color: {getModelInfo(agentA).color}; box-shadow: 0 0 0 1px {getModelInfo(agentA).color}35">
								{getModelInfo(agentA).name[0]}
							</div>
							<span class="text-sm font-semibold text-center max-w-[120px] leading-snug" style="color: {getModelInfo(agentA).color}">{getModelInfo(agentA).name}</span>
						</div>
						<span class="text-xs font-bold uppercase tracking-[0.3em] text-[--color-muted]">vs</span>
						<div class="flex flex-col items-center gap-3">
							<div class="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
								style="background-color: {getModelInfo(agentB).color}18; color: {getModelInfo(agentB).color}; box-shadow: 0 0 0 1px {getModelInfo(agentB).color}35">
								{getModelInfo(agentB).name[0]}
							</div>
							<span class="text-sm font-semibold text-center max-w-[120px] leading-snug" style="color: {getModelInfo(agentB).color}">{getModelInfo(agentB).name}</span>
						</div>
					</div>
					<p class="text-base text-[--color-muted] text-center">Set a topic above and hit <span class="text-white font-semibold">Start debate</span>.</p>
				</div>
			{/if}

			{#each messages as msg, i (i)}
				{@const isLeft = msg.agentId === leftAgentId}
				<div
					class="flex gap-4 px-7 py-6 {i > 0 ? 'border-t border-[--color-border-subtle]' : ''} {isLeft ? '' : 'flex-row-reverse'}"
					style="animation: fadeSlide 0.25s ease both"
				>
					<div class="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold mt-0.5"
						style="background-color: {msg.color}18; color: {msg.color}; box-shadow: 0 0 0 1px {msg.color}30">
						{msg.agentName[0]}
					</div>
					<div class="flex flex-col gap-2 max-w-[80%] {isLeft ? 'items-start' : 'items-end'}">
						<span class="text-[11px] font-bold uppercase tracking-widest" style="color: {msg.color}">{msg.agentName}</span>
						<p class="text-[15px] leading-relaxed text-[#d8d8e8] px-5 py-4 rounded-2xl {isLeft ? 'rounded-tl-md' : 'rounded-tr-md'}"
							style="background-color: {msg.color}0d; border: 1px solid {msg.color}22">
							{msg.text}
						</p>
					</div>
				</div>
			{/each}

			{#if running}
				{#if streamingMessage}
					{@const isLeft = streamingMessage.agentId === leftAgentId}
					<div
						class="flex gap-4 px-7 py-6 border-t border-[--color-border-subtle] {isLeft ? '' : 'flex-row-reverse'}"
						style="animation: fadeSlide 0.2s ease both"
					>
						<div class="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold mt-0.5"
							style="background-color: {streamingMessage.color}18; color: {streamingMessage.color}; box-shadow: 0 0 0 1px {streamingMessage.color}30">
							{streamingMessage.agentName[0]}
						</div>
						<div class="flex flex-col gap-2 max-w-[80%] {isLeft ? 'items-start' : 'items-end'}">
							<span class="text-[11px] font-bold uppercase tracking-widest" style="color: {streamingMessage.color}">{streamingMessage.agentName}</span>
							<p class="text-[15px] leading-relaxed text-[#d8d8e8] px-5 py-4 rounded-2xl {isLeft ? 'rounded-tl-md' : 'rounded-tr-md'}"
								style="background-color: {streamingMessage.color}0d; border: 1px solid {streamingMessage.color}22">{streamingMessage.text}<span class="inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse" style="background-color: {streamingMessage.color}"></span></p>
						</div>
					</div>
				{:else}
					<div class="flex items-center gap-3 px-7 py-5 {messages.length > 0 ? 'border-t border-[--color-border-subtle]' : ''}">
						{#if typingAgentName}
							<div class="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
								style="background-color: {typingAgentColor}18; color: {typingAgentColor}">
								{typingAgentName[0]}
							</div>
						{/if}
						<div class="flex gap-1.5 items-center">
							<span class="w-2 h-2 rounded-full animate-bounce [animation-delay:0ms]" style="background-color: {typingAgentColor || 'var(--color-muted)'}"></span>
							<span class="w-2 h-2 rounded-full animate-bounce [animation-delay:150ms]" style="background-color: {typingAgentColor || 'var(--color-muted)'}"></span>
							<span class="w-2 h-2 rounded-full animate-bounce [animation-delay:300ms]" style="background-color: {typingAgentColor || 'var(--color-muted)'}"></span>
						</div>
						{#if typingAgentName}
							<span class="text-sm" style="color: {typingAgentColor}">{typingAgentName} is thinking…</span>
						{/if}
					</div>
				{/if}
			{/if}

			{#if done}
				<div class="text-center text-xs tracking-widest uppercase text-[--color-muted] py-5 border-t border-[--color-border-subtle]">
					debate ended
				</div>
			{/if}
		</div>

		<!-- Export -->
		{#if messages.length > 0}
			<div class="flex items-center gap-3">
				<span class="text-xs font-semibold uppercase tracking-widest text-[--color-muted]">Export</span>
				<button onclick={() => exportDebate('md')}
					class="flex items-center gap-2 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] text-[--color-muted-fg] hover:text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
					↓ Markdown
				</button>
				<button onclick={() => exportDebate('txt')}
					class="flex items-center gap-2 bg-[--color-panel] border border-[--color-border] hover:border-[--color-accent] text-[--color-muted-fg] hover:text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
					↓ Plain text
				</button>
			</div>
		{/if}

	</div>
</div>

<style>
	@keyframes fadeSlide {
		from { opacity: 0; transform: translateY(6px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>
