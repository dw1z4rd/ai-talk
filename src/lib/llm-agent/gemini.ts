import type {
  GeminiResponse,
  GeminiProviderConfig,
  LLMProvider,
  LLMOptions,
} from "./types";
import { redactKey } from "./utils";

const DEFAULT_MODEL = "gemini-2.0-flash";

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
  model: string = DEFAULT_MODEL,
  signal?: AbortSignal,
): Promise<T | null> {
  const url = `${buildGeminiUrl(model)}?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[Gemini] API Error ${response.status}:`,
        redactKey(text, apiKey).slice(0, 500),
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.log("[Gemini] Request aborted");
      return null;
    }
    console.error(
      "[Gemini] Network Error:",
      redactKey(e.message || String(e), apiKey),
    );
    return null;
  }
}

/**
 * Extracts the text content from a Gemini API response.
 * Skips thought parts (present on thinking models like gemini-2.5-flash).
 * Returns null if the response is missing or malformed.
 */
export const extractGeminiText = (
  data: GeminiResponse | null | undefined,
): string | null => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  let text = "";
  for (const p of parts) {
    if (!p.thought && p.text != null) text += p.text;
  }
  return text || null;
};

/**
 * Extracts and cleans the text from a Gemini response,
 * trimming whitespace and removing surrounding quotes.
 */
export const extractCleanGeminiText = (
  data: GeminiResponse | null | undefined,
): string | null => {
  const text = extractGeminiText(data);
  return text ? text.trim().replace(/^["']|["']$/g, "") : null;
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
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const buildGeminiBody = (
  prompt: string,
  options?: LLMOptions,
  model?: string,
) => ({
  ...(options?.systemPrompt != null
    ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } }
    : {}),
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    ...(options?.maxTokens != null
      ? { maxOutputTokens: options.maxTokens }
      : {}),
    ...(options?.temperature != null
      ? { temperature: options.temperature }
      : {}),
    ...(model?.includes("2.5")
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : {}),
  },
  safetySettings: SAFETY_SETTINGS,
  ...(options?.useGoogleSearch
    ? {
        tools: [
          model?.includes("1.5")
            ? { googleSearchRetrieval: {} }
            : { google_search: {} },
        ],
      }
    : {}),
});

export const createGeminiProvider = (
  config: GeminiProviderConfig,
): LLMProvider => ({
  generateText: async (
    prompt: string,
    options?: LLMOptions,
  ): Promise<string | null> => {
    if (options?.onToken) {
      // Streaming mode — use streamGenerateContent with SSE
      const model = config.model ?? DEFAULT_MODEL;
      const url = `${buildGeminiUrl(model)}?alt=sse&key=${config.apiKey}`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: options?.signal,
          body: JSON.stringify(buildGeminiBody(prompt, options, model)),
        });
        if (!response.ok) {
          const text = await response.text();
          console.error(
            `[Gemini] Stream Error ${response.status}:`,
            redactKey(text, config.apiKey).slice(0, 500),
          );
          return null;
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush decoder and process any data remaining in the buffer
            const remaining = (buf + decoder.decode()).trim();
            if (remaining.startsWith("data: ")) {
              try {
                const chunk = JSON.parse(remaining.slice(6)) as GeminiResponse;
                const parts = chunk.candidates?.[0]?.content?.parts;
                if (parts) {
                  let token = "";
                  for (const p of parts) {
                    if (!p.thought && p.text) token += p.text;
                  }
                  if (token) {
                    fullText += token;
                    options.onToken(token);
                  }
                }
              } catch {
                /* skip malformed final chunk */
              }
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const chunk = JSON.parse(line.slice(6)) as GeminiResponse;
              const parts = chunk.candidates?.[0]?.content?.parts;
              if (parts) {
                let token = "";
                for (const p of parts) {
                  if (!p.thought && p.text) token += p.text;
                }
                if (token) {
                  fullText += token;
                  options.onToken(token);
                }
              }
            } catch {
              /* skip malformed chunks */
            }
          }
        }
        return fullText || null;
      } catch (e: any) {
        if (e.name === "AbortError") {
          console.log("[Gemini] Stream aborted");
          return null;
        }
        console.error(
          "[Gemini] Stream Network Error:",
          redactKey(e.message || String(e), config.apiKey),
        );
        return null;
      }
    }

    const data = await callGemini<GeminiResponse>(
      config.apiKey,
      buildGeminiBody(prompt, options, config.model),
      config.model,
      options?.signal,
    );
    return extractCleanGeminiText(data);
  },
});
