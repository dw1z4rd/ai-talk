import type { LLMProvider, LLMOptions, RetryConfig } from './types';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_BACKOFF_FACTOR = 2;

/**
 * Wraps an LLMProvider with automatic retry logic and exponential backoff.
 * Returns a new LLMProvider that retries on empty/null responses.
 *
 * @param provider - Any LLMProvider implementation
 * @param config - Optional retry configuration
 * @returns A new LLMProvider that retries failed attempts
 *
 * @example
 * ```ts
 * const provider = createGeminiProvider({ apiKey: 'key' });
 * const reliable = withRetry(provider, { maxRetries: 3, initialDelayMs: 500, backoffFactor: 2 });
 * const text = await reliable.generateText('Hello!');
 * ```
 */
export const withRetry = (provider: LLMProvider, config?: RetryConfig): LLMProvider => ({
	generateText: async (prompt: string, options?: LLMOptions): Promise<string | null> => {
		// Streaming calls can't be retried after tokens have already been emitted
		if (options?.onToken) return provider.generateText(prompt, options);

		const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
		const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
		const backoffFactor = config?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const text = await provider.generateText(prompt, options);
				if (text && text.length > 0) {
					return text;
				}
				config?.onRetryableFailure?.(attempt);
			} catch (e) {
				config?.onRetryableFailure?.(attempt, e);
			}

			if (attempt < maxRetries) {
				const delay = initialDelayMs * backoffFactor ** (attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		return null;
	}
});

/**
 * Wraps an LLMProvider to set a default system prompt on every request.
 * The `systemPrompt` is passed via `options` so providers can handle it
 * natively (e.g. Gemini sends it as `systemInstruction`).
 *
 * Call-time `options.systemPrompt` takes precedence over the bound default.
 *
 * **Note for custom provider implementors:** `LLMProvider.generateText` is
 * expected to respect `options.systemPrompt`. If your implementation ignores
 * it, this wrapper will have no effect.
 *
 * @example
 * ```ts
 * const agent = withSystemPrompt(provider, 'You are a helpful assistant.');
 * const text = await agent.generateText('What is 2+2?');
 * ```
 */
export const withSystemPrompt = (provider: LLMProvider, systemPrompt: string): LLMProvider => ({
	generateText: (prompt: string, options?: LLMOptions) =>
		provider.generateText(prompt, {
			...options,
			systemPrompt: options?.systemPrompt ?? systemPrompt
		})
});
