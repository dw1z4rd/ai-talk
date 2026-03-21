/**
 * Browser-safe text utilities for streaming message post-processing.
 * This module has no server-only imports and is safe to use in Svelte components.
 */

// Shared across detectSpaceDrops and repairSpaceDrops — allocated once at module load.
// The /g flag is intentional: String.replace() with a callback resets lastIndex internally.
export const LOWERCASE_WORD_RE = /\b[a-z]{4,20}\b/g;

export const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "be",
  "is",
  "are",
  "was",
  "were",
  "been",
  "being",
  "am",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "can",
  "could",
  "must",
  "need",
  "dare",
  "ought",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "mine",
  "yours",
  "ours",
  "theirs",
  "this",
  "that",
  "these",
  "those",
  "which",
  "who",
  "whom",
  "whose",
  "what",
  "in",
  "on",
  "at",
  "by",
  "for",
  "of",
  "to",
  "up",
  "as",
  "if",
  "so",
  "or",
  "and",
  "but",
  "nor",
  "yet",
  "not",
  "no",
  "nor",
  "than",
  "then",
  "when",
  "while",
  "with",
  "from",
  "into",
  "onto",
  "upon",
  "out",
  "off",
]);

export const SPACE_DROP_THRESHOLD = 2; // ≥2 fused pairs per message

/**
 * Count likely function-word fusions in text (e.g. "beits", "ofthe").
 */
export function detectSpaceDrops(text: string): number {
  const words = text.match(LOWERCASE_WORD_RE) ?? [];
  let hits = 0;
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) continue;
    for (let i = 1; i < w.length - 1; i++) {
      if (FUNCTION_WORDS.has(w.slice(0, i)) && FUNCTION_WORDS.has(w.slice(i))) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

/**
 * Repair space-drop artefacts in text by reinserting missing spaces between
 * fused function-word pairs (e.g. "ofthe" → "of the", "itis" → "it is").
 * Only complete lowercase words at word boundaries are touched; unknown words
 * and already-valid function words are passed through unchanged.
 * Safe to call on partial (streaming) text.
 */
export function repairSpaceDrops(text: string): string {
  return text.replace(LOWERCASE_WORD_RE, (word) => {
    if (FUNCTION_WORDS.has(word)) return word;
    for (let i = 1; i < word.length - 1; i++) {
      if (
        FUNCTION_WORDS.has(word.slice(0, i)) &&
        FUNCTION_WORDS.has(word.slice(i))
      ) {
        return word.slice(0, i) + " " + word.slice(i);
      }
    }
    return word;
  });
}
