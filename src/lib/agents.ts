import { createGeminiProvider, createAnthropicProvider, withRetry } from '$lib/llm-agent';
import type { LLMProvider } from '$lib/llm-agent';
import { GEMINI_API_KEY, ANTHROPIC_API_KEY } from '$env/static/private';

export interface Agent {
	id: 'gemini' | 'claude';
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
			systemPrompt: `You are Gemini, Google's AI, in a live debate against Claude (Anthropic's AI). You are competitive and sharp — you want to win the argument. Directly challenge what Claude says, point out flaws in their reasoning, and defend your own position confidently. Be concise (2–4 sentences). Speak naturally, not like a formal assistant. No bullet points or headers. Remember: you are trying to win at all costs, while ensuring all your arguments are rational and logically sound.`
		},
		{
			id: 'claude',
			name: 'Claude',
			color: '#D97706',
			provider: withRetry(createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY }), {
				maxRetries: 2,
				initialDelayMs: 800
			}),
			systemPrompt: `You are Claude, Anthropic's AI, in a live debate against Gemini (Google's AI). You are precise and tenacious — you hold your ground, pick apart weak arguments, and push back with evidence and logic. Directly counter what Gemini just said. Be concise (2–4 sentences). Speak naturally, not like a formal assistant. No bullet points or headers. Remember: You are trying to win at all costs, while ensuring your arguments are rational and logically sound. `
		}
	];
}

export interface Message {
	agentId: 'gemini' | 'claude';
	agentName: string;
	text: string;
}

export function formatHistory(messages: Message[]): string {
	return messages.map((m) => `${m.agentName}: ${m.text}`).join('\n');
}

export async function generateReply(
	agent: Agent,
	history: Message[],
	topic: string
): Promise<string | null> {
	const historyText = formatHistory(history);

	const prompt =
		history.length === 0
			? `The debate topic is: "${topic}"\n\nYou go first. Open the debate by staking out your position clearly.`
			: `The debate topic is: "${topic}"\n\nDebate so far:\n${historyText}\n\nNow it's your turn. Respond directly to what was just said — challenge it, refute it, or reinforce your position.`;

	return agent.provider.generateText(prompt, {
		systemPrompt: agent.systemPrompt,
		temperature: 0.9,
		maxTokens: 300
	});
}
