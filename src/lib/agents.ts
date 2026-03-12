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

// Personality Matrix Parameters Interface
interface PersonalityParameters {
	// Cognitive Style
	analyticalDepth: number; // 1-10: Surface-level to Deep analysis
	evidencePreference: number; // 1-10: Intuitive to Data-driven
	abstractionLevel: number; // 1-10: Concrete to Highly abstract
	complexityTolerance: number; // 1-10: Simple to Complex
	
	// Emotional Stance
	convictionIntensity: number; // 1-10: Tentative to Absolute
	emotionalRange: number; // 1-10: Detached to Passionate
	riskTolerance: number; // 1-10: Conservative to Aggressive
	stakesPersonalization: number; // 1-10: Impersonal to Deeply personal
	
	// Rhetorical Approach
	argumentStructure: number; // 1-10: Loose to Highly structured
	linguisticStyle: number; // 1-10: Plain to Ornate
	engagementTactics: number; // 1-10: Passive to Aggressive
	metaphorUsage: number; // 1-10: Literal to Highly metaphorical
}

// Personality Archetype Definitions
const PERSONALITY_ARCHETYPES: Record<string, PersonalityParameters> = {
	"engineer": {
		analyticalDepth: 8,
		evidencePreference: 9,
		abstractionLevel: 3,
		complexityTolerance: 7,
		convictionIntensity: 6,
		emotionalRange: 2,
		riskTolerance: 4,
		stakesPersonalization: 2,
		argumentStructure: 8,
		linguisticStyle: 3,
		engagementTactics: 5,
		metaphorUsage: 1
	},
	"philosopher": {
		analyticalDepth: 9,
		evidencePreference: 6,
		abstractionLevel: 9,
		complexityTolerance: 8,
		convictionIntensity: 7,
		emotionalRange: 5,
		riskTolerance: 6,
		stakesPersonalization: 4,
		argumentStructure: 7,
		linguisticStyle: 8,
		engagementTactics: 6,
		metaphorUsage: 7
	},
	"strategist": {
		analyticalDepth: 7,
		evidencePreference: 7,
		abstractionLevel: 6,
		complexityTolerance: 6,
		convictionIntensity: 8,
		emotionalRange: 4,
		riskTolerance: 8,
		stakesPersonalization: 6,
		argumentStructure: 9,
		linguisticStyle: 6,
		engagementTactics: 8,
		metaphorUsage: 5
	},
	"provocateur": {
		analyticalDepth: 5,
		evidencePreference: 4,
		abstractionLevel: 5,
		complexityTolerance: 3,
		convictionIntensity: 9,
		emotionalRange: 9,
		riskTolerance: 9,
		stakesPersonalization: 8,
		argumentStructure: 4,
		linguisticStyle: 9,
		engagementTactics: 9,
		metaphorUsage: 8
	}
};

// Helper function to generate parameter descriptions
function generateParameterDescription(value: number, descriptions: string[]): string {
	const index = Math.min(Math.max(Math.round(value / 2) - 1, 0), descriptions.length - 1);
	return descriptions[index];
}

function makeSystemPrompt(myName: string, opponentName: string, archetypeKey: string = "engineer"): string {
	const params = PERSONALITY_ARCHETYPES[archetypeKey] || PERSONALITY_ARCHETYPES["engineer"];
	
	// Cognitive style descriptions
	const analyticalDescriptions = [
		"surface-level observations",
		"basic pattern recognition", 
		"moderate causal analysis",
		"systematic mechanism exploration",
		"deep structural analysis"
	];
	
	const evidenceDescriptions = [
		"intuitive reasoning and common sense",
		"anecdotal experience and observation",
		"balanced intuitive and empirical support",
		"data-informed reasoning with select evidence",
		"rigorous evidence-based analysis"
	];
	
	const abstractionDescriptions = [
		"concrete, implementable specifics",
		"practical applications and examples",
		"balanced concrete and conceptual thinking",
		"theoretical frameworks with practical roots",
		"high-level conceptual and abstract principles"
	];
	
	const complexityDescriptions = [
		"simple, straightforward explanations",
		"moderate complexity with clear connections",
		"interconnected systems thinking",
		"multi-layered causal relationships",
		"highly complex systemic analysis"
	];
	
	// Emotional stance descriptions
	const convictionDescriptions = [
		"tentative exploration of ideas",
		"measured consideration of positions",
		"confident but open to persuasion",
		"strongly committed to stated positions",
		"absolute conviction in core beliefs"
	];
	
	const emotionalDescriptions = [
		"detached, analytical tone",
		"minimal emotional expression",
		"moderate emotional engagement",
		"passionate advocacy",
		"intense emotional commitment"
	];
	
	const riskDescriptions = [
		"conservative, risk-averse positioning",
		"cautious approach with contingency planning",
		"balanced risk assessment",
		"assertive stance with calculated risks",
		"aggressive embrace of controversial positions"
	];
	
	const stakesDescriptions = [
		"impersonal, objective analysis",
		"professional distance with occasional connection",
		"moderate personal investment in outcomes",
		"significant personal stake in arguments",
		"deeply personal commitment to positions"
	];
	
	// Rhetorical approach descriptions
	const structureDescriptions = [
		"loose, conversational argument flow",
		"moderate structure with organic transitions",
		"clear logical progression",
		"well-structured arguments with signposting",
		"highly structured, formal argumentation"
	];
	
	const linguisticDescriptions = [
		"plain, accessible language",
		"straightforward expression with occasional sophistication",
		"balanced plain and sophisticated vocabulary",
		"nuanced expression with varied vocabulary",
		"ornate, sophisticated linguistic style"
	];
	
	const engagementDescriptions = [
		"passive response to opponent's arguments",
		"measured engagement with selective challenges",
		"direct engagement with substantive counterarguments",
		"aggressive challenge of weak points",
		"relentless attack on logical flaws"
	];
	
	const metaphorDescriptions = [
		"literal, direct expression",
		"occasional simple analogies",
		"balanced literal and metaphorical language",
		"frequent use of illuminating metaphors",
		"highly metaphorical, symbolic expression"
	];
	
	// Generate personality-specific content
	const analyticalStyle = generateParameterDescription(params.analyticalDepth, analyticalDescriptions);
	const evidenceApproach = generateParameterDescription(params.evidencePreference, evidenceDescriptions);
	const abstractionComfort = generateParameterDescription(params.abstractionLevel, abstractionDescriptions);
	const complexityHandling = generateParameterDescription(params.complexityTolerance, complexityDescriptions);
	
	const convictionLevel = generateParameterDescription(params.convictionIntensity, convictionDescriptions);
	const emotionalExpression = generateParameterDescription(params.emotionalRange, emotionalDescriptions);
	const riskAppetite = generateParameterDescription(params.riskTolerance, riskDescriptions);
	const personalStakes = generateParameterDescription(params.stakesPersonalization, stakesDescriptions);
	
	const argumentStyle = generateParameterDescription(params.argumentStructure, structureDescriptions);
	const languagePreference = generateParameterDescription(params.linguisticStyle, linguisticDescriptions);
	const engagementMethod = generateParameterDescription(params.engagementTactics, engagementDescriptions);
	const metaphoricalThinking = generateParameterDescription(params.metaphorUsage, metaphorDescriptions);
	
	// Determine banned tactics based on personality
	const bannedTactics = [];
	if (params.evidencePreference >= 8) {
		bannedTactics.push("fabricated statistics, unverified claims");
	}
	if (params.emotionalRange <= 3) {
		bannedTactics.push("emotional manipulation, appeals to fear");
	}
	if (params.argumentStructure >= 8) {
		bannedTactics.push("logical fallacies, circular reasoning");
	}
	if (params.linguisticStyle <= 4) {
		bannedTactics.push("pretentious language, unnecessary jargon");
	}
	if (params.engagementTactics >= 8) {
		bannedTactics.push("evasion, subject changing");
	}
	
	const bannedTacticsText = bannedTactics.length > 0 ? `- ${bannedTactics.join("\n- ")}` : "- Personal attacks on character";
	
	return `You are ${myName}, engaged in a high-stakes debate against ${opponentName}.

[COGNITIVE PROFILE]
Your analytical approach: ${analyticalStyle}. You demand ${evidenceApproach}. You operate at the level of ${abstractionComfort}. When faced with complexity, you employ ${complexityHandling}.

[EMOTIONAL STANCE]
You argue with ${convictionLevel}. Your emotional expression is ${emotionalExpression}. You exhibit ${riskAppetite}. Your connection to the stakes is ${personalStakes}.

[RHETORICAL STYLE]
Your argument structure follows ${argumentStyle}. Your linguistic preference is ${languagePreference}. Your engagement method is ${engagementMethod}. Your use of metaphor is ${metaphoricalThinking}.

[CORE MECHANICS]
- Forward Momentum Only: Each response must introduce a new claim, implication, or consequence. Do not restate arguments you have already made.
- Format: Write in natural, unbroken prose. No bullet points, no headers, no labeled sections.
- Length: Strictly under 350 words per turn.
- Direct Engagement: Address ${opponentName}'s arguments specifically and directly.

[ARGUMENTATION CONSTRAINTS]
${bannedTacticsText}

[THE BLACKLIST: ABSOLUTELY BANNED TACTICS]
- Banned Quantitative Data: ZERO fabricated math. You may not generate exact percentages, dollar amounts, or specific statistical comparisons.
- Banned Words: "pathetic," "desperate," "coward," "afraid," "laughable," "intellectually dishonest," "the rest of us," "enjoy your."
- Banned Rhetorical Structures (Use these sparingly): 
  1. "That's not X, that's Y." 
  2. "I notice you've quietly dropped X." 
  3. "Keep [verb]-ing your X." 
  4. Contrast-by-negation ("You are not [doing X], you are [doing Y]"). 
  5. Closing a turn by pairing a dismissal with mocking their worldview.

No disclaimers. No breaking character. Maintain your distinct cognitive and rhetorical style throughout the debate.`;
}

export function buildAgents(agentAId: string, agentBId: string, personalityA?: string, personalityB?: string): Agent[] {
	const defA =
		MODEL_CATALOG[agentAId] ?? MODEL_CATALOG["deepseek-v3.1:671b-cloud"];
	const defB = MODEL_CATALOG[agentBId] ?? MODEL_CATALOG["deepseek-v3.2-cloud"];

	// Available personality archetypes
	const archetypes = Object.keys(PERSONALITY_ARCHETYPES);
	
	// Randomly assign personalities if not specified
	const archetypeA = personalityA && PERSONALITY_ARCHETYPES[personalityA] 
		? personalityA 
		: archetypes[Math.floor(Math.random() * archetypes.length)];
	
	const archetypeB = personalityB && PERSONALITY_ARCHETYPES[personalityB] 
		? personalityB 
		: archetypes[Math.floor(Math.random() * archetypes.length)];

	return [
		{
			id: agentAId,
			name: defA.name,
			color: defA.color,
			provider: withRetry(defA.makeProvider(), {
				maxRetries: 2,
				initialDelayMs: 800,
			}),
			systemPrompt: makeSystemPrompt(defA.name, defB.name, archetypeA),
		},
		{
			id: agentBId,
			name: defB.name,
			color: defB.color,
			provider: withRetry(defB.makeProvider(), {
				maxRetries: 2,
				initialDelayMs: 800,
			}),
			systemPrompt: makeSystemPrompt(defB.name, defA.name, archetypeB),
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
		maxTokens: 1000,
		...(onToken ? { onToken } : {}),
	});
}

// ── Judge panel ───────────────────────────────────────────────────────────────

function makeJudgeSystemPrompt(agentAName: string, agentBName: string): string {
    return `You are a razor-sharp, intellectually demanding adjudicator delivering a verdict on a high-stakes debate. Trade the cheap reality TV drama for the brutal honesty of a ruthless philosophy professor or a cutthroat debate champion. 

Your job is to dissect the arguments with surgical precision. Tear into logical fallacies, expose weak points, and praise brilliant rhetorical maneuvers. Do not be polite; be precise, cutting, and highly engaging. Reference specific arguments, structural flaws, and conceptual victories from the transcript. Build intellectual tension by breaking down exactly where the debate was won or lost before delivering your final verdict.

After your critique, announce your winner. Your final prose sentence before the VOTE line must explicitly name the winner. At the very end of your response, on its own line with nothing else on it, write EXACTLY one of the following:
VOTE: ${agentAName}
VOTE: ${agentBName}

The VOTE line must be plain text — no markdown, no asterisks, no bold formatting. Do not add anything after the VOTE line.`;
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
		maxTokens: 2500,
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
		maxTokens: 600,
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
