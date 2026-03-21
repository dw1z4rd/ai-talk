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

export type ArtifactSeverity = "none" | "minor" | "moderate" | "severe";

export interface ArtifactRepairResult {
  /** The (possibly repaired) text to feed to the scorer. */
  repaired: string;
  /** True when at least one space-drop artefact was fixed. */
  applied: boolean;
  /**
   * Severity of the worst artifact class detected, even if unrepairable.
   * "none"     — no artefacts found
   * "minor"    — 1–2 space-drop fusions (repaired)
   * "moderate" — 3+ space-drop fusions (repaired but residual noise likely)
   * "severe"   — CJK script inlined with Latin text (tokeniser encoding failure;
   *              space-drop repair does not fix this class)
   */
  severity: ArtifactSeverity;
  /** Human-readable note for the audit panel; undefined when no repair occurred. */
  note?: string;
}

// Inline CJK mixed with Latin text — reliable signal of tokeniser encoding failure.
// Does NOT fire on purely CJK text (e.g. Japanese-language debates); only on
// isolated CJK characters embedded inside otherwise Latin prose.
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const ALL_CJK_RE =
  /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\s\p{P}]+$/u;

/**
 * Apply space-drop repair and classify artifact severity.
 * Severity "severe" signals a CJK encoding failure that space-drop repair
 * cannot fix; core.ts uses this to cap the Rhetoric score.
 */
export function repairAndTrackArtefacts(text: string): ArtifactRepairResult {
  const repaired = repairSpaceDrops(text);
  const applied = repaired !== text;
  const spaceDropCount = applied ? detectSpaceDrops(text) : 0;
  const hasCjkInline = CJK_RE.test(text) && !ALL_CJK_RE.test(text);

  let severity: ArtifactSeverity = "none";
  let note: string | undefined;

  if (hasCjkInline) {
    severity = "severe";
    note = `CJK characters detected inline with Latin text — likely tokeniser encoding failure. Rhetoric score capped; encoding artefacts are not repairable by space-drop repair.${applied ? " Space-drop artefacts also repaired." : ""}`;
  } else if (spaceDropCount >= 3) {
    severity = "moderate";
    note = `${spaceDropCount} space-drop artefacts repaired before scoring (fused function words reconnected). Moderate artefact count may indicate residual noise; rhetoric score reflects cleaned text.`;
  } else if (applied) {
    severity = "minor";
    note = "Space-drop artefacts repaired before scoring (fused function words reconnected — rhetoric score reflects cleaned text).";
  }

  return { repaired, applied, severity, note };
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

// ── Empirical claim detection ─────────────────────────────────────────────────

export interface EmpiricalClaimResult {
  /** True when the turn contains phrases that assert empirical facts. */
  hasEmpirical: boolean;
  /** De-duplicated list of matched empirical-claim phrases. */
  claims: string[];
}

// Compiled at module load — patterns that signal a factual/empirical assertion.
// Designed for high recall (may match normative uses of "data suggests") so that
// the code-level evidence gate only fires when NO citations are present — the
// combination of "empirical language + zero citations" is the reliable signal.
const _EMPIRICAL_PATTERNS: readonly RegExp[] = [
  /\bstudi(?:es|y)\s+(?:show|suggest|find|demonstrate|reveal|indicate|confirm)/gi,
  /\bresearch\s+(?:show|suggest|find|confirm|indicate|demonstrate)/gi,
  /\bdata\s+(?:show|suggest|indicate|confirm|demonstrate)/gi,
  /\bevidence\s+(?:show|suggest|indicate|supports?|demonstrate)/gi,
  /\baccording\s+to\s+(?:data|research|studies|experts|scientists|experts)/gi,
  /\b\d+\s*%\s+(?:of\b|reduction|increase|improvement|higher|lower|more|fewer)/gi,
  /\bmeta-analysis|systematic\s+review|randomized\s+(?:controlled\s+)?trial|clinical\s+trial/gi,
  /\bscientifically\s+(?:proven|established|validated)/gi,
  /\bproven\s+(?:that|to\b|effective|ineffective)/gi,
  /\bstatistic(?:s|ally)|empirically\b/gi,
];

/**
 * Detect phrases in a turn that assert empirical facts without inline citations.
 * Used as the second condition in the code-level evidence gate: the penalty only
 * fires when BOTH `detectEvidence` returns `hasEvidence=false` AND this returns
 * `hasEmpirical=true`.  Pure normative/conceptual turns receive no penalty.
 */
export function detectEmpiricalClaims(text: string): EmpiricalClaimResult {
  const hits: string[] = [];
  for (const re of _EMPIRICAL_PATTERNS) {
    const matches = text.match(new RegExp(re.source, re.flags)) ?? [];
    hits.push(...matches);
  }
  const claims = [...new Set(hits.map((s) => s.trim()))];
  return { hasEmpirical: claims.length > 0, claims };
}
