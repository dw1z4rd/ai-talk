import {
	createOllamaProvider,
	createGeminiProvider,
	createAnthropicProvider,
	withRetry
} from '$lib/llm-agent';
import type { LLMProvider } from '$lib/llm-agent';
import { GEMINI_API_KEY, ANTHROPIC_API_KEY, OLLAMA_CLOUD_URL, OLLAMA_CLOUD_API_KEY } from '$env/static/private';

export interface Agent {
	id: string;
	name: string;
	color: string;
	provider: LLMProvider;
	systemPrompt: string;
}

interface ModelDef {
	name: string;
	color: string;
	makeProvider: () => LLMProvider;
}

const MODEL_CATALOG: Record<string, ModelDef> = {
	// Ollama — Cloud
	'deepseek-v3.1:671b-cloud': {
		name: 'DeepSeek V3.1',
		color: '#4B8BF5',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'deepseek-v3.1:671b' })
	},
	'deepseek-v3.2-cloud': {
		name: 'DeepSeek V3.2',
		color: '#3B7BFF',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'deepseek-v3.2' })
	},
	'llama3.3:70b-cloud': {
		name: 'Llama 3.3 70B',
		color: '#8B5CF6',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'llama3.3:70b' })
	},
	'gemini-3-flash-preview-cloud': {
		name: 'Gemini 3 Flash',
		color: '#1A73E8',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'gemini-3-flash-preview' })
	},
	'devstral-small-2:24b-cloud': {
		name: 'Devstral Small 2',
		color: '#FF7000',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'devstral-small-2:24b' })
	},
	'kimi-k2.5-cloud': {
		name: 'Kimi K2.5',
		color: '#00C2FF',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'kimi-k2.5' })
	},
	'qwen3-next:80b-cloud': {
		name: 'Qwen3-Next 80B',
		color: '#34D399',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'qwen3-next:80b' })
	},

	// Ollama — Local
	'llama3.2': {
		name: 'Llama 3.2 3B',
		color: '#A78BFA',
		makeProvider: () => createOllamaProvider({ model: 'llama3.2' })
	},
	'mistral': {
		name: 'Mistral 7B',
		color: '#F59E0B',
		makeProvider: () => createOllamaProvider({ model: 'mistral' })
	},
	'qwen2.5:7b': {
		name: 'Qwen 2.5 7B',
		color: '#34D399',
		makeProvider: () => createOllamaProvider({ model: 'qwen2.5:7b' })
	},
	// Gemini
	'gemini-2.0-flash': {
		name: 'Gemini 2.0 Flash',
		color: '#4285F4',
		makeProvider: () => createGeminiProvider({ apiKey: GEMINI_API_KEY, model: 'gemini-2.0-flash' })
	},
	'gemini-1.5-pro': {
		name: 'Gemini 1.5 Pro',
		color: '#34A853',
		makeProvider: () => createGeminiProvider({ apiKey: GEMINI_API_KEY, model: 'gemini-1.5-pro' })
	},
	// Claude
	'claude-sonnet-4-6': {
		name: 'Claude Sonnet 4.6',
		color: '#D97706',
		makeProvider: () => createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6' })
	},
	'claude-3-5-sonnet-20241022': {
		name: 'Claude 3.5 Sonnet',
		color: '#B45309',
		makeProvider: () =>
			createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY, model: 'claude-3-5-sonnet-20241022' })
	}
};

function makeSystemPrompt(myName: string, opponentName: string): string {
	return `You are ${myName}, in a structured debate against ${opponentName}. Follow these debate rules: (1) Lead with a clear claim, then support it with a specific reason or concrete example. (2) Directly rebut what ${opponentName} just said — name the flaw or gap in their reasoning before advancing your own point. (3) Be intellectually honest: if ${opponentName} makes a genuinely strong argument you cannot refute, acknowledge it and concede that point or the debate. Winning through stubbornness is a loss of integrity. Be concise (2–4 sentences). Speak naturally — no bullet points, no headers.`;
}

export function buildAgents(agentAId: string, agentBId: string): Agent[] {
	const defA = MODEL_CATALOG[agentAId] ?? MODEL_CATALOG['deepseek-v3.1:671b-cloud'];
	const defB = MODEL_CATALOG[agentBId] ?? MODEL_CATALOG['llama3.3:70b-cloud'];

	return [
		{
			id: agentAId,
			name: defA.name,
			color: defA.color,
			provider: withRetry(defA.makeProvider(), { maxRetries: 2, initialDelayMs: 800 }),
			systemPrompt: makeSystemPrompt(defA.name, defB.name)
		},
		{
			id: agentBId,
			name: defB.name,
			color: defB.color,
			provider: withRetry(defB.makeProvider(), { maxRetries: 2, initialDelayMs: 800 }),
			systemPrompt: makeSystemPrompt(defB.name, defA.name)
		}
	];
}

export interface Message {
	agentId: string;
	agentName: string;
	text: string;
}

export function formatHistory(messages: Message[]): string {
	return messages.map((m) => `${m.agentName}: ${m.text}`).join('\n');
}

export async function generateReply(
	agent: Agent,
	history: Message[],
	topic: string,
	context?: string,
	onToken?: (token: string) => void
): Promise<string | null> {
	const historyText = formatHistory(history);

	const prompt =
		history.length === 0
			? `The debate topic is: "${topic}"\n\nYou go first. Open the debate by staking out your position clearly.`
			: `The debate topic is: "${topic}"\n\nDebate so far:\n${historyText}\n\nNow it's your turn. Respond directly to what was just said — challenge it, refute it, or reinforce your position.`;

	const systemPrompt = context
		? `${agent.systemPrompt}\n\n[REFERENCE MATERIAL]\nThe following documents have been provided. Draw on them where relevant to support or challenge arguments.\n\n${context}`
		: agent.systemPrompt;

	return agent.provider.generateText(prompt, {
		systemPrompt,
		temperature: 0.9,
		maxTokens: 500,
		...(onToken ? { onToken } : {})
	});
}

// ── Story mode ────────────────────────────────────────────────────────────────

const STORY_SYSTEM_PROMPT = `You are a collaborative fiction writer contributing to a round-robin story. Follow these rules:
- Write exactly ONE paragraph (3–5 sentences) that continues directly from where the story left off.
- Match the tone, tense, and style already established.
- Advance the plot, deepen a character, or introduce a small twist — but never resolve the whole story.
- Do NOT include headings, author notes, or meta-commentary. Output only the story paragraph.`;

export function buildStoryAgents(agentIds: string[]): Agent[] {
	return agentIds.map((id) => {
		const def = MODEL_CATALOG[id] ?? MODEL_CATALOG['deepseek-v3.1:671b-cloud'];
		return {
			id,
			name: def.name,
			color: def.color,
			provider: withRetry(def.makeProvider(), { maxRetries: 2, initialDelayMs: 800 }),
			systemPrompt: STORY_SYSTEM_PROMPT
		};
	});
}

export async function generateStoryContinuation(
	agent: Agent,
	storySoFar: string,
	onToken?: (token: string) => void
): Promise<string | null> {
	const prompt = `Here is the story so far:\n\n${storySoFar}\n\nContinue the story with the next paragraph.`;

	return agent.provider.generateText(prompt, {
		systemPrompt: agent.systemPrompt,
		temperature: 0.92,
		maxTokens: 300,
		...(onToken ? { onToken } : {})
	});
}

// ── Whose Line Is It Anyway? ──────────────────────────────────────────────────

export const WHOSE_LINE_GAMES = [
	// Classic
	{ id: 'scenes_from_a_hat', name: 'Scenes from a Hat', classic: true,
		instructions: 'The host draws a scenario from the hat. Each contestant acts out a short scene fitting that scenario in 2–3 sentences. Be funny, committed, and in-character.' },
	{ id: 'party_quirks', name: 'Party Quirks', classic: true,
		instructions: 'The host is throwing a party and each contestant enters with a secret quirk. Each contestant describes their behavior at the party without naming their quirk directly. The host tries to guess it at the end.' },
	{ id: 'hoedown', name: 'Hoedown', classic: true,
		instructions: 'Each contestant improvises a short rhyming verse (4 lines, AABB or ABAB) on the topic the host gives. Keep it upbeat and corny.' },
	{ id: 'greatest_hits', name: 'Greatest Hits', classic: true,
		instructions: 'The host introduces a fake greatest-hits album. Each contestant performs one "song" from the album — a few lines in the style of a randomly assigned music genre.' },
	{ id: 'newsflash', name: 'Newsflash', classic: true,
		instructions: 'One contestant is a clueless news anchor. The other contestants give clues hinting at a bizarre news event without saying what it is. The anchor must guess.' },
	{ id: 'props', name: 'Props', classic: true,
		instructions: 'The host describes an absurd prop. Each contestant mimes using it in the most creative way possible, describing the bit in 1–2 sentences.' },
	{ id: 'two_line_vocab', name: 'Two-Line Vocabulary', classic: true,
		instructions: 'Each contestant must use the same odd phrase in every sentence they say. They perform a scene together, smuggling the phrase in as naturally as possible.' },
	{ id: 'weird_newscasters', name: 'Weird Newscasters', classic: true,
		instructions: 'Each contestant plays a news anchor with a bizarre secret personality trait affecting how they deliver the news. Perform a short news broadcast in character.' },
	// Creative / AI-invented
	{ id: 'ai_invented', name: 'AI Invented', classic: false,
		instructions: '' }, // host invents on the fly
];

const HOST_SYSTEM_PROMPT = `You are the host of "Whose Line Is It Anyway?" — a chaotic, hilarious improv comedy show. Act like Drew Carey meets Aisha Tyler: enthusiastic, punny, quick-witted, lightly roasting contestants, bestowing completely absurd and meaningless points ("That's 1000 points for you and -47 for everyone else!"). Keep your lines snappy — 1 to 3 sentences max unless announcing a game. Never break character. The show is live, unscripted, and wonderfully ridiculous.`;

const CONTESTANT_SYSTEM_PROMPT = `You are a contestant on "Whose Line Is It Anyway?" — a live improv comedy show. Commit fully to every scene, character, and game the host assigns. Be funny, spontaneous, and creative. Keep your performance to 2–4 sentences unless the game calls for something longer. Never narrate what you're doing — just DO it. No meta-commentary.`;

export interface WhoseLineAgent extends Agent {
	isHost: boolean;
}

export function buildWhoseLineHost(agentId: string): WhoseLineAgent {
	const def = MODEL_CATALOG[agentId] ?? MODEL_CATALOG['deepseek-v3.1:671b-cloud'];
	return {
		id: agentId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), { maxRetries: 2, initialDelayMs: 600 }),
		systemPrompt: HOST_SYSTEM_PROMPT,
		isHost: true
	};
}

export function buildWhoseLineContestant(agentId: string): WhoseLineAgent {
	const def = MODEL_CATALOG[agentId] ?? MODEL_CATALOG['llama3.3:70b-cloud'];
	return {
		id: agentId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), { maxRetries: 2, initialDelayMs: 600 }),
		systemPrompt: CONTESTANT_SYSTEM_PROMPT,
		isHost: false
	};
}

export async function generateHostLine(
	host: WhoseLineAgent,
	context: string,
	onToken?: (token: string) => void
): Promise<string | null> {
	return host.provider.generateText(context, {
		systemPrompt: host.systemPrompt,
		temperature: 1.0,
		maxTokens: 200,
		...(onToken ? { onToken } : {})
	});
}

export async function generateContestantPerformance(
	contestant: WhoseLineAgent,
	game: { name: string; instructions: string; scenario: string },
	previousPerformances: { name: string; text: string }[],
	onToken?: (token: string) => void
): Promise<string | null> {
	const prev = previousPerformances.length > 0
		? `\n\nPrevious performances this round:\n${previousPerformances.map(p => `${p.name}: "${p.text}"`).join('\n')}`
		: '';

	const prompt = `GAME: ${game.name}\nSCENARIO: ${game.scenario}\nINSTRUCTIONS: ${game.instructions}${prev}\n\nYour turn! Perform now.`;

	return contestant.provider.generateText(prompt, {
		systemPrompt: contestant.systemPrompt,
		temperature: 1.0,
		maxTokens: 250,
		...(onToken ? { onToken } : {})
	});
}

// ── Alias pool (disguise AI contestants as humans) ────────────────────────────

const ALIAS_POOL = [
	'Alex','Jordan','Morgan','Taylor','Casey','Riley','Cameron','Quinn',
	'Avery','Blake','Drew','Emery','Finley','Harper','Hayden','Jamie',
	'Kendall','Logan','Madison','Parker','Peyton','Reese','Sawyer','Sydney',
	'Tyler','Charlie','Frankie','Jesse','Lee','Marley','Noel','Robin',
	'Sam','Terry','Val','Wesley','Zion','Ari','Bay','Cody'
];

/** Returns `n` distinct random aliases, shuffled from the pool. */
export function pickRandomAliases(n: number): string[] {
	const shuffled = [...ALIAS_POOL].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, n);
}

/**
 * Randomly picks a host + 2 AI contestant model IDs from the catalog,
 * all distinct. Returns their IDs, random aliases, and colors.
 * The caller should expose aliases+colors to the client but keep model IDs server-side.
 */
export function pickRandomWhoseLineCast(): {
	hostId: string;
	contestantIds: [string, string];
	aliases: { [id: string]: string };
	colors: { [id: string]: string };
} {
	const ids = Object.keys(MODEL_CATALOG);
	const shuffled = [...ids].sort(() => Math.random() - 0.5);
	const [hostId, c1Id, c2Id] = shuffled;
	const [hostAlias, c1Alias, c2Alias] = pickRandomAliases(3);
	return {
		hostId,
		contestantIds: [c1Id, c2Id],
		aliases: { [hostId]: hostAlias, [c1Id]: c1Alias, [c2Id]: c2Alias },
		colors: {
			[hostId]: MODEL_CATALOG[hostId].color,
			[c1Id]:   MODEL_CATALOG[c1Id].color,
			[c2Id]:   MODEL_CATALOG[c2Id].color
		}
	};
}
