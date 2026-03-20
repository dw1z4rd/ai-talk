/**
 * Split a document string into analysis-sized chunks suitable for feeding
 * into the debate/audit pipeline one turn at a time.
 *
 * Priority order:
 *   1. Section headings (## / ###) — preserves document structure
 *   2. Double-newline paragraph breaks — natural prose boundaries
 *   3. Word ceiling (default 600 words) with sentence-boundary guard —
 *      never cuts mid-sentence; finds the nearest period before the ceiling
 */
/**
 * Strips backmatter sections (References, Bibliography, Works Cited, etc.)
 * from a document string. These sections contain no auditable claims and
 * should not be fed into the scoring pipeline.
 */
export function stripBackmatter(text: string): string {
  const backmatterRe =
    /\n#{0,3}\s*(references|bibliography|works\s+cited|sources|further\s+reading)\b/i;
  const idx = text.search(backmatterRe);
  return idx >= 0 ? text.slice(0, idx) : text;
}

export function splitDocumentIntoChunks(
  text: string,
  maxWords = 600,
): string[] {
  // Normalize line endings (CRLF → LF) so Windows uploads split correctly
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Strip backmatter (References, Bibliography, etc.) — not auditable claims
  const body = stripBackmatter(normalized);

  // Step 1: try section headings (# / ## / ###)
  let sections: string[] = [];
  if (/\n#{1,3} /.test(body)) {
    sections = body.split(/\n(?=#{1,3} )/).filter((s) => s.trim());
  }
  // Step 2: fall back to double-newline paragraph splits
  if (sections.length <= 1) {
    sections = body.split(/\n{2,}/).filter((s) => s.trim());
  }

  // Step 3: apply word ceiling with sentence-boundary guard
  //
  // findWordCeilingPos: single-pass scan that counts words and returns the
  // character index after the maxWords-th word boundary. Avoids the separate
  // split(/\s+/).length count + re-scan pattern that was O(2n) per iteration.
  function findWordCeilingPos(s: string): number {
    let wc = 0;
    for (let i = 1; i < s.length; i++) {
      // Word boundary: previous char non-whitespace, current char whitespace
      // Use /\s/ for Unicode-aware whitespace detection (covers NBSP, etc.)
      if (!/\s/.test(s[i - 1]) && /\s/.test(s[i])) {
        wc++;
        if (wc >= maxWords) return i;
      }
    }
    return s.length;
  }

  const chunks: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    // Quick word count: number of whitespace→non-whitespace transitions + 1
    let wordCount = trimmed.length > 0 ? 1 : 0;
    for (let i = 1; i < trimmed.length; i++) {
      if (/\s/.test(trimmed[i - 1]) && !/\s/.test(trimmed[i])) wordCount++;
    }
    if (wordCount <= maxWords) {
      chunks.push(trimmed);
      continue;
    }
    let remaining = trimmed;
    while (remaining.length > 0) {
      const charPos = findWordCeilingPos(remaining);
      if (charPos >= remaining.length) {
        // Remaining fits within ceiling
        chunks.push(remaining);
        break;
      }
      // Find nearest sentence end before that position (don't cut mid-sentence)
      const slice = remaining.slice(0, charPos);
      const sentenceEnd = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );
      const splitAt = sentenceEnd > 0 ? sentenceEnd + 1 : charPos;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
  }
  return chunks.filter((c) => c.length > 0);
}
