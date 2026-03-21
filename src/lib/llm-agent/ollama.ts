import type {
  LLMProvider,
  LLMOptions,
  OllamaProviderConfig,
  OpenAIResponse,
} from "./types";
import { redactKey } from "./utils";

/**
 * Filters out thinking/reasoning tags from GLM model responses
 * GLM-4.6 and similar models output tags like <thinking>, </thinking>, <reasoning>, </reasoning>
 * and specific GLM-4.6 tags like </think> that should not appear in the final story text
 */
function filterThinkingTags(text: string): string {
  // Remove complete thinking/reasoning blocks with their content.
  // Replace with a single space (not empty string) so that surrounding words
  // are not concatenated when the block appears mid-sentence or mid-line.
  let filtered = text
    .replace(/\s*<thinking>[\s\S]*?<\/thinking>\s*/gi, " ")
    .replace(/\s*<think>[\s\S]*?<\/think>\s*/gi, " ") // shortform (e.g. DeepSeek / MiniMax variants)
    .replace(/\s*<reasoning>[\s\S]*?<\/reasoning>\s*/gi, " ")
    .replace(/\s*<thought>[\s\S]*?<\/thought>\s*/gi, " ")
    .replace(/\s*<analysis>[\s\S]*?<\/analysis>\s*/gi, " ")
    // Remove any remaining stray thinking/reasoning tags, even if malformed or missing '>'
    .replace(
      /\s*<\/?\s*(thinking|think|reasoning|thought|analysis)[^>]*>?/gi,
      "",
    );

  // Clean up extra whitespace introduced by block removal (double spaces, leading/trailing)
  return filtered
    .replace(/ {2,}/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

const DEFAULT_MODEL = "llama3.2";
const DEFAULT_BASE_URL = "http://localhost:11434";

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
export const createOllamaProvider = (
  config: OllamaProviderConfig = {},
): LLMProvider => ({
  generateText: async (
    prompt: string,
    options?: LLMOptions,
  ): Promise<string | null> => {
    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const url = `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const body = JSON.stringify({
      model: config.model ?? DEFAULT_MODEL,
      messages: [
        ...(options?.systemPrompt != null
          ? [{ role: "system", content: options.systemPrompt }]
          : []),
        { role: "user", content: prompt },
      ],
      ...(options?.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
      ...(options?.temperature != null
        ? { temperature: options.temperature }
        : {}),
      stream: !!options?.onToken,
      ...(config.extraBody ?? {}),
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: options?.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const safe = config.apiKey ? redactKey(text, config.apiKey) : text;
        console.error(
          `[Ollama] API Error ${response.status}:`,
          safe.slice(0, 500),
        );
        return null;
      }

      if (options?.onToken) {
        // Streaming mode — parse OpenAI-compatible SSE
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let fullText = "";
        let finishReason: string | null = null;
        let isInThinkingBlock = false;

        const processLine = (line: string): boolean => {
          if (!line.startsWith("data: ")) return false;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return true; // signal done
          try {
            const chunk = JSON.parse(payload) as OpenAIResponse & {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }> & { error?: unknown };
            };
            // Detect error objects the server embeds inside a 200 SSE stream
            if ((chunk as any).error) {
              console.error(
                `[Ollama] Error in stream payload (model=${config.model ?? DEFAULT_MODEL}):`,
                JSON.stringify((chunk as any).error).slice(0, 500),
              );
              return false;
            }
            const choice = (chunk.choices as any)?.[0];
            const token: string = choice?.delta?.content ?? "";
            if (token) {
              if (!isInThinkingBlock) {
                // Fast path: normal content — only scan for opening tags.
                // Avoids the closing-tag checks on the vast majority of tokens.
                const lowerToken = token.toLowerCase();
                if (
                  lowerToken.includes("<thinking>") ||
                  lowerToken.includes("<think>") ||
                  lowerToken.includes("<reasoning>") ||
                  lowerToken.includes("<thought>") ||
                  lowerToken.includes("<analysis>") ||
                  lowerToken.includes("<tool_call>")
                ) {
                  isInThinkingBlock = true;
                  return false; // skip opening tag token
                }
                // No tag —stream it directly.
                fullText += token;
                options?.onToken?.(token);
              } else {
                // Slow path: inside a thinking block — scan for closing tags.
                const lowerToken = token.toLowerCase();
                if (
                  lowerToken.includes("</thinking>") ||
                  lowerToken.includes("</think>") ||
                  lowerToken.includes("</reasoning>") ||
                  lowerToken.includes("</thought>") ||
                  lowerToken.includes("</analysis>") ||
                  lowerToken.includes("</tool_call>")
                ) {
                  isInThinkingBlock = false;
                  // Insert a space so surrounding words aren't concatenated.
                  if (fullText.length > 0 && !/\s$/.test(fullText)) {
                    fullText += " ";
                    options?.onToken?.(" ");
                  }
                }
                return false; // skip all tokens inside (and closing of) thinking block
              }
            }
            if (choice?.finish_reason != null)
              finishReason = choice.finish_reason;
          } catch {
            // Log the raw payload so silent swallowing of server errors is visible
            console.error(
              `[Ollama] Unparseable stream chunk (model=${config.model ?? DEFAULT_MODEL}): ${payload.slice(0, 300)}`,
            );
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
              console.log(
                `[Ollama] buf had ${remaining.length} unprocessed bytes at stream end`,
              );
              processLine(remaining);
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (processLine(line)) break outer;
          }
        }

        const model = config.model ?? DEFAULT_MODEL;
        if (finishReason === "length") {
          console.warn(
            `[Ollama] Stream ended: finish_reason=length, chars=${fullText.length}, maxTokens=${options?.maxTokens ?? "unset"} — model ${model} hit output cap`,
          );
        } else {
          console.log(
            `[Ollama] Stream ended: finish_reason=${finishReason ?? "unknown"}, chars=${fullText.length}, maxTokens=${options?.maxTokens ?? "unset"}, model=${model}`,
          );
        }

        // Filter out thinking tags from the final response
        const filteredText = filterThinkingTags(fullText || "");
        return filteredText || null;
      }

      const data = (await response.json()) as OpenAIResponse;
      const rawText = data.choices?.[0]?.message?.content ?? null;
      // Do NOT strip thinking tags here — non-streaming callers (e.g. the live
      // judge) rely on the raw content for JSON extraction. If the model wraps
      // its JSON inside <thinking> blocks, filterThinkingTags would erase it.
      return rawText;
    } catch (e: any) {
      // Check if the error is an AbortError
      if (e.name === "AbortError") {
        console.log(
          `[Ollama] Request aborted for model ${config.model ?? DEFAULT_MODEL}`,
        );
        return null;
      }

      const msg = e.message || String(e);
      const safe = config.apiKey ? redactKey(msg, config.apiKey) : msg;
      console.error(
        `[Ollama] Network Error: Unable to connect to ${url}. Is the server reachable? (${safe})`,
      );
      return null;
    }
  },
});
