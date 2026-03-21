import type { LLMProvider, LLMOptions, OpenAIProviderConfig, OpenAIResponse } from './types';
import { redactKey } from './utils';

const DEFAULT_MODEL = 'gpt-4o';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Creates an LLMProvider backed by the OpenAI API.
 * Handles systemPrompt via a system message prepended to the messages array.
 *
 * @example
 * ```ts
 * const provider = createOpenAIProvider({ apiKey: 'your-api-key' });
 * const text = await provider.generateText('Hello!', { maxTokens: 100 });
 * ```
 */
export const createOpenAIProvider = (config: OpenAIProviderConfig): LLMProvider => ({
	generateText: async (prompt: string, options?: LLMOptions): Promise<string | null> => {
		try {
			const response = await fetch(OPENAI_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.apiKey}`
				},
				signal: options?.signal,
			body: JSON.stringify({
					model: config.model ?? DEFAULT_MODEL,
					messages: [
						...(options?.systemPrompt != null
							? [{ role: 'system', content: options.systemPrompt }]
							: []),
						{ role: 'user', content: prompt }
					],
					...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
					...(options?.temperature != null ? { temperature: options.temperature } : {})
				})
			});

			if (!response.ok) {
				const text = await response.text();
				console.error(
					`[OpenAI] API Error ${response.status}:`,
					redactKey(text, config.apiKey).slice(0, 500)
				);
				return null;
			}

			const data = (await response.json()) as OpenAIResponse;
			return data.choices?.[0]?.message?.content ?? null;
		} catch (e: any) {
			if (e.name === 'AbortError') { console.log('[OpenAI] Request aborted'); return null; }
			console.error('[OpenAI] Network Error:', redactKey(e.message || String(e), config.apiKey));
			return null;
		}
	}
});
