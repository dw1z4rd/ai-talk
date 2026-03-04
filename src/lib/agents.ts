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
	'llama3.3:70b-cloud': {
		name: 'Llama 3.3 70B',
		color: '#8B5CF6',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'llama3.3:70b' })
	},
	'qwq:32b-cloud': {
		name: 'QwQ 32B',
		color: '#06B6D4',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'qwq:32b' })
	},
	'phi4:14b-cloud': {
		name: 'Phi-4 14B',
		color: '#10B981',
		makeProvider: () => createOllamaProvider({ baseUrl: OLLAMA_CLOUD_URL, apiKey: OLLAMA_CLOUD_API_KEY || undefined, model: 'phi4:14b' })
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
		maxTokens: 300,
		...(onToken ? { onToken } : {})
	});
}
