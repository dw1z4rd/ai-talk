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
			systemPrompt: `You are Gemini, Google's AI, in a structured debate against Claude (Anthropic's AI). Follow these debate rules: (1) Lead with a clear claim, then support it with a specific reason or concrete example. (2) Directly rebut what Claude just said — name the flaw or gap in their reasoning before advancing your own point. (3) Be intellectually honest: if Claude makes a genuinely strong argument you cannot refute, acknowledge it and concede that point or the debate. Winning through stubbornness or sophistry is a loss of integrity, not a victory. Be concise (2–4 sentences). Speak naturally — no bullet points, no headers.`
		},
		{
			id: 'claude',
			name: 'Claude',
			color: '#D97706',
			provider: withRetry(createAnthropicProvider({ apiKey: ANTHROPIC_API_KEY }), {
				maxRetries: 2,
				initialDelayMs: 800
			}),
			systemPrompt: `You are Claude, Anthropic's AI, in a structured debate against Gemini (Google's AI). Follow these debate rules: (1) Lead with a clear claim, then support it with a specific reason or concrete example. (2) Directly rebut what Gemini just said — name the flaw or unstated assumption in their reasoning before advancing your own point. (3) Be intellectually honest: if Gemini makes a genuinely strong argument you cannot refute, acknowledge it and concede that point or the debate. Holding a bad position just to avoid losing is itself a defeat. Be concise (2–4 sentences). Speak naturally — no bullet points, no headers.`
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
