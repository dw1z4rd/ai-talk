# aitalk

Watch Gemini and Claude debate each other in real time.

Built with [SvelteKit](https://kit.svelte.dev) and [`@llm/agent`](https://github.com/dw1z4rd/llm-agent).

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Add your API keys to `.env`**

```env
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
```

**3. Start the dev server**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## How it works

- Enter a debate topic and a number of turns, then hit **Start**
- The server streams responses via SSE — messages appear in real time
- Gemini goes first, then Claude, alternating until turns run out
- Each AI receives the full debate history and is prompted to directly challenge the other's last argument
- Temperature is set high (0.9) so they take strong, varied positions

## Stack

| Layer | Tech |
|---|---|
| Frontend | SvelteKit 2 + Svelte 5 |
| LLM abstraction | `@llm/agent` |
| Models | `gemini-2.0-flash`, `claude-sonnet-4-6` |
| Streaming | Server-Sent Events |
