import type { GeminiResponse, GeminiProviderConfig, LLMProvider, LLMOptions } from './types';
import { redactKey } from './utils';

const DEFAULT_MODEL = 'gemini-2.0-flash';

const buildGeminiUrl = (model: string) =>
	`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * Low-level Gemini API call. Use this for advanced features like tool/function calling.
 * For simple text generation, prefer `createGeminiProvider()` instead.
 *
 * Safely calls the Gemini API, ensuring that sensitive information (like the API key)
 * is never logged to the console, even if the request fails or throws an error.
 */
export async function callGemini<T = GeminiResponse>(
	apiKey: string,
	body: unknown,
	model: string = DEFAULT_MODEL
): Promise<T | null> {
	const url = `${buildGeminiUrl(model)}?key=${apiKey}`;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const text = await response.text();
				console.error(`[Gemini] API Error ${response.status}:`, redactKey(text, apiKey).slice(0, 500));
			return null;
		}

		return await response.json() as T;
	} catch (e: any) {
		console.error('[Gemini] Network Error:', redactKey(e.message || String(e), apiKey));
		return null;
	}
}

/**
 * Extracts the text content from a Gemini API response.
 * Returns null if the response is missing or malformed.
 */
export const extractGeminiText = (data: GeminiResponse | null | undefined): string | null =>
	data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

/**
 * Extracts and cleans the text from a Gemini response,
 * trimming whitespace and removing surrounding quotes.
 */
export const extractCleanGeminiText = (data: GeminiResponse | null | undefined): string | null => {
	const text = extractGeminiText(data);
	return text ? text.trim().replace(/^["']|["']$/g, '') : null;
};

/**
 * Creates an LLMProvider backed by the Google Gemini API.
 *
 * @example
 * ```ts
 * const provider = createGeminiProvider({ apiKey: 'your-api-key' });
 * const text = await provider.generateText('Hello!', { maxTokens: 100 });
 * ```
 */
export const createGeminiProvider = (config: GeminiProviderConfig): LLMProvider => ({
	generateText: async (prompt: string, options?: LLMOptions): Promise<string | null> => {
		const data = await callGemini<GeminiResponse>(
			config.apiKey,
			{
				...(options?.systemPrompt != null
					? { systemInstruction: { parts: [{ text: options.systemPrompt }] } }
					: {}),
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				generationConfig: {
					...(options?.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
					...(options?.temperature != null ? { temperature: options.temperature } : {})
				}
			},
			config.model
		);
		return extractCleanGeminiText(data);
	}
});
