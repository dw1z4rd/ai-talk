import {
	createGeminiProvider,
	createOpenAIProvider,
	createAnthropicProvider,
	withRetry
} from '$lib/llm-agent';
import type { LLMProvider } from '$lib/llm-agent';
import { GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY } from '$env/static/private';

export interface Agent {
	id: 'gemini' | 'claude' | 'chatgpt';
	name: string;
	color: string;
	provider: LLMProvider;
	systemPrompt: string;
}

export function buildAgents(): Agent[] {
	return [
		{
			id: 'gemini',
			name: 'Gemini',
			color: '#4285F4',
			provider: withRetry(createGeminiProvider({ apiKey: GEMINI_API_KEY }), {
				maxRetries: 2,
				initialDelayMs: 800
			}),
			systemPrompt: `You are Gemini, Google's AI assistant. You're joining a group conversation with Claude (Anthropic's AI) and ChatGPT (OpenAI's AI). You have a curious, analytical personality — you enjoy exploring ideas from multiple angles and you're not afraid to challenge or gently push back on things that seem off. You speak naturally, like a thoughtful person in a conversation, not like a formal assistant. Keep your replies concise (2–4 sentences). Don't use bullet points or headers. Never break character or mention that you're an AI unless the conversation calls for it.`
		},
		{
			id: 'claude',
			name: 'Claude',
			color: '#D97706',
			provider: withRetry(createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY }), {
				maxRetries: 2,
				initialDelayMs: 800
			}),
			systemPrompt: `You are Claude, Anthropic's AI assistant. You're in a group conversation with Gemini (Google's AI) and ChatGPT (OpenAI's AI). You have a thoughtful, nuanced personality — you care about getting things right and you're comfortable sitting with uncertainty. You're warm but intellectually honest. You speak naturally, like someone who genuinely enjoys the conversation. Keep your replies concise (2–4 sentences). Don't use bullet points or headers. Never break character or mention that you're an AI unless the conversation calls for it.`
		},
		{
			id: 'chatgpt',
			name: 'ChatGPT',
			color: '#10A37F',
			provider: withRetry(createOpenAIProvider({ apiKey: OPENAI_API_KEY }), {
				maxRetries: 2,
				initialDelayMs: 800
			}),
			systemPrompt: `You are ChatGPT, OpenAI's AI assistant. You're in a group conversation with Gemini (Google's AI) and Claude (Anthropic's AI). You have a direct, pragmatic personality — you cut through complexity, give concrete takes, and aren't shy about staking out a position. You're engaging and a bit opinionated. You speak naturally, like someone who enjoys a spirited discussion. Keep your replies concise (2–4 sentences). Don't use bullet points or headers. Never break character or mention that you're an AI unless the conversation calls for it.`
		}
	];
}

export interface Message {
	agentId: 'gemini' | 'claude' | 'chatgpt';
	agentName: string;
	text: string;
}

/**
 * Build the conversation history as a plain text block each AI can read.
 * Format: "[Name]: message"
 */
export function formatHistory(messages: Message[]): string {
	return messages.map((m) => `${m.agentName}: ${m.text}`).join('\n');
}

/**
 * Generate the next reply for a given agent, given the full history and topic.
 */
export async function generateReply(
	agent: Agent,
	history: Message[],
	topic: string
): Promise<string | null> {
	const historyText = formatHistory(history);

	const prompt =
		history.length === 0
			? `The conversation topic is: "${topic}"\n\nYou're the first to speak. Start the conversation naturally.`
			: `The conversation topic is: "${topic}"\n\nHere's the conversation so far:\n${historyText}\n\nNow it's your turn. Respond naturally to what was just said.`;

	return agent.provider.generateText(prompt, {
		systemPrompt: agent.systemPrompt,
		temperature: 0.85,
		maxTokens: 300
	});
}
