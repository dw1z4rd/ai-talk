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
export function splitDocumentIntoChunks(text: string, maxWords = 600): string[] {
  // Step 1: try section headings (# / ## / ###)
  let sections: string[] = [];
  if (/\n#{1,3} /.test(text)) {
    sections = text.split(/\n(?=#{1,3} )/).filter((s) => s.trim());
  }
  // Step 2: fall back to double-newline paragraph splits
  if (sections.length <= 1) {
    sections = text.split(/\n{2,}/).filter((s) => s.trim());
  }

  // Step 3: apply word ceiling with sentence-boundary guard
  const chunks: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.split(/\s+/).length <= maxWords) {
      chunks.push(trimmed);
      continue;
    }
    let remaining = trimmed;
    while (remaining.length > 0) {
      const words = remaining.split(/\s+/);
      if (words.length <= maxWords) {
        chunks.push(remaining);
        break;
      }
      // Find the character position at the word ceiling
      let charPos = 0;
      let wc = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (/\s/.test(remaining[i]) && /\S/.test(remaining[i - 1])) {
          wc++;
          if (wc >= maxWords) {
            charPos = i;
            break;
          }
        }
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
