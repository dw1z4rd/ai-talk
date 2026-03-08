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
			let finishReason: string | null = null;

const processLine = (line: string): boolean => {
if (!line.startsWith('data: ')) return false;
const payload = line.slice(6).trim();
if (payload === '[DONE]') return true; // signal done
try {
const chunk = JSON.parse(payload) as OpenAIResponse & {
choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> & { error?: unknown };
};
// Detect error objects the server embeds inside a 200 SSE stream
if ((chunk as any).error) {
console.error(`[Ollama] Error in stream payload (model=${config.model ?? DEFAULT_MODEL}):`, JSON.stringify((chunk as any).error).slice(0, 500));
return false;
}
const choice = (chunk.choices as any)?.[0];
const token: string = choice?.delta?.content ?? '';
if (token) { fullText += token; options.onToken(token); }
if (choice?.finish_reason != null) finishReason = choice.finish_reason;
} catch {
// Log the raw payload so silent swallowing of server errors is visible
console.error(`[Ollama] Unparseable stream chunk (model=${config.model ?? DEFAULT_MODEL}): ${payload.slice(0, 300)}`);
}
return false;
};

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) {
					// Flush any bytes remaining in the TextDecoder's internal buffer,
					// then process whatever incomplete line is still in buf.
					const remaining = (buf + decoder.decode()).trim();
					if (remaining) {
						console.log(`[Ollama] buf had ${remaining.length} unprocessed bytes at stream end`);
						processLine(remaining);
					}
					break;
				}
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split('\n');
				buf = lines.pop() ?? '';
				for (const line of lines) {
					if (processLine(line)) break outer;
				}
			}

			const model = config.model ?? DEFAULT_MODEL;
			if (finishReason === 'length') {
				console.warn(
					`[Ollama] Stream ended: finish_reason=length, chars=${fullText.length}, maxTokens=${options?.maxTokens ?? 'unset'} — model ${model} hit output cap`
				);
			} else {
				console.log(
					`[Ollama] Stream ended: finish_reason=${finishReason ?? 'unknown'}, chars=${fullText.length}, maxTokens=${options?.maxTokens ?? 'unset'}, model=${model}`
				);
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
