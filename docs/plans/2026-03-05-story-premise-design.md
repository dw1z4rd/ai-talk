# Story Feature Premise Update Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to implement this plan task-by-task.

**Goal:** Modify the Story feature so that the user's "Premise" acts as a collaborative blueprint rather than the literal opening paragraph of the story.

**Architecture:** 
The `premise` will be passed distinctly from the `storySoFar` string into the generation logic. `generateStoryContinuation` will incorporate the premise as part of the system prompt to guide the models on what to write, while the actual story text starts completely empty.

**Tech Stack:** SvelteKit, TypeScript

---

### Key Changes
1. **`src/routes/story/+page.svelte`**: Change the placeholder text for the premise to suggest providing a blueprint (e.g. "Describe the plot, characters, and setting...").
2. **`src/routes/api/story/+server.ts`**: Start `storySoFar` as an empty string instead of `safePremise`. Pass `safePremise` as an additional parameter to `generateStoryContinuation`.
3. **`src/lib/agents.ts`**: Update the `generateStoryContinuation` signature to accept a `premise` parameter. Update the `messages` array built inside to include the premise as an instruction, clearly separating the premise from the story text. **Add explicit instruction to never end mid-sentence - all responses must contain complete paragraphs.**
