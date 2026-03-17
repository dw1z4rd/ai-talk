import { describe, it, expect } from "vitest";
import { splitDocumentIntoChunks } from "./doc-chunker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a string of exactly n words. */
function words(n: number, word = "lorem"): string {
  return Array(n).fill(word).join(" ");
}

/** Build a prose sentence string with `sentenceCount` full-stop sentences. */
function sentences(sentenceCount: number): string {
  return Array.from(
    { length: sentenceCount },
    (_, i) => `Sentence ${i + 1} which has enough words to count properly.`,
  ).join(" ");
}

// ---------------------------------------------------------------------------
// Short input passthrough
// ---------------------------------------------------------------------------

describe("splitDocumentIntoChunks — short text", () => {
  it("returns a single chunk when text is shorter than the ceiling", () => {
    const text = "Hello world. This is a short document.";
    const result = splitDocumentIntoChunks(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text.trim());
  });

  it("filters out empty strings", () => {
    const result = splitDocumentIntoChunks("   ");
    expect(result).toHaveLength(0);
  });

  it("handles a single word", () => {
    const result = splitDocumentIntoChunks("word");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("word");
  });
});

// ---------------------------------------------------------------------------
// Section-heading splits (## / ###)
// ---------------------------------------------------------------------------

describe("splitDocumentIntoChunks — section headings", () => {
  it("splits on ## headings", () => {
    const text = `## Introduction\nThis is the intro.\n\n## Background\nThis is background.`;
    const result = splitDocumentIntoChunks(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Introduction");
    expect(result[1]).toContain("Background");
  });

  it("splits on ### headings", () => {
    const text = `### Part One\nContent A.\n### Part Two\nContent B.`;
    const result = splitDocumentIntoChunks(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Part One");
    expect(result[1]).toContain("Part Two");
  });

  it("falls back to paragraph splits when no headings", () => {
    const text = `First paragraph here.\n\nSecond paragraph here.`;
    const result = splitDocumentIntoChunks(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("First paragraph here.");
    expect(result[1]).toBe("Second paragraph here.");
  });
});

// ---------------------------------------------------------------------------
// Word ceiling
// ---------------------------------------------------------------------------

describe("splitDocumentIntoChunks — word ceiling", () => {
  it("does not chunk text at or below the ceiling", () => {
    const text = words(600);
    const result = splitDocumentIntoChunks(text, 600);
    expect(result).toHaveLength(1);
  });

  it("splits text that exceeds the ceiling into multiple chunks", () => {
    const text = words(1300);
    const result = splitDocumentIntoChunks(text, 600);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("each produced chunk stays at or below the ceiling", () => {
    const text = words(1500);
    const result = splitDocumentIntoChunks(text, 600);
    for (const chunk of result) {
      const wordCount = chunk.split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(600);
    }
  });

  it("uses a custom ceiling when override is provided", () => {
    // 50 words should not split with ceiling 100
    const text = words(50);
    expect(splitDocumentIntoChunks(text, 100)).toHaveLength(1);
    // 150 words should split with ceiling 100
    const long = words(150);
    expect(splitDocumentIntoChunks(long, 100).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Sentence-boundary guard — never cut mid-sentence
// ---------------------------------------------------------------------------

describe("splitDocumentIntoChunks — sentence boundary guard", () => {
  it("chunk ends at a sentence boundary, not mid-word", () => {
    // Build ~120 words of prose split into clear sentences, with ceiling of 50
    const block = sentences(20); // many sentences, well over 50 words
    const result = splitDocumentIntoChunks(block, 50);
    // Every chunk should end on a sentence terminator (after trimming)
    for (const chunk of result) {
      expect(chunk).toMatch(/[.!?]$/);
    }
  });

  it("does not produce empty chunks after a sentence split", () => {
    const block = sentences(30);
    const result = splitDocumentIntoChunks(block, 50);
    for (const chunk of result) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("reconstructs the full text content (no words dropped)", () => {
    const block = sentences(30);
    const result = splitDocumentIntoChunks(block, 50);
    // Every word in the original should appear somewhere in the chunks
    const joined = result.join(" ");
    // Simple check: character count should be close to original (allowing for
    // whitespace normalisation from trim())
    const originalWords = block.split(/\s+/).filter(Boolean).length;
    const chunkWords = joined.split(/\s+/).filter(Boolean).length;
    expect(chunkWords).toBe(originalWords);
  });
});

// ---------------------------------------------------------------------------
// Heading sections that individually exceed the ceiling
// ---------------------------------------------------------------------------

describe("splitDocumentIntoChunks — heading section exceeds ceiling", () => {
  it("sub-splits an oversized heading section", () => {
    const bigSection = `## Big Section\n${sentences(80)}`; // ~80+ words
    const result = splitDocumentIntoChunks(bigSection, 30);
    // Should be more than one chunk since section exceeds 30 words
    expect(result.length).toBeGreaterThan(1);
  });
});
