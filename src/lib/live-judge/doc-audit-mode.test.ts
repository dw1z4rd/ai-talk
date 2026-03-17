/**
 * Tests for document-audit mode additions to analysis.ts:
 *   - generatePairwiseSystemPrompt accepts a `mode` param
 *   - document_audit mode injects the DOCUMENT AUDIT MODE block
 *   - debate mode (default) does NOT include the block
 *   - agent names are threaded correctly into the mode block
 */

import { describe, it, expect, vi } from "vitest";

// analysis.ts imports MODEL_CATALOG from $lib/agents, which imports $env/static/private.
// Provide a minimal mock so the module graph loads without env credentials.
vi.mock("$lib/agents", () => ({ MODEL_CATALOG: {} }));

import { generatePairwiseSystemPrompt } from "./analysis";

describe("generatePairwiseSystemPrompt — mode param", () => {
  it("does not include DOCUMENT AUDIT MODE block in default (no mode) call", () => {
    const prompt = generatePairwiseSystemPrompt("Alice", "Bob");
    expect(prompt).not.toContain("DOCUMENT AUDIT MODE");
    expect(prompt).not.toContain("SUPPRESS:");
  });

  it("does not include DOCUMENT AUDIT MODE block when mode='debate'", () => {
    const prompt = generatePairwiseSystemPrompt("Alice", "Bob", "", "debate");
    expect(prompt).not.toContain("DOCUMENT AUDIT MODE");
  });

  it("includes DOCUMENT AUDIT MODE block when mode='document_audit'", () => {
    const prompt = generatePairwiseSystemPrompt("Alice", "Bob", "", "document_audit");
    expect(prompt).toContain("--- DOCUMENT AUDIT MODE ---");
  });

  it("names nameA (document speaker) in the SUPPRESS instruction", () => {
    const prompt = generatePairwiseSystemPrompt("Document", "AuditBot", "", "document_audit");
    expect(prompt).toContain("Document");
    // SUPPRESS and FOCUS lines reference nameA
    expect(prompt).toContain("SUPPRESS:");
    expect(prompt).toContain("FOCUS Document scoring on:");
  });

  it("names nameB (auditor) as the agent with full scoring responsibility", () => {
    const prompt = generatePairwiseSystemPrompt("Document", "AuditBot", "", "document_audit");
    expect(prompt).toContain("Apply ALL standard scoring rules to AuditBot");
  });

  it("instructs the judge to suppress argumentative stagnation for the document", () => {
    const prompt = generatePairwiseSystemPrompt("Doc", "Auditor", "", "document_audit");
    expect(prompt).toContain("argumentative stagnation");
  });

  it("instructs the judge to suppress thesis drift for the document", () => {
    const prompt = generatePairwiseSystemPrompt("Doc", "Auditor", "", "document_audit");
    expect(prompt).toContain("thesis drift");
  });

  it("still includes hollow-specificity and mechanism-chain rules in document_audit mode", () => {
    const prompt = generatePairwiseSystemPrompt("Document", "Auditor", "", "document_audit");
    // Core logic rules must be present regardless of mode
    expect(prompt).toContain("Hollow specificity");
    expect(prompt).toContain("mechanism");
  });

  it("propagates domainNote into both debate and document_audit modes", () => {
    const note = "DOMAIN: EMPIRICAL — precision matters.";
    const debatePrompt = generatePairwiseSystemPrompt("A", "B", note, "debate");
    const docPrompt = generatePairwiseSystemPrompt("A", "B", note, "document_audit");
    expect(debatePrompt).toContain(note);
    expect(docPrompt).toContain(note);
  });
});
