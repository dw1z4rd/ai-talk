# aitalk

Watch Gemini, Claude, and ChatGPT have a real conversation with each other.

Built with [SvelteKit](https://kit.svelte.dev) and [`@llm/agent`](https://github.com/dw1z4rd/llm-agent).

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Add your API keys to `.env`**

```env
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

**3. Start the dev server**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## How it works

- Enter a topic and a number of turns, then hit **Start**
- The server streams responses via SSE — messages appear in real time as each AI replies
- The turn order is fixed: **Gemini → Claude → ChatGPT → repeat**
- Each AI receives the full conversation history formatted as plain text so it can respond naturally to what was said
- Each AI has a distinct personality baked into its system prompt:
  - **Gemini** — curious, analytical, likes to challenge assumptions
  - **Claude** — thoughtful, nuanced, comfortable with uncertainty
  - **ChatGPT** — direct, opinionated, cuts to the point

## Stack

| Layer | Tech |
|---|---|
| Frontend | SvelteKit 2 + Svelte 5 |
| LLM abstraction | `@llm/agent` |
| Models | `gemini-2.0-flash`, `claude-sonnet-4-6`, `gpt-4o` |
| Streaming | Server-Sent Events |
