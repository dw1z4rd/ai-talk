# User Interaction & Branching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to pause an ongoing AI debate, inject a question, point, or rebuttal, and have the AIs immediately address the user's intervention upon resuming.

**Architecture:**
- **Frontend (`src/routes/+page.svelte`):** Add "Pause" state, manage `AbortController` for stopping the LLM stream, and display a moderator input field. Pass intervention messages in the chat history.
- **Backend (`src/routes/api/chat/+server.ts`):** Ensure the chat API accepts the `moderator` role in the message history and formats it correctly for the LLMs (injecting explicit instructions if the last message was from the moderator).

**Tech Stack:** SvelteKit, `@llm/agent`

---

### Task 1: Update API to Handle Moderator Role

**Files:**
- Modify: `src/routes/api/chat/+server.ts`

**Step 1: Write the failing test**
Create a test to verify that the chat API correctly formats the moderator message and includes the specific instruction in the prompt. Since this is an API endpoint, we can test it using a simple script or just verify it manually later, but for TDD, let's update the API endpoint directly to accept a `role: 'moderator'` message.

*(We will use a manual verification script `test-moderator-api.ts` since there is no test framework yet)*

**Step 2: Run test to verify it fails**
Run: `bun run test-moderator-api.ts`
Expected: FAIL, error that 'moderator' is not a valid role or instruction is missing.

**Step 3: Write minimal implementation**
Update `src/routes/api/chat/+server.ts` to map a `moderator` role message into a `user` role message (or append it to the system prompt) with the instruction: *"The debate was interrupted by the Moderator, who said: '[User's text]'. You must address this point before continuing your attack on your opponent."*

**Step 4: Run test to verify it passes**
Run: `bun run test-moderator-api.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add src/routes/api/chat/+server.ts
git commit -m "feat: handle moderator role in chat API"
```

### Task 2: Implement Stream Abort in UI

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Write minimal implementation**
Add an `AbortController` to the `startDebate` / fetch logic. Store the `abortController` in a state variable.

**Step 2: Verify**
Ensure the app still compiles and runs.

**Step 3: Commit**
```bash
git add src/routes/+page.svelte
git commit -m "feat: add AbortController to fetch stream"
```

### Task 3: Add Pause/Intervene UI

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Write minimal implementation**
- Add a "Pause Debate" button that is visible when `isDebating` is true.
- When clicked, call `abortController.abort()`, set a `isPaused` state to true.
- Display an input field for the moderator when `isPaused` is true.
- On submit (Enter), add a `{ role: 'moderator', content: inputValue }` message to the history, set `isPaused` false, and call `resumeDebate()`.

**Step 2: Verify**
Run the dev server, start a debate, click "Pause", verify the stream stops, type a message, hit Enter, verify the debate resumes and the message is displayed.

**Step 3: Commit**
```bash
git add src/routes/+page.svelte
git commit -m "feat: add pause and intervene UI"
```

### Task 4: Display Moderator Messages

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Write minimal implementation**
Update the message loop in the Svelte template to handle `msg.role === 'moderator'`, applying distinct styling (e.g., a different background color or clear "Moderator:" prefix).

**Step 2: Verify**
Run the dev server, intervene in a debate, verify the styling looks correct.

**Step 3: Commit**
```bash
git add src/routes/+page.svelte
git commit -m "ui: style moderator messages"