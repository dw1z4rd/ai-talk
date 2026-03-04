<script lang="ts">
	// ── Types ──────────────────────────────────────────────────────────────
	interface CastMember { alias: string; color: string; }
	interface ChatMsg { from: string; color: string; text: string; isPlayer?: boolean; isHost?: boolean; isMeta?: boolean; }

	// ── State ──────────────────────────────────────────────────────────────
	let phase = $state<'lobby' | 'playing' | 'done'>('lobby');
	let playerName = $state('');
	let totalGames = $state(4);
	let cast = $state<{
		host: CastMember;
		contestants: CastMember[];
		_hostId: string;
		_contestantIds: [string, string];
		_aliases: Record<string, string>;
		_colors: Record<string, string>;
	} | null>(null);

	let messages = $state<ChatMsg[]>([]);
	let typingFrom = $state<{ alias: string; color: string } | null>(null);
	let streamingMsg = $state<ChatMsg | null>(null);
	let awaitingInput = $state(false);
	let currentGame = $state<{ id: string; name: string; instructions: string; scenario: string } | null>(null);
	let roundPerformances = $state<{ alias: string; text: string; isPlayer?: boolean }[]>([]);
	let playerInput = $state('');
	let round = $state(0);
	let chatEl = $state<HTMLElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let errorMsg = $state('');
	let submitting = $state(false);
	let userResolve: (() => void) | null = null;

	// ── Helpers ─────────────────────────────────────────────────────────────
	function scrollBottom() {
		setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 30);
	}

	function addMsg(msg: ChatMsg) {
		messages = [...messages, msg];
		scrollBottom();
	}

	function metaMsg(text: string) {
		addMsg({ from: '', color: '', text, isMeta: true });
	}

	async function readSSE(url: string, body: object, onEvent: (data: any) => void) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.body) throw new Error('No response body');
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		let buf = '';
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const parts = buf.split('\n\n');
			buf = parts.pop() ?? '';
			for (const part of parts) {
				const line = part.trim();
				if (!line.startsWith('data: ')) continue;
				const data = JSON.parse(line.slice(6));
				onEvent(data);
			}
		}
	}

	// ── Game flow ────────────────────────────────────────────────────────────
	async function startGame() {
		if (!playerName.trim()) return;
		phase = 'playing';
		errorMsg = '';
		messages = [];

		try {
			const res = await fetch('/api/whoseline/init', { method: 'POST' });
			cast = await res.json();
		} catch {
			errorMsg = 'Failed to start. Check your server.';
			phase = 'lobby';
			return;
		}

		metaMsg(`🎙 Welcome, ${playerName.trim()}! You're playing with ${cast!.contestants.map(c => c.alias).join(' and ')} — hosted by ${cast!.host.alias}. Nobody knows who's an AI.`);

		for (round = 1; round <= totalGames; round++) {
			roundPerformances = [];
			await runRound(round);
			if (round < totalGames) {
				metaMsg(`— Round ${round} complete —`);
				await new Promise(r => setTimeout(r, 800));
			}
		}

		metaMsg("🎉 That's all the time we have! Thanks for playing Whose Line!");
		phase = 'done';
	}

	async function runRound(r: number) {
		// Host announces game + AI contestants perform
		await readSSE('/api/whoseline/round', {
			_hostId: cast!._hostId,
			_contestantIds: cast!._contestantIds,
			_aliases: cast!._aliases,
			_colors: cast!._colors,
			round: r,
			totalGames
		}, (data) => {
			if (data.type === 'typing') {
				typingFrom = { alias: data.from, color: data.color };
				streamingMsg = null;
				scrollBottom();
			} else if (data.type === 'token') {
				typingFrom = null;
				if (!streamingMsg || streamingMsg.from !== data.from) {
					streamingMsg = { from: data.from, color: data.color, text: data.text, isHost: data.from === cast!.host.alias };
				} else {
					streamingMsg = { ...streamingMsg, text: streamingMsg.text + data.text };
				}
				scrollBottom();
			} else if (data.type === 'message') {
				typingFrom = null;
				streamingMsg = null;
				const isHost = data.from === cast!.host.alias;
				addMsg({ from: data.from, color: data.color, text: data.text, isHost });
				if (!isHost) roundPerformances = [...roundPerformances, { alias: data.from, text: data.text }];
			} else if (data.type === 'await_input') {
				currentGame = data.game;
				awaitingInput = true;
				scrollBottom();
				setTimeout(() => inputEl?.focus(), 100);
			} else if (data.type === 'error') {
				errorMsg = data.message;
			}
		});

		// Pause for player to submit their performance
		if (awaitingInput) {
			await new Promise<void>((resolve) => { userResolve = resolve; });
		}

		typingFrom = null;
		streamingMsg = null;

		// Host scores all performances including player's
		await readSSE('/api/whoseline/score', {
			_hostId: cast!._hostId,
			_aliases: cast!._aliases,
			_colors: cast!._colors,
			performances: roundPerformances,
			game: { name: currentGame?.name ?? '', scenario: currentGame?.scenario ?? '' },
			scenario: currentGame?.scenario ?? ''
		}, (data) => {
			if (data.type === 'typing') {
				typingFrom = { alias: data.from, color: data.color };
				streamingMsg = null;
				scrollBottom();
			} else if (data.type === 'token') {
				typingFrom = null;
				if (!streamingMsg || streamingMsg.from !== data.from) {
					streamingMsg = { from: data.from, color: data.color, text: data.text, isHost: true };
				} else {
					streamingMsg = { ...streamingMsg, text: streamingMsg.text + data.text };
				}
				scrollBottom();
			} else if (data.type === 'message') {
				typingFrom = null;
				streamingMsg = null;
				addMsg({ from: data.from, color: data.color, text: data.text, isHost: true });
			}
		});

		currentGame = null;
	}

	async function submitPerformance() {
		if (!playerInput.trim() || !awaitingInput || submitting) return;
		submitting = true;
		const text = playerInput.trim();
		playerInput = '';
		awaitingInput = false;
		currentGame = null;
		addMsg({ from: playerName.trim(), color: '#a78bfa', text, isPlayer: true });
		roundPerformances = [...roundPerformances, { alias: playerName.trim(), text, isPlayer: true }];
		submitting = false;
		if (userResolve) { userResolve(); userResolve = null; }
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPerformance(); }
	}
</script>

<div class="min-h-dvh flex flex-col items-center bg-[--color-surface] px-4 py-10">

	{#if phase === 'lobby'}
		<!-- Lobby -->
		<div class="w-full max-w-md flex flex-col gap-6 mt-16">
			<div class="text-center">
				<h1 class="text-4xl font-bold text-white mb-1">🎙 Whose Line?</h1>
				<p class="text-[--color-muted] text-sm">Join a live improv show — you'll be playing with strangers</p>
			</div>

			<div class="flex flex-col gap-4 bg-[--color-panel] border border-[--color-border] rounded-2xl p-6">
				<div class="flex flex-col gap-1.5">
					<label for="pname" class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted]">Your Stage Name</label>
					<input
						id="pname"
						type="text"
						bind:value={playerName}
						placeholder="e.g. Improvmaster 3000"
						autofocus
						onkeydown={(e) => e.key === 'Enter' && startGame()}
						class="w-full bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-base text-white placeholder:text-[--color-muted] outline-none focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] transition-all"
					/>
				</div>

				<div class="flex items-center gap-3 bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-2.5">
					<label for="gcount" class="text-[11px] font-semibold uppercase tracking-widest text-[--color-muted] whitespace-nowrap">Rounds</label>
					<input id="gcount" type="number" min="2" max="8" bind:value={totalGames}
						class="w-14 bg-transparent text-sm text-white outline-none text-center" />
				</div>

				{#if errorMsg}<p class="text-sm text-red-400">{errorMsg}</p>{/if}

				<button onclick={startGame} disabled={!playerName.trim()}
					class="bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-all cursor-pointer shadow-[0_0_24px_#7c6af740]">
					Join the Show
				</button>
			</div>

			<a href="/" class="text-center text-xs text-[--color-muted] hover:text-[--color-muted-fg] transition-colors">← Back to Debate</a>
		</div>

	{:else}
		<!-- Chat room -->
		<div class="w-full max-w-2xl flex flex-col" style="height: 100dvh">

			<!-- Header -->
			<div class="flex items-center gap-3 px-5 py-4 border-b border-[--color-border] bg-[--color-panel]/80 backdrop-blur-sm">
				<span class="text-lg">🎙</span>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-semibold text-white">Whose Line Is It Anyway?</p>
					{#if cast}
						<div class="flex items-center gap-2 mt-0.5 flex-wrap">
							<span class="text-[11px] px-2 py-0.5 rounded-full bg-[--color-border] text-[--color-muted-fg]">
								<span style="color:{cast.host.color}">⭐ {cast.host.alias}</span> host
							</span>
							{#each cast.contestants as c}
								<span class="text-[11px] px-2 py-0.5 rounded-full bg-[--color-border]" style="color:{c.color}">{c.alias}</span>
							{/each}
							<span class="text-[11px] px-2 py-0.5 rounded-full bg-[#7c6af7]/20 text-[#a78bfa]">👤 {playerName} (you)</span>
						</div>
					{/if}
				</div>
				{#if phase === 'playing'}
					<span class="text-[11px] tabular-nums font-semibold text-[--color-muted]">Round {round}/{totalGames}</span>
				{/if}
			</div>

			<!-- Game banner -->
			{#if currentGame && awaitingInput}
				<div class="mx-4 mt-3 px-4 py-3 bg-[#7c6af7]/10 border border-[#7c6af7]/30 rounded-xl">
					<p class="text-xs font-bold uppercase tracking-widest text-[--color-accent] mb-0.5">{currentGame.name}</p>
					<p class="text-xs text-[--color-muted-fg]">{currentGame.instructions}</p>
				</div>
			{/if}

			<!-- Messages feed -->
			<div bind:this={chatEl} class="flex-1 overflow-y-auto scroll-smooth px-4 py-4 flex flex-col gap-1">
				{#each messages as msg}
					{#if msg.isMeta}
						<div class="flex justify-center my-3">
							<span class="text-[11px] text-[--color-muted] bg-[--color-panel] border border-[--color-border-subtle] px-3 py-1 rounded-full">{msg.text}</span>
						</div>
					{:else if msg.isPlayer}
						<div class="flex flex-row-reverse items-end gap-2 mt-2" style="animation: fadeSlide .18s ease both">
							<div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-xs font-bold"
								style="background:#a78bfa22;color:#a78bfa;border:1px solid #a78bfa30">{(playerName[0]??'Y').toUpperCase()}</div>
							<div class="flex flex-col items-end gap-0.5" style="max-width:75%">
								<span class="text-[10px] font-bold uppercase tracking-widest text-[#a78bfa]">YOU · {playerName}</span>
								<p class="text-[14px] leading-relaxed text-[#d4d4e8] px-4 py-3 rounded-2xl rounded-tr-sm"
									style="background:#a78bfa14;border:1px solid #a78bfa28">{msg.text}</p>
							</div>
						</div>
					{:else}
						<div class="flex items-end gap-2 mt-2" style="animation: fadeSlide .18s ease both">
							<div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-xs font-bold"
								style="background:{msg.color}22;color:{msg.color};border:1px solid {msg.color}30">{msg.from[0]?.toUpperCase()}</div>
							<div class="flex flex-col gap-0.5" style="max-width:75%">
								<span class="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style="color:{msg.color}">
									{#if msg.isHost}⭐{/if}{msg.from}
								</span>
								<p class="text-[14px] leading-relaxed text-[#d4d4e8] px-4 py-3 rounded-2xl rounded-tl-sm"
									style="background:{msg.color}0e;border:1px solid {msg.color}28;border-top:1px solid {msg.color}18">{msg.text}</p>
							</div>
						</div>
					{/if}
				{/each}

				<!-- Streaming message -->
				{#if streamingMsg}
					{@const m = streamingMsg}
					<div class="flex items-end gap-2 mt-2" style="animation: fadeSlide .12s ease both">
						<div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-xs font-bold"
							style="background:{m.color}22;color:{m.color};border:1px solid {m.color}30">{m.from[0]?.toUpperCase()}</div>
						<div class="flex flex-col gap-0.5" style="max-width:75%">
							<span class="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style="color:{m.color}">
								{#if m.isHost}⭐{/if}{m.from}
							</span>
							<p class="text-[14px] leading-relaxed text-[#d4d4e8] px-4 py-3 rounded-2xl rounded-tl-sm"
								style="background:{m.color}0e;border:1px solid {m.color}28">
								{m.text}<span class="inline-block w-[2px] h-[1em] ml-[2px] align-text-bottom rounded-sm animate-pulse" style="background:{m.color}"></span>
							</p>
						</div>
					</div>
				{/if}

				<!-- Typing indicator -->
				{#if typingFrom && !streamingMsg}
					<div class="flex items-center gap-2 mt-2 px-1">
						<div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-xs font-bold"
							style="background:{typingFrom.color}22;color:{typingFrom.color};border:1px solid {typingFrom.color}30">{typingFrom.alias[0]?.toUpperCase()}</div>
						<div class="flex gap-1 items-center px-4 py-3 rounded-2xl rounded-tl-sm" style="background:{typingFrom.color}0e;border:1px solid {typingFrom.color}28">
							<span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" style="background:{typingFrom.color}"></span>
							<span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:160ms]" style="background:{typingFrom.color}"></span>
							<span class="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:320ms]" style="background:{typingFrom.color}"></span>
						</div>
					</div>
				{/if}
			</div>

			<!-- Input -->
			<div class="px-4 py-4 border-t border-[--color-border] bg-[--color-panel]/80 backdrop-blur-sm">
				{#if phase === 'done'}
					<div class="flex justify-center gap-3">
						<button onclick={() => { phase = 'lobby'; cast = null; messages = []; }}
							class="bg-[--color-accent] hover:bg-[--color-accent-hover] text-white font-semibold px-6 py-2.5 rounded-xl transition-all cursor-pointer text-sm">
							Play again
						</button>
						<a href="/" class="flex items-center text-sm text-[--color-muted] hover:text-[--color-muted-fg] transition-colors">← Debate mode</a>
					</div>
				{:else}
					<div class="flex items-end gap-2">
						<div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-xs font-bold mb-1"
							style="background:#a78bfa22;color:#a78bfa;border:1px solid #a78bfa30">{(playerName[0]??'Y').toUpperCase()}</div>
						<input
							bind:this={inputEl}
							bind:value={playerInput}
							onkeydown={onKeydown}
							disabled={!awaitingInput}
							placeholder={awaitingInput ? `Your turn, ${playerName}! Perform now…` : 'Waiting for the others…'}
							class="flex-1 bg-[--color-surface] border border-[--color-border] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[--color-muted] outline-none transition-all focus:border-[--color-accent] disabled:opacity-40 disabled:cursor-not-allowed"
						/>
						<button onclick={submitPerformance} disabled={!awaitingInput || !playerInput.trim()}
							class="flex-shrink-0 bg-[--color-accent] hover:bg-[--color-accent-hover] disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold px-4 py-3 rounded-xl transition-all cursor-pointer text-sm">
							Send
						</button>
					</div>
					{#if awaitingInput}
						<p class="text-[11px] text-[--color-muted] mt-1.5 ml-10">Enter to submit</p>
					{/if}
				{/if}
			</div>

		</div>
	{/if}
</div>

<style>
	@keyframes fadeSlide {
		from { opacity: 0; transform: translateY(6px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>