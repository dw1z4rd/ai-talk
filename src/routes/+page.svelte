<script lang="ts">
	interface ChatMessage {
		agentId: 'gemini' | 'claude';
		agentName: string;
		color: string;
		text: string;
	}

	let topic = $state('Is free will an illusion?');
	let turns = $state(12);
	let messages = $state<ChatMessage[]>([]);
	let running = $state(false);
	let done = $state(false);
	let errorMsg = $state('');
	let chatEl = $state<HTMLElement | null>(null);

	function exportDebate(format: 'md' | 'txt') {
		const date = new Date().toISOString().slice(0, 10);
		const safeTitle = topic.slice(0, 60).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

		let content: string;
		let mime: string;
		let ext: string;

		if (format === 'md') {
			content = `# Debate: ${topic}\n\n_Exported ${date}_\n\n---\n\n`;
			content += messages
				.map((m) => `### ${m.agentName}\n\n${m.text}`)
				.join('\n\n---\n\n');
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

	async function startConversation() {
		messages = [];
		done = false;
		errorMsg = '';
		running = true;

		const params = new URLSearchParams({ topic, turns: String(turns) });
		const es = new EventSource(`/api/chat?${params}`);

		es.onmessage = (e) => {
			const data = JSON.parse(e.data);

			if (data.type === 'message') {
				messages = [
					...messages,
					{ agentId: data.agentId, agentName: data.agentName, color: data.color, text: data.text }
				];
				setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 50);
			} else if (data.type === 'done') {
				done = true;
				running = false;
				es.close();
			} else if (data.type === 'error') {
				errorMsg = data.message || `${data.agentName ?? 'An AI'} failed to respond.`;
				running = false;
				es.close();
			}
		};

		es.onerror = () => {
			if (running) {
				errorMsg = 'Connection lost. The debate ended unexpectedly.';
				running = false;
			}
			es.close();
		};
	}
</script>

<div class="min-h-dvh flex flex-col items-center px-4 py-12 sm:py-16">
	<div class="w-full max-w-2xl flex flex-col gap-10">

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
			<div class="flex gap-2 items-end">
				<div class="flex flex-col gap-1.5 flex-1">
					<label for="topic" class="text-[10px] font-semibold uppercase tracking-widest text-[--color-muted]">
						Topic
					</label>
					<input
						id="topic"
						type="text"
						bind:value={topic}
						placeholder="What should they debate?"
						disabled={running}
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
				<button
					onclick={startConversation}
					disabled={running}
					class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
				>
					{running ? 'Debating…' : 'Start'}
				</button>
			</div>

			{#if errorMsg}
				<div class="bg-red-950/60 border border-red-900/60 rounded-lg px-4 py-3 text-sm text-red-400">
					{errorMsg}
				</div>
			{/if}
		</div>

		<!-- Chat -->
		<div
			bind:this={chatEl}
			class="flex flex-col gap-0 bg-[--color-panel] border border-[--color-border] rounded-2xl overflow-y-auto min-h-72 max-h-[68vh] scroll-smooth"
		>
			{#if messages.length === 0 && !running}
				<!-- Empty state -->
				<div class="flex flex-col items-center justify-center gap-6 flex-1 py-16 px-6">
					<div class="flex items-center gap-5">
						<div class="flex flex-col items-center gap-1.5">
							<div class="w-10 h-10 rounded-full bg-[--color-gemini-dim] flex items-center justify-center">
								<span class="text-[--color-gemini] text-lg font-bold">G</span>
							</div>
							<span class="text-xs font-semibold text-[--color-gemini] tracking-wide">Gemini</span>
						</div>
						<div class="flex flex-col items-center gap-1 text-[--color-muted]">
							<span class="text-xl font-light">vs</span>
						</div>
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
					<!-- Avatar -->
					<div
						class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mt-0.5"
						style="background-color: {isGemini ? 'var(--color-gemini-dim)' : 'var(--color-claude-dim)'}; color: {isGemini ? 'var(--color-gemini)' : 'var(--color-claude)'}"
					>
						{isGemini ? 'G' : 'C'}
					</div>

					<!-- Bubble -->
					<div class="flex flex-col gap-1 max-w-[82%] {isGemini ? 'items-start' : 'items-end'}">
						<span
							class="text-[10px] font-semibold uppercase tracking-widest"
							style="color: {isGemini ? 'var(--color-gemini)' : 'var(--color-claude)'}"
						>
							{msg.agentName}
						</span>
						<p
							class="text-sm leading-relaxed text-[#d4d4e0] {isGemini
								? 'border-l-2 pl-3'
								: 'border-r-2 pr-3 text-right'}"
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
