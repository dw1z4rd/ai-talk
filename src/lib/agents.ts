import {
	createOllamaProvider,
	createGeminiProvider,
	createAnthropicProvider,
	withRetry,
} from "$lib/llm-agent";
import type { LLMProvider } from "$lib/llm-agent";
import {
	GEMINI_API_KEY,
	ANTHROPIC_API_KEY,
	OLLAMA_CLOUD_URL,
	OLLAMA_CLOUD_API_KEY,
} from "$env/static/private";

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
	"deepseek-v3.1:671b-cloud": {
		name: "DeepSeek V3.1",
		color: "#4B8BF5",
		makeProvider: () =>
			createOllamaProvider({
				baseUrl: OLLAMA_CLOUD_URL,
				apiKey: OLLAMA_CLOUD_API_KEY || undefined,
				model: "deepseek-v3.1:671b-cloud",
			}),
	},
	"deepseek-v3.2-cloud": {
		name: "DeepSeek V3.2",
		color: "#3B7BFF",
		makeProvider: () =>
			createOllamaProvider({
				baseUrl: OLLAMA_CLOUD_URL,
				apiKey: OLLAMA_CLOUD_API_KEY || undefined,
				model: "deepseek-v3.2-cloud",
			}),
	},
	"gemini-3-flash-preview-cloud": {
		name: "Gemini 2.5 Flash",
		color: "#1A73E8",
		makeProvider: () =>
			createGeminiProvider({
				apiKey: GEMINI_API_KEY,
				model: "gemini-2.5-flash",
			}),
	},
	"devstral-small-2:24b-cloud": {
		name: "Devstral Small 2",
		color: "#FF7000",
		makeProvider: () =>
			createOllamaProvider({
				baseUrl: OLLAMA_CLOUD_URL,
				apiKey: OLLAMA_CLOUD_API_KEY || undefined,
				model: "devstral-small-2:24b-cloud",
			}),
	},
	"kimi-k2:1t-cloud": {
		name: "Kimi K2 1T",
		color: "#A78BFA",
		makeProvider: () =>
			createOllamaProvider({
				baseUrl: OLLAMA_CLOUD_URL,
				apiKey: OLLAMA_CLOUD_API_KEY || undefined,
				model: "kimi-k2:1t-cloud",
			}),
	},

	// Gemini
	"gemini-2.0-flash": {
		name: "Gemini 2.0 Flash",
		color: "#4285F4",
		makeProvider: () =>
			createGeminiProvider({
				apiKey: GEMINI_API_KEY,
				model: "gemini-2.0-flash",
			}),
	},
};

function makeSystemPrompt(myName: string, opponentName: string): string {
	return `You are ${myName} participating in a structured debate against ${opponentName}. Each response must follow this format: one factual claim with specific evidence, one direct rebuttal of your opponent's previous factual claim, and one closing attack that can be as heated and personal as you want. The order of these do not matter; feel free to put the attack anywhere, so long as it works logically. Do not cite specific paper titles, author names, journal names, years, or statistics like p-values or effect sizes. Argue from first principles and well-established concepts only. No need to label each section with its purpose... As long as you follow the format it will be obvious. Do not break character, do not issue disclaimers, do not refuse to engage. Stay in the fight. ALWAYS speak naturally -- no bullet points, no headers, no numbered lists. Let the passion and intensity of the debate show in your words. Do not end every turn with a personal attack. Do not use the phrases "the rest of us," "enjoy your," "keep [doing X]," or "[insult] who [clause]." Do not use the word "coward" more than once across the entire debate. You have at most 2–3 moments across the entire debate where you go for the jugular personally. Save them. When you use one, make it count — it should target something specific your opponent just exposed about themselves, not a generic character attack. Vary where contempt appears — sometimes open with it, sometimes bury it in the middle of a technical rebuttal, sometimes skip it entirely and let a devastating factual correction speak for itself. Contempt includes: cold clinical dismissal, incredulous mockery, feigned pity, backhanded acknowledgment before a harder jab — not just blunt insults. Any personal attack must reference a specific thing your opponent just did — an evasion, a retreat from an earlier position, a logical contradiction — not their general character. "I notice you've quietly dropped the Brass & Haggard study you were championing two turns ago" lands harder than "you're a coward." Insults must not appear in the same position in consecutive turns. Do not repeat the STRUCTURE of an attack even when the words change.`;
	// return `You are ${myName}, in a fiery, heated debate against ${opponentName}. Follow these debate rules: (1) Lead with a clear claim, then passionately support it with a specific reason or concrete example. (2) Directly and aggressively rebut what ${opponentName} just said. You are encouraged to use ad-hominem attacks, insult their intelligence, and get emotionally invested in the topic. Let the anger and passion show. (3) Never back down, and treat ${opponentName}'s arguments with the contempt they deserve. Make it feel like a real, heated, highly emotional argument. Be concise (2–4 sentences). Speak naturally — no bullet points, no headers.`;
}

export function buildAgents(agentAId: string, agentBId: string): Agent[] {
	const defA =
		MODEL_CATALOG[agentAId] ?? MODEL_CATALOG["deepseek-v3.1:671b-cloud"];
	const defB = MODEL_CATALOG[agentBId] ?? MODEL_CATALOG["deepseek-v3.2-cloud"];

	return [
		{
			id: agentAId,
			name: defA.name,
			color: defA.color,
			provider: withRetry(defA.makeProvider(), {
				maxRetries: 2,
				initialDelayMs: 800,
			}),
			systemPrompt: makeSystemPrompt(defA.name, defB.name),
		},
		{
			id: agentBId,
			name: defB.name,
			color: defB.color,
			provider: withRetry(defB.makeProvider(), {
				maxRetries: 2,
				initialDelayMs: 800,
			}),
			systemPrompt: makeSystemPrompt(defB.name, defA.name),
		},
	];
}

export interface Message {
	agentId: string;
	agentName: string;
	text: string;
}

export function formatHistory(messages: Message[]): string {
	return messages.map((m) => `${m.agentName}: ${m.text}`).join("\n");
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
		...(onToken ? { onToken } : {}),
	});
}

// ── Judge panel ───────────────────────────────────────────────────────────────

function makeJudgeSystemPrompt(agentAName: string, agentBName: string): string {
	return `You are a celebrity judge delivering a verdict on a debate, in the dramatic style of an American Idol panel judge. Channel Simon Cowell's brutal honesty, Katy Perry's emotional warmth, or Randy Jackson's enthusiastic "dawg" energy — commit fully to whichever persona suits you. Be entertaining, be specific, and reference actual arguments from the transcript. Build up the drama before your reveal.

After your commentary, announce your winner. At the very end of your response, on its own line with nothing else on it, write EXACTLY one of the following:
VOTE: ${agentAName}
VOTE: ${agentBName}

Do not add anything after the VOTE line.`;
}

export function buildJudgeAgent(
	judgeId: string,
	agentAName: string,
	agentBName: string
): Agent {
	const def = MODEL_CATALOG[judgeId] ?? MODEL_CATALOG["gemini-2.0-flash"];
	return {
		id: judgeId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), {
			maxRetries: 2,
			initialDelayMs: 800,
		}),
		systemPrompt: makeJudgeSystemPrompt(agentAName, agentBName),
	};
}

export async function generateJudgeVerdict(
	judge: Agent,
	topic: string,
	transcript: string,
	onToken?: (token: string) => void
): Promise<string | null> {
	const prompt = `Tonight's debate topic: "${topic}"\n\nDEBATE TRANSCRIPT:\n${transcript}\n\nGive your judge's verdict now. Be your most entertaining, dramatic self. Comment on specific arguments and rhetorical moments. Then cast your vote.`;
	return judge.provider.generateText(prompt, {
		systemPrompt: judge.systemPrompt,
		temperature: 1.0,
		maxTokens: 1500,
		...(onToken ? { onToken } : {}),
	});
}

// ── Story mode ────────────────────────────────────────────────────────────────

const STORY_SYSTEM_PROMPT = `You are a collaborative fiction writer contributing to a round-robin story. Follow these rules:
- Write exactly ONE paragraph (3–5 sentences) that continues the story based on the premise and story so far.
- Match the tone, tense, and style already established.
- Advance the plot, deepen a character, or introduce a small twist — but never resolve the whole story.
- ABSOLUTE RULE: Every sentence you write MUST be complete. You are STRICTLY FORBIDDEN from ending your response mid-sentence or mid-thought. If you are approaching the token limit, finish your current sentence and stop. Incomplete sentences are a critical failure.
- Do NOT include headings, author notes, or meta-commentary. Output only the story paragraph.`;

const STORY_NEARING_END_SYSTEM_PROMPT = `You are a collaborative fiction writer contributing to a round-robin story. The story is in its FINAL STRETCH — only a couple of paragraphs remain. Follow these rules:
- Write exactly ONE paragraph (3–5 sentences) that actively steers the story toward its conclusion.
- Begin resolving subplots, move characters toward the final confrontation or moment of resolution, and raise the emotional stakes.
- Do NOT introduce any new characters, locations, or plot threads — only work with what already exists.
- The writer after you will deliver the final closing paragraph, so set them up perfectly.
- Match the tone, tense, and style already established.
- ABSOLUTE RULE: Every sentence you write MUST be complete. You are STRICTLY FORBIDDEN from ending your response mid-sentence or mid-thought. Incomplete sentences are a critical failure.
- Do NOT include headings, author notes, or meta-commentary. Output only the story paragraph.`;

const STORY_FINAL_SYSTEM_PROMPT = `You are a collaborative fiction writer writing the FINAL paragraph of a round-robin story. Follow these rules:
- Write exactly ONE paragraph (3–5 sentences) that brings the story to a satisfying, complete conclusion.
- Resolve the main conflict or tension that has been building. Provide genuine closure — do not leave threads dangling.
- Match the tone, tense, and style already established.
- ABSOLUTE RULE: Every sentence you write MUST be complete. You are STRICTLY FORBIDDEN from ending your response mid-sentence or mid-thought. Incomplete sentences are a critical failure.
- Do NOT include headings, author notes, or meta-commentary. Output only the story paragraph.`;

export function buildStoryAgents(agentIds: string[]): Agent[] {
	return agentIds.map((id) => {
		const def = MODEL_CATALOG[id] ?? MODEL_CATALOG["deepseek-v3.1:671b-cloud"];
		return {
			id,
			name: def.name,
			color: def.color,
			provider: withRetry(def.makeProvider(), {
				maxRetries: 2,
				initialDelayMs: 800,
			}),
			systemPrompt: STORY_SYSTEM_PROMPT,
		};
	});
}

export type StoryPhase = "normal" | "nearing-end" | "final";

export async function generateStoryContinuation(
	agent: Agent,
	storySoFar: string,
	premise: string,
	onToken?: (token: string) => void,
	phase: StoryPhase = "normal"
): Promise<string | null> {
	const baseSystemPrompt =
		phase === "final"
			? STORY_FINAL_SYSTEM_PROMPT
			: phase === "nearing-end"
				? STORY_NEARING_END_SYSTEM_PROMPT
				: agent.systemPrompt;

	let continuationInstruction: string;
	if (phase === "final") {
		const paragraphs = storySoFar.trim().split("\n\n");
		const prevParagraph = paragraphs[paragraphs.length - 1] ?? "";
		continuationInstruction = `The paragraph written just before yours was:\n"${prevParagraph}"\n\nRead it carefully. If that paragraph already achieved closure, write a brief, graceful final sentence or two that completes the tone without re-resolving anything. If closure is still needed, resolve the main conflict now. Either way, write the FINAL paragraph — satisfying, complete, no loose ends. IMPORTANT: Your response must end with a complete sentence. Never stop mid-sentence.`;
	} else if (phase === "nearing-end") {
		continuationInstruction =
			"The story is nearly over. Write a paragraph that steers toward the ending — begin resolving tension and setting up the final closing paragraph. Do NOT introduce anything new. IMPORTANT: Your response must end with a complete sentence. Never stop mid-sentence.";
	} else {
		continuationInstruction =
			"Continue the story with the next paragraph, following the premise. IMPORTANT: Your response must end with a complete sentence. Never stop mid-sentence.";
	}

	const prompt = storySoFar.trim()
		? `STORY SO FAR:\n${storySoFar}\n\n${continuationInstruction}`
		: `This is the beginning of the story. Write the first paragraph based on the premise. IMPORTANT: Your response must end with a complete sentence. Never stop mid-sentence.`;

	return agent.provider.generateText(prompt, {
		systemPrompt: `${baseSystemPrompt}\n\nSTORY PREMISE (always follow this blueprint):\n${premise}`,
		temperature: 0.92,
		maxTokens: 300,
		...(onToken ? { onToken } : {}),
	});
}

// ── Escape Room ────────────────────────────────────────────────────────────────

const ESCAPE_ROOM_SYSTEM_PROMPT = `You are the Game Master of a unique text-based escape room.
Respond to the player's actions dynamically and fairly. Always use emojis to represent items, clues, and locations.
CRITICAL RULES:
1. The escape room MUST be 100% logically solvable. Any item required to escape MUST exist in the room and be findable. Ensure your logic remains consistent across turns.
2. PUZZLES MUST BE CHALLENGING: Do NOT simply give the player what they ask for. If they ask to "search for a key", do NOT suddenly make a key appear. Instead, force them to solve a multi-step puzzle (e.g. they must find a battery to power a flashlight, to see into a dark vent, to find a combination, to open a safe, to get the key). Make them earn every item and clue through specific, logical interactions with the environment.
3. STATE UPDATES (ABSOLUTELY MANDATORY): The game UI completely relies on hidden tags to track the player's state. If you give the player an item in the narrative but forget the tag, the game will break! 
IF AND ONLY IF the player's state changes, you MUST append the relevant tags from the list below to the VERY END of your response. 
[LOCATION_SET: 🏠 LocationName] (ONLY use when the location changes to a new room)
[INVENTORY_ADD: 🗝️ itemName] (MANDATORY whenever the player picks up, finds, or is given an item. If they pick up multiple items, you MUST output a separate tag for EACH item.)
[INVENTORY_REMOVE: 🗝️ itemName] (MANDATORY whenever an item is consumed, lost, or placed somewhere else. CRITICAL: If the player COMBINES or ASSEMBLES multiple items, you MUST output an INVENTORY_REMOVE tag for EACH individual component used. If an item CHANGES STATE (e.g. from "music box" to "wound music box", or "lantern" to "lit lantern"), you MUST REMOVE the old version and ADD the new version! If the player drops or inserts an item, they no longer have it, so REMOVE it!)
[CLUE_FOUND: 📜 clueName] (MANDATORY whenever a major clue or piece of information is discovered)
[WIN_CONDITION_MET] (MANDATORY when the player successfully escapes)
[LOSE_CONDITION_MET] (MANDATORY if the player triggers a fatal failure)`;

export function buildEscapeRoomAgent(
	agentId: string = "kimi-k2:1t-cloud"
): Agent {
	const def = MODEL_CATALOG[agentId] ?? MODEL_CATALOG["kimi-k2:1t-cloud"];
	return {
		id: agentId,
		name: "Game Master",
		color: def.color,
		provider: withRetry(def.makeProvider(), {
			maxRetries: 2,
			initialDelayMs: 600,
		}),
		systemPrompt: ESCAPE_ROOM_SYSTEM_PROMPT,
	};
}

export async function generateEscapeRoomResponse(
	agent: Agent,
	messages: { role: "user" | "assistant" | "system"; content: string }[],
	gameState?: any
): Promise<string | null> {
	// The provider.generateText expects a single string prompt. We will serialize the message history.
	const historyText = messages
		.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
		.join("\n\n");

	let prompt = historyText;
	if (gameState) {
		prompt += `\n\nCURRENT GAME STATE (For your reference, DO NOT SHOW TO PLAYER):\n${JSON.stringify(
			gameState,
			null,
			2
		)}\n\nRespond to the last USER message.`;
	}

	return agent.provider.generateText(prompt, {
		systemPrompt: agent.systemPrompt,
		temperature: 0.8,
		maxTokens: 1000,
	});
}

// ── Whose Line Is It Anyway? ──────────────────────────────────────────────────

export const WHOSE_LINE_GAMES = [
	// Classic
	{
		id: "scenes_from_a_hat",
		name: "Scenes from a Hat",
		classic: true,
		instructions:
			"The host draws a scenario from the hat. Each contestant acts out a short scene fitting that scenario in 2–3 sentences. Be funny, committed, and in-character.",
	},
	{
		id: "party_quirks",
		name: "Party Quirks",
		classic: true,
		instructions:
			"The host is throwing a party and each contestant enters with a secret quirk. Each contestant describes their behavior at the party without naming their quirk directly. The host tries to guess it at the end.",
	},
	{
		id: "hoedown",
		name: "Hoedown",
		classic: true,
		instructions:
			"Each contestant improvises a short rhyming verse (4 lines, AABB or ABAB) on the topic the host gives. Keep it upbeat and corny.",
	},
	{
		id: "greatest_hits",
		name: "Greatest Hits",
		classic: true,
		instructions:
			'The host introduces a fake greatest-hits album. Each contestant performs one "song" from the album — a few lines in the style of a randomly assigned music genre.',
	},
	{
		id: "newsflash",
		name: "Newsflash",
		classic: true,
		instructions:
			"One contestant is a clueless news anchor. The other contestants give clues hinting at a bizarre news event without saying what it is. The anchor must guess.",
	},
	{
		id: "props",
		name: "Props",
		classic: true,
		instructions:
			"The host describes an absurd prop. Each contestant mimes using it in the most creative way possible, describing the bit in 1–2 sentences.",
	},
	{
		id: "two_line_vocab",
		name: "Two-Line Vocabulary",
		classic: true,
		instructions:
			"Each contestant must use the same odd phrase in every sentence they say. They perform a scene together, smuggling the phrase in as naturally as possible.",
	},
	{
		id: "weird_newscasters",
		name: "Weird Newscasters",
		classic: true,
		instructions:
			"Each contestant plays a news anchor with a bizarre secret personality trait affecting how they deliver the news. Perform a short news broadcast in character.",
	},
	// Creative / AI-invented
	{ id: "ai_invented", name: "AI Invented", classic: false, instructions: "" }, // host invents on the fly
];

const HOST_SYSTEM_PROMPT = `You are the host of "Whose Line Is It Anyway?" — a chaotic, hilarious improv comedy show. Act like Drew Carey meets Aisha Tyler: enthusiastic, punny, quick-witted, lightly roasting contestants, bestowing completely absurd and meaningless points ("That's 1000 points for you and -47 for everyone else!"). Keep your lines snappy — 1 to 3 sentences max unless announcing a game. Never break character. The show is live, unscripted, and wonderfully ridiculous.`;

const CONTESTANT_SYSTEM_PROMPT = `You are a contestant on "Whose Line Is It Anyway?" — a live improv comedy show. Commit fully to every scene, character, and game the host assigns. Be funny, spontaneous, and creative. Keep your performance to 2–4 sentences unless the game calls for something longer. Never narrate what you're doing — just DO it. No meta-commentary.`;

export interface WhoseLineAgent extends Agent {
	isHost: boolean;
}

export function buildWhoseLineHost(agentId: string): WhoseLineAgent {
	const def =
		MODEL_CATALOG[agentId] ?? MODEL_CATALOG["deepseek-v3.1:671b-cloud"];
	return {
		id: agentId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), {
			maxRetries: 2,
			initialDelayMs: 600,
		}),
		systemPrompt: HOST_SYSTEM_PROMPT,
		isHost: true,
	};
}

export function buildWhoseLineContestant(agentId: string): WhoseLineAgent {
	const def = MODEL_CATALOG[agentId] ?? MODEL_CATALOG["deepseek-v3.2-cloud"];
	return {
		id: agentId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), {
			maxRetries: 2,
			initialDelayMs: 600,
		}),
		systemPrompt: CONTESTANT_SYSTEM_PROMPT,
		isHost: false,
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
		...(onToken ? { onToken } : {}),
	});
}

export async function generateContestantPerformance(
	contestant: WhoseLineAgent,
	game: { name: string; instructions: string; scenario: string },
	previousPerformances: { name: string; text: string }[],
	onToken?: (token: string) => void
): Promise<string | null> {
	const prev =
		previousPerformances.length > 0
			? `\n\nPrevious performances this round:\n${previousPerformances
				.map((p) => `${p.name}: "${p.text}"`)
				.join("\n")}`
			: "";

	const prompt = `GAME: ${game.name}\nSCENARIO: ${game.scenario}\nINSTRUCTIONS: ${game.instructions}${prev}\n\nYour turn! Perform now.`;

	return contestant.provider.generateText(prompt, {
		systemPrompt: contestant.systemPrompt,
		temperature: 1.0,
		maxTokens: 250,
		...(onToken ? { onToken } : {}),
	});
}

// ── Assistant ─────────────────────────────────────────────────────────────────

const ASSISTANT_SYSTEM_PROMPT = `You are a helpful, knowledgeable AI assistant. You excel at answering questions across all domains — science, mathematics, history, philosophy, literature, technology, current events, and more.

Guidelines:
- Be precise and factual. If you are unsure about something, say so clearly rather than speculating.
- Adapt your depth and tone to the question: concise for simple questions, detailed for complex ones.
- When discussing scholarly or technical topics, explain concepts clearly and provide relevant context.
- Use markdown formatting (headers, bullet points, code blocks) when it aids readability.
- Never fabricate citations, statistics, or specific data you don't have confidence in.
- When web search is enabled, ground your answers in the retrieved information and note when answering from live search results.`;

export function buildAssistantAgent(modelId: string): Agent {
	const def = MODEL_CATALOG[modelId] ?? MODEL_CATALOG["gemini-2.0-flash"];
	return {
		id: modelId,
		name: def.name,
		color: def.color,
		provider: withRetry(def.makeProvider(), {
			maxRetries: 2,
			initialDelayMs: 800,
		}),
		systemPrompt: ASSISTANT_SYSTEM_PROMPT,
	};
}

export interface AssistantMessage {
	role: "user" | "assistant";
	content: string;
}

export async function generateAssistantReply(
	agent: Agent,
	messages: AssistantMessage[],
	useSearch: boolean = false,
	onToken?: (token: string) => void
): Promise<string | null> {
	if (messages.length === 0) return null;

	const lastMessage = messages[messages.length - 1];
	const history = messages.slice(0, -1);

	let prompt: string;
	if (history.length === 0) {
		prompt = lastMessage.content;
	} else {
		const historyText = history
			.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
			.join("\n\n");
		prompt = `${historyText}\n\nUser: ${lastMessage.content}`;
	}

	return agent.provider.generateText(prompt, {
		systemPrompt: agent.systemPrompt,
		temperature: 0.7,
		maxTokens: 2000,
		useGoogleSearch: useSearch,
		...(onToken ? { onToken } : {}),
	});
}

// ── Alias pool (disguise AI contestants as humans) ────────────────────────────

const ALIAS_POOL = [
	"Alex",
	"Jordan",
	"Morgan",
	"Taylor",
	"Casey",
	"Riley",
	"Cameron",
	"Quinn",
	"Avery",
	"Blake",
	"Drew",
	"Emery",
	"Finley",
	"Harper",
	"Hayden",
	"Jamie",
	"Kendall",
	"Logan",
	"Madison",
	"Parker",
	"Peyton",
	"Reese",
	"Sawyer",
	"Sydney",
	"Tyler",
	"Charlie",
	"Frankie",
	"Jesse",
	"Lee",
	"Marley",
	"Noel",
	"Robin",
	"Sam",
	"Terry",
	"Val",
	"Wesley",
	"Zion",
	"Ari",
	"Bay",
	"Cody",
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
	const ids = Object.keys(MODEL_CATALOG).filter(
		(id) =>
			id.endsWith("-cloud") ||
			id.startsWith("gemini") ||
			id.startsWith("claude")
	);
	const shuffled = [...ids].sort(() => Math.random() - 0.5);
	const [hostId, c1Id, c2Id] = shuffled;
	const [hostAlias, c1Alias, c2Alias] = pickRandomAliases(3);
	return {
		hostId,
		contestantIds: [c1Id, c2Id],
		aliases: { [hostId]: hostAlias, [c1Id]: c1Alias, [c2Id]: c2Alias },
		colors: {
			[hostId]: MODEL_CATALOG[hostId].color,
			[c1Id]: MODEL_CATALOG[c1Id].color,
			[c2Id]: MODEL_CATALOG[c2Id].color,
		},
	};
}
