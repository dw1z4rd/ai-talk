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

// ── Artifact repair with tracking ────────────────────────────────────────────

export interface ArtifactRepairResult {
  /** The (possibly repaired) text to feed to the scorer. */
  repaired: string;
  /** True when at least one artefact was fixed. */
  applied: boolean;
  /** Human-readable note for the audit panel; undefined when no repair occurred. */
  note?: string;
}

/**
 * Apply space-drop repair and return both the cleaned text and a tracking record.
 * Use this before passing turn text to any LLM scorer so that tokeniser artefacts
 * do not depress rhetoric scores for formatting reasons unrelated to argument quality.
 */
export function repairAndTrackArtefacts(text: string): ArtifactRepairResult {
  const repaired = repairSpaceDrops(text);
  const applied = repaired !== text;
  return {
    repaired,
    applied,
    note: applied
      ? "Space-drop artefacts repaired before scoring (fused function words reconnected — rhetoric score reflects cleaned text)."
      : undefined,
  };
}

// ── Evidence detection ────────────────────────────────────────────────────────

export interface EvidenceDetectionResult {
  /** True when at least one citation/reference pattern was found. */
  hasEvidence: boolean;
  /** De-duplicated list of citation strings found in the turn text. */
  citations: string[];
  /** Ready-to-inject note for the judge prompt. */
  gatingNote: string;
}

// Compiled once at module load — never re-instantiated per call.
// Each regex is recreated from source with the same flags so `.match()` gets a fresh lastIndex.
const _EVIDENCE_PATTERNS: readonly [string, string][] = [
  [
    /\([A-Z][a-zÀ-ÖØ-öø-ÿ'-]+(?:[,&] [A-Z][a-z'-]+)*, \d{4}[a-z]?\)/.source,
    "g",
  ], // APA: (Author, 2020)
  [/\[\d+(?:,\s*\d+)*\]/.source, "g"], // numbered refs: [1], [1,2]
  [/https?:\/\/[^\s"'<>]+/.source, "g"], // URLs
  [
    /\[(?:Evidence|Source|Citation|Ref(?:erence)?)[:\s][^\]]{3,120}\]/i.source,
    "gi",
  ], // explicit markers
  [/\b10\.\d{4,9}\/\S+/.source, "g"], // DOIs
];

/**
 * Scan turn text for inline citations, URLs, DOIs, or explicit evidence markers.
 * Returns metadata for use in judge prompts and the audit breakdown.
 * Evidence-bearing turns have their empirical claims treated as grounded precision
 * candidates (eligible for the +1 bonus) when accompanied by a mechanism chain.
 * Turns with no detected evidence receive a note instructing the judge to apply
 * hollow-specificity penalties without mitigation.
 */
export function detectEvidence(text: string): EvidenceDetectionResult {
  const matches: string[] = [];
  for (const [source, flags] of _EVIDENCE_PATTERNS) {
    const found = text.match(new RegExp(source, flags)) ?? [];
    matches.push(...found);
  }
  const citations = [...new Set(matches)];
  const hasEvidence = citations.length > 0;
  const preview =
    citations.length > 0
      ? citations.slice(0, 3).join(", ") + (citations.length > 3 ? "…" : "")
      : "";
  const gatingNote = hasEvidence
    ? `EVIDENCE DETECTED: Turn contains ${citations.length} citation(s)/reference(s): ${preview}. Citations satisfy the evidentiary-grounding requirement for empirical claims when the turn also supplies a mechanism chain — apply the +1 grounded-precision bonus where the chain is present. Do NOT additionally penalise for hollow specificity on claims that are directly covered by a citation.`
    : "EVIDENCE NOTE: Turn contains no inline citations, DOIs, or URLs. Hollow-specificity penalties apply without mitigation from implied evidentiary support. A gesture toward 'recent work' or 'studies show' without a citation receives the standard −1 penalty.";
  return { hasEvidence, citations, gatingNote };
}
