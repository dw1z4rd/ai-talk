import type { LLMProvider, LLMOptions, OllamaProviderConfig, OpenAIResponse } from './types';
import { redactKey } from './utils';

const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * Creates an LLMProvider backed by an Ollama instance.
 * Uses Ollama's OpenAI-compatible `/v1/chat/completions` endpoint so it works
 * with both local installs and cloud-hosted Ollama servers.
 *
 * @example
 * ```ts
 * // Local
 * const provider = createOllamaProvider({ model: 'llama3.2' });
 *
 * // Remote / cloud
 * const provider = createOllamaProvider({
 *   baseUrl: 'https://my-ollama.example.com',
 *   model: 'mistral',
 *   apiKey: 'optional-bearer-token'
 * });
 * ```
 */
export const createOllamaProvider = (config: OllamaProviderConfig = {}): LLMProvider => ({
	generateText: async (prompt: string, options?: LLMOptions): Promise<string | null> => {
		const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
		const url = `${baseUrl}/v1/chat/completions`;

		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (config.apiKey) {
				headers['Authorization'] = `Bearer ${config.apiKey}`;
			}

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					model: config.model ?? DEFAULT_MODEL,
					messages: [
						...(options?.systemPrompt != null
							? [{ role: 'system', content: options.systemPrompt }]
							: []),
						{ role: 'user', content: prompt }
					],
					...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
					...(options?.temperature != null ? { temperature: options.temperature } : {}),
					stream: false
				})
			});

			if (!response.ok) {
				const text = await response.text();
				const safe = config.apiKey ? redactKey(text, config.apiKey) : text;
				console.error(`[Ollama] API Error ${response.status}:`, safe.slice(0, 500));
				return null;
			}

			const data = (await response.json()) as OpenAIResponse;
			return data.choices?.[0]?.message?.content ?? null;
		} catch (e: any) {
			const msg = e.message || String(e);
			const safe = config.apiKey ? redactKey(msg, config.apiKey) : msg;
			console.error(`[Ollama] Network Error: Unable to connect to ${url}. Is the server reachable? (${safe})`);
			return null;
		}
	}
});
