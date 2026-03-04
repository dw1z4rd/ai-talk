<script lang="ts">
	interface ChatMessage {
		agentId: 'gemini' | 'claude';
		agentName: string;
		color: string;
		text: string;
	}

	let topic = $state('What is consciousness?');
	let turns = $state(12);
	let messages = $state<ChatMessage[]>([]);
	let running = $state(false);
	let done = $state(false);
	let errorMsg = $state('');
	let chatEl = $state<HTMLElement | null>(null);

	const AVATARS: Record<string, string> = {
		gemini: '✦',
		claude: '◆'
	};

	function exportDebate(format: 'md' | 'txt') {
		const date = new Date().toISOString().slice(0, 10);
		const safeTitle = topic.slice(0, 60).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

		let content: string;
		let mime: string;
		let ext: string;

		if (format === 'md') {
			content = `# Debate: ${topic}\n\n_Exported ${date}_\n\n---\n\n`;
			content += messages
				.map((m) => `### ${AVATARS[m.agentId]} ${m.agentName}\n\n${m.text}`)
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
					{
						agentId: data.agentId,
						agentName: data.agentName,
						color: data.color,
						text: data.text
					}
				];
				// Scroll to bottom
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
				errorMsg = 'Connection lost. The conversation ended unexpectedly.';
				running = false;
			}
			es.close();
		};
	}
</script>

<main>
	<header>
		<h1>AI<span class="accent">talk</span></h1>
		<p class="subtitle">Watch Gemini and Claude debate each other</p>
	</header>

	<section class="controls">
		<div class="field">
			<label for="topic">Topic</label>
			<input
				id="topic"
				type="text"
				bind:value={topic}
				placeholder="What should they discuss?"
				disabled={running}
			/>
		</div>
		<div class="field field-narrow">
			<label for="turns">Turns</label>
			<input id="turns" type="number" bind:value={turns} min="3" max="30" disabled={running} />
		</div>
		<button class="start-btn" onclick={startConversation} disabled={running}>
			{running ? 'Conversing…' : 'Start'}
		</button>
	</section>

	{#if errorMsg}
		<div class="error">{errorMsg}</div>
	{/if}

	<section class="chat" bind:this={chatEl}>
		{#if messages.length === 0 && !running}
			<div class="empty-state">
				<div class="ai-trio">
					<span style="color: #4285F4">✦ Gemini</span>
					<span class="vs">vs</span>
					<span style="color: #D97706">◆ Claude</span>
	
				</div>
				<p>Set a topic and hit Start to watch them go.</p>
			</div>
		{/if}

		{#each messages as msg, i (i)}
			<div class="bubble" style="--agent-color: {msg.color}">
				<div class="avatar" style="background: {msg.color}">
					{AVATARS[msg.agentId]}
				</div>
				<div class="bubble-body">
					<span class="agent-name" style="color: {msg.color}">{msg.agentName}</span>
					<p>{msg.text}</p>
				</div>
			</div>
		{/each}

		{#if running}
			<div class="typing-indicator">
				<span></span><span></span><span></span>
			</div>
		{/if}

		{#if done}
			<div class="done-badge">— debate ended —</div>
		{/if}
	</section>

	{#if messages.length > 0}
		<div class="export-bar">
			<span class="export-label">Export</span>
			<button class="export-btn" onclick={() => exportDebate('md')}>↓ Markdown</button>
			<button class="export-btn" onclick={() => exportDebate('txt')}>↓ Plain text</button>
		</div>
	{/if}
</main>

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: 'Inter', system-ui, sans-serif;
		background: #0e0e10;
		color: #e8e8ed;
		min-height: 100vh;
	}

	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	header {
		text-align: center;
	}

	h1 {
		font-size: 2.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #f0f0f5;
	}

	.accent {
		color: #7c6af7;
	}

	.subtitle {
		margin-top: 0.4rem;
		color: #888;
		font-size: 0.95rem;
	}

	/* Controls */
	.controls {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
	}

	.field-narrow {
		flex: 0 0 80px;
	}

	label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}

	input[type='text'],
	input[type='number'] {
		background: #1a1a1e;
		border: 1px solid #2e2e34;
		border-radius: 8px;
		color: #e8e8ed;
		padding: 0.6rem 0.85rem;
		font-size: 0.95rem;
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
	}

	input:focus {
		border-color: #7c6af7;
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.start-btn {
		background: #7c6af7;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.65rem 1.5rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
		white-space: nowrap;
		align-self: flex-end;
	}

	.start-btn:hover:not(:disabled) {
		background: #6859e8;
	}

	.start-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* Error */
	.error {
		background: #2a1010;
		border: 1px solid #6b2020;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		color: #f87171;
		font-size: 0.9rem;
	}

	/* Chat */
	.chat {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-height: 300px;
		max-height: 72vh;
		overflow-y: auto;
		padding: 1.5rem;
		background: #13131a;
		border: 1px solid #22222a;
		border-radius: 14px;
		scroll-behavior: smooth;
	}

	.chat::-webkit-scrollbar {
		width: 6px;
	}
	.chat::-webkit-scrollbar-track {
		background: transparent;
	}
	.chat::-webkit-scrollbar-thumb {
		background: #2e2e3a;
		border-radius: 3px;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		flex: 1;
		padding: 3rem 0;
		color: #555;
		font-size: 0.9rem;
	}

	.ai-trio {
		display: flex;
		gap: 0.75rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.vs {
		color: #333;
	}

	/* Message bubble */
	.bubble {
		display: flex;
		gap: 0.85rem;
		align-items: flex-start;
		animation: fadeSlide 0.25s ease;
	}

	@keyframes fadeSlide {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.avatar {
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		color: #fff;
		font-weight: 700;
		margin-top: 2px;
	}

	.bubble-body {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.agent-name {
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.bubble-body p {
		font-size: 0.97rem;
		line-height: 1.6;
		color: #d4d4de;
		max-width: 620px;
	}

	/* Typing indicator */
	.typing-indicator {
		display: flex;
		gap: 5px;
		padding: 0.5rem 0.75rem;
		align-self: flex-start;
	}

	.typing-indicator span {
		width: 7px;
		height: 7px;
		background: #444;
		border-radius: 50%;
		animation: blink 1.2s infinite;
	}

	.typing-indicator span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing-indicator span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.2;
		}
		40% {
			opacity: 1;
		}
	}

	/* Export bar */
	.export-bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.export-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #555;
		margin-right: 0.25rem;
	}

	.export-btn {
		background: #1a1a1e;
		border: 1px solid #2e2e34;
		border-radius: 7px;
		color: #aaa;
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.export-btn:hover {
		border-color: #7c6af7;
		color: #e8e8ed;
	}

	/* Done badge */
	.done-badge {
		text-align: center;
		font-size: 0.78rem;
		color: #444;
		letter-spacing: 0.08em;
		padding-top: 0.5rem;
	}
</style>
