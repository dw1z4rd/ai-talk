// ─── Generic LLM Provider Interface ──────────────────────────────────────────

/**
 * Options for a text generation request.
 * LLM-agnostic - works with any provider.
 */
export interface LLMOptions {
	/** Maximum number of tokens in the response */
	readonly maxTokens?: number;
	/** Sampling temperature (higher = more creative) */
	readonly temperature?: number;
	/** System prompt to set context or behavior for the model */
	readonly systemPrompt?: string;
/** Called with each streaming token chunk. When provided, the provider streams the response. */
readonly onToken?: (token: string) => void;
/** Enable Google Search grounding (Gemini models only) */
readonly useGoogleSearch?: boolean;
}

/**
 * Generic LLM provider interface.
 * Implement this to plug in any LLM (Gemini, OpenAI, Anthropic, Ollama, etc.).
 */
export interface LLMProvider {
	/**
	 * Generate text from a prompt.
	 * @param prompt - The full prompt text (system + user combined or user-only)
	 * @param options - Generation options (maxTokens, temperature, etc.)
	 * @returns The generated text, or null if the request failed
	 */
	generateText(prompt: string, options?: LLMOptions): Promise<string | null>;
}

// ─── Retry Configuration ────────────────────────────────────────────────────

/**
 * Configuration for the retry wrapper.
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	readonly maxRetries: number;
	/** Initial delay in ms before the first retry (default: 500) */
	readonly initialDelayMs?: number;
	/** Multiplier applied to the delay after each attempt (default: 2) */
	readonly backoffFactor?: number;
	/** Callback invoked on each failed attempt */
	readonly onRetryableFailure?: (attempt: number, error?: unknown) => void;
}

// ─── Ollama-Specific Types ───────────────────────────────────────────────────

export interface OllamaProviderConfig {
/** Base URL of the Ollama server (default: http://localhost:11434) */
readonly baseUrl?: string;
/** Model name, including optional tag e.g. 'deepseek-v3.1:671b-cloud' */
readonly model?: string;
/** Optional bearer token for cloud/remote Ollama instances */
readonly apiKey?: string;
/** Extra fields merged directly into the request body (e.g. { think: false } for Qwen3) */
readonly extraBody?: Record<string, unknown>;
}

// ─── OpenAI-Specific Types ───────────────────────────────────────────────────

export interface OpenAIProviderConfig {
	readonly apiKey: string;
	readonly model?: string;
}

export interface OpenAIMessage {
	readonly role: 'system' | 'user' | 'assistant';
	readonly content: string;
}

export interface OpenAIChoice {
	readonly message: { readonly content: string | null };
}

export interface OpenAIResponse {
	readonly choices?: readonly OpenAIChoice[];
}

// ─── Anthropic-Specific Types ─────────────────────────────────────────────────

export interface AnthropicProviderConfig {
	readonly apiKey: string;
	readonly model?: string;
}

export interface AnthropicContentBlock {
	readonly type: string;
	readonly text?: string;
}

export interface AnthropicResponse {
	readonly content?: readonly AnthropicContentBlock[];
}

// ─── Gemini-Specific Types (for the built-in Gemini provider) ────────────────

/**
 * Gemini API content part
 */
export interface GeminiContentPart {
readonly text?: string;
/** Present on thinking-model parts that contain internal reasoning (should be filtered out) */
readonly thought?: boolean;
}

/**
 * Gemini API content block
 */
export interface GeminiContent {
	readonly role?: string;
	readonly parts: readonly GeminiContentPart[];
}

/**
 * Gemini API response candidate
 */
export interface GeminiCandidate {
	readonly content: {
		readonly parts: readonly GeminiContentPart[];
	};
}

/**
 * Gemini API response
 */
export interface GeminiResponse {
	readonly candidates?: readonly GeminiCandidate[];
}

/**
 * Configuration for the Gemini provider factory
 */
export interface GeminiProviderConfig {
	/** Gemini API key */
	readonly apiKey: string;
	/** Optional model name override (default: gemini-2.0-flash) */
	readonly model?: string;
}
