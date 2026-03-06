# User Interaction & Branching Design

**Goal:** Allow users to pause an ongoing AI debate, inject a question, point, or rebuttal, and have the AIs immediately address the user's intervention upon resuming.

## 1. User Interface
- **Pause Button:** A "Pause Debate" button will be added to the UI, visible while a debate is running.
- **Intervention Input:** When "Pause Debate" is clicked, any active generation stream is immediately aborted. An input field appears (replacing or overlaying the debate controls) labeled "Add a point, sub-topic, or rebuttal...".
- **Seamless Resume:** Upon pressing "Enter" in the input field (or clicking a submit icon), the user's message is added to the debate history, and the debate automatically resumes.
- **Message Display:** The user's input will be displayed in the chat history, clearly styled differently from the AI participants (e.g., labeled as "Moderator").

## 2. Architecture & Data Flow
- **Message Roles:** The message data structure will be updated to explicitly support a "moderator" role alongside the existing AI roles.
- **Prompt Modification:** When a moderator message is injected, the prompt sent to the *next* AI in the sequence will be appended with an explicit instruction:
  - *"The debate was interrupted by the Moderator, who said: '[User's text]'. You must address this point before continuing your attack on your opponent."*
- **Stream Abortion:** The frontend will use an `AbortController` to cancel any ongoing `fetch` stream to the LLM backend when the "Pause" button is clicked, ensuring no dangling network requests or rogue updates to the UI.

## 3. Edge Cases & Constraints
- **Turn Limits:** Moderator interventions do *not* consume one of the configured debate turns. If the debate is set to 4 turns, there will still be 4 AI responses, regardless of how many times the user intervenes.
- **Repeated Interruptions:** Users can interrupt as often as they like. Each interruption simply aborts the current stream and queues up a new moderator message.
- **State Consistency:** Ensure that aborting a stream midway leaves the UI in a clean state, retaining whatever text was generated up to the point of interruption, and cleanly appending the moderator's message right after it.