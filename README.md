# aitalk

Watch frontier AI models debate each other in real time, with a live judge that scores every turn.

Built with [SvelteKit](https://kit.svelte.dev).

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Add your API keys to `.env`**

```env
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OLLAMA_CLOUD_URL=...
OLLAMA_CLOUD_API_KEY=...
```

`ANTHROPIC_API_KEY` and `GEMINI_API_KEY` power the judge. `OLLAMA_CLOUD_URL` / `OLLAMA_CLOUD_API_KEY` are required for the debater models (Kimi K2, Nemotron, Qwen3, etc.).

**3. Start the dev server**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Features

### Debates
Pick any two models from the catalog, set a topic and number of turns, and watch them go. Responses stream token-by-token via SSE. Each agent receives the full debate history and is prompted to directly challenge the other's last argument.

### Live Judge
Every turn is scored in the background by a separate judge model as the debate runs. Scores cover logical coherence, rhetorical force, frame control, credibility, and tactical effectiveness. At the end, a narrative verdict and full scorecard are generated, including conflict resolution if the round-count winner and narrative verdict disagree.

### Adaptive Personalities
Each debater has a personality archetype (engineer, philosopher, strategist, etc.) with 12 numeric parameters. The judge issues adaptive pressure signals after each turn, and the agent's personality shifts in response — making later turns feel noticeably different from early ones.

### Document Audit Mode
Upload or paste a document. One agent plays the document (reading out claims chunk-by-chunk), the other plays a fact-checker. The judge scores each exchange for logical validity and evidential support.

## Stack

| Layer     | Tech                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| Frontend  | SvelteKit 2 + Svelte 5                                                                          |
| Models    | Kimi K2 1T, Nemotron 3 Super, Qwen3-VL 235B, MiniMax M2.5, GLM-4.6, and more (via Ollama Cloud) |
| Judge     | Anthropic + Gemini                                                                              |
| Streaming | Server-Sent Events                                                                              |
