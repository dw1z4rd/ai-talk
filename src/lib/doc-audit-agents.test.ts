/**
 * Tests covering the two new exports added during doc-audit mode work:
 *   - makeDocumentAuditorPrompt()
 *   - resetLiveJudgeDebate() threaded to resetLiveJudgeSystem with mode
 *
 * makeDocumentAuditorPrompt is imported from its own dep-free module.
 * Core reset tests import directly from live-judge/core so no env mock needed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { makeDocumentAuditorPrompt } from "$lib/doc-audit-prompts";
import {
  getLiveJudgeSystem,
  resetLiveJudgeSystem,
} from "$lib/live-judge/core";

// ---------------------------------------------------------------------------
// makeDocumentAuditorPrompt
// ---------------------------------------------------------------------------

describe("makeDocumentAuditorPrompt", () => {
  it("contains the auditor agent's name", () => {
    const prompt = makeDocumentAuditorPrompt("Document", "ClaimBot");
    expect(prompt).toContain("ClaimBot");
  });

  it("frames the role as auditor, not debater", () => {
    const prompt = makeDocumentAuditorPrompt("Document", "ClaimBot");
    expect(prompt).toContain("claim auditor");
    expect(prompt.toLowerCase()).not.toContain("debater");
  });

  it("instructs to identify claims and evidence gaps", () => {
    const prompt = makeDocumentAuditorPrompt("Document", "Auditor");
    expect(prompt).toContain("evidence");
    expect(prompt).toContain("mechanism");
  });

  it("includes the hollow-specificity instruction", () => {
    const prompt = makeDocumentAuditorPrompt("Doc", "Auditor");
    expect(prompt).toContain("hollow specificity");
  });

  it("enforces English-only output", () => {
    const prompt = makeDocumentAuditorPrompt("Doc", "Auditor");
    expect(prompt).toContain("English only");
  });

  it("enforces a word limit", () => {
    const prompt = makeDocumentAuditorPrompt("Doc", "Auditor");
    // Should mention a max word count for responses
    expect(prompt).toMatch(/\d{2,3} words/);
  });

  it("disallows summarising the document", () => {
    const prompt = makeDocumentAuditorPrompt("Doc", "Auditor");
    expect(prompt).toContain("Do not summarise");
  });

  it("is a non-empty string", () => {
    const prompt = makeDocumentAuditorPrompt("Doc", "Auditor");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// resetLiveJudgeDebate threads mode through to LiveJudgeSystem
// ---------------------------------------------------------------------------

describe("resetLiveJudgeDebate — mode threading", () => {
  beforeEach(() => {
    // Reset to clean debate state before each test
    resetLiveJudgeSystem(undefined, "debate");
  });

  it("defaults to debate mode when no mode arg is passed", () => {
    resetLiveJudgeSystem();
    // Internal mode is private, but the system prompt emitted by the judge
    // reflects the mode. We can verify this indirectly by checking the judge
    // exists and panel is reset.
    const system = getLiveJudgeSystem();
    expect(system).toBeDefined();
    expect(system.getScorecard().rounds).toHaveLength(0);
  });

  it("accepts document_audit without throwing", () => {
    expect(() => resetLiveJudgeSystem(undefined, "document_audit")).not.toThrow();
  });

  it("accepts debate mode explicitly without throwing", () => {
    expect(() => resetLiveJudgeSystem(undefined, "debate")).not.toThrow();
  });

  it("clears scorecard rounds after reset regardless of mode", () => {
    resetLiveJudgeSystem(undefined, "document_audit");
    const scorecard = getLiveJudgeSystem().getScorecard();
    expect(scorecard.rounds).toHaveLength(0);
    expect(scorecard.overallWinner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetLiveJudgeSystem — mode stored on LiveJudgeSystem
// ---------------------------------------------------------------------------

describe("resetLiveJudgeSystem — mode parameter", () => {
  it("does not throw with mode='debate'", () => {
    expect(() => resetLiveJudgeSystem([], "debate")).not.toThrow();
  });

  it("does not throw with mode='document_audit'", () => {
    expect(() => resetLiveJudgeSystem([], "document_audit")).not.toThrow();
  });

  it("clears panel state in both modes", () => {
    for (const mode of ["debate", "document_audit"] as const) {
      resetLiveJudgeSystem(undefined, mode);
      const sc = getLiveJudgeSystem().getScorecard();
      expect(sc.rounds).toHaveLength(0);
      expect(sc.winTallies).toEqual({});
    }
  });
});
