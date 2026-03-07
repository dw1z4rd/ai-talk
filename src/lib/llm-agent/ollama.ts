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

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

const body = JSON.stringify({
model: config.model ?? DEFAULT_MODEL,
messages: [
...(options?.systemPrompt != null
? [{ role: 'system', content: options.systemPrompt }]
: []),
{ role: 'user', content: prompt }
],
...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
...(options?.temperature != null ? { temperature: options.temperature } : {}),
stream: !!options?.onToken,
...(config.extraBody ?? {})
});

		try {
			const response = await fetch(url, { method: 'POST', headers, body });

			if (!response.ok) {
				const text = await response.text();
				const safe = config.apiKey ? redactKey(text, config.apiKey) : text;
				console.error(`[Ollama] API Error ${response.status}:`, safe.slice(0, 500));
				return null;
			}

			if (options?.onToken) {
				// Streaming mode — parse OpenAI-compatible SSE
				const reader = response.body!.getReader();
				const decoder = new TextDecoder();
				let buf = '';
				let fullText = '';
				outer: while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					const lines = buf.split('\n');
					buf = lines.pop() ?? '';
					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const payload = line.slice(6).trim();
						if (payload === '[DONE]') break outer;
						try {
const chunk = JSON.parse(payload) as OpenAIResponse & { choices?: Array<{ delta?: { content?: string; reasoning?: string } }> };
const token = (chunk.choices as any)?.[0]?.delta?.content || (chunk.choices as any)?.[0]?.delta?.reasoning || '';
if (token) { fullText += token; options.onToken(token); }
						} catch { /* skip malformed chunks */ }
					}
				}
				return fullText || null;
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
