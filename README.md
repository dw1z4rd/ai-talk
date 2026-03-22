# Reasoning Quality Auditor

This project is not a debate engine.  
It is a **reasoning‑quality auditor** that uses adversarial dialogue as a pressure‑testing substrate to reveal how well arguments hold up under structured scrutiny.

The debaters are probes.  
The judge is the system.

## What This System Does

The core of the project is a judge layer designed to evaluate the *structure* of reasoning, not the style of persuasion. It enforces mechanistic coherence, tracks arguments across turns, and produces detailed analyses of how each position evolves.

### Key Features

#### **Mechanistic Reasoning Enforcement**
Arguments are evaluated using a strict **cause → process → consequence** framework.  
Claims without mechanisms are flagged immediately.  
Hand‑waving, metaphors, and moral gestures are penalized.

#### **Cross‑Turn Epistemic Tracking**
The judge maintains memory across the entire exchange:
- detects contradictions  
- flags dropped premises  
- identifies ontology drift  
- rewards stable causal spines  

This allows the system to evaluate reasoning *dynamically*, not turn‑by‑turn in isolation.

#### **Stable Multi‑Turn Reasoning**
The architecture forces debates to:
- remain coherent for many rounds  
- escalate rather than loop  
- refine arguments under pressure  
- maintain persona and ontology consistency  

This behavior emerges from the scaffolding, not the underlying models.

#### **Arc‑Level Causal Analysis**
Beyond per‑turn scoring, the judge produces a narrative verdict that:
- reconstructs the entire causal arc  
- identifies unresolved tensions  
- explains why one model’s reasoning held together  
- diagnoses where the other fractured  

This is not summarization — it is **causal autopsy**.

#### **Model‑Agnostic Architecture**
The system works with off‑the‑shelf open‑source models.  
The reasoning quality comes from the **structure**, not the model weights.

## Why This Matters

Most debate systems focus on generating arguments.  
This system focuses on **evaluating reasoning**.

It provides a way to:
- test the robustness of arguments  
- analyze causal coherence  
- study emergent reasoning behavior  
- benchmark models on structured epistemic tasks  

The result is a synthetic environment that reveals how well (or poorly) arguments actually work when subjected to mechanistic pressure.

## Intended Use

This tool is useful for:
- researchers studying reasoning in LLMs  
- developers testing model robustness  
- anyone exploring multi‑agent epistemic systems  
- people interested in argument structure rather than persuasion  

It is not designed for competitive debate simulation.  
It is designed for **reasoning diagnostics**.

---

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

Currently Gemini, Ollama, and Anthropic are supported out of the box, but the llm-agent library I wrote makes it really simple and straightforward to add any providers you need or want.
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

| Layer     | Tech                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | SvelteKit 2 + Svelte 5                                                                                                                                                                                        |
| Models    | Kimi K2 1T, Nemotron 3 Super, Qwen3-VL 235B, MiniMax M2.5, GLM-4.6, and more (via Ollama Cloud) (can easily swap out your preferred LLM providers and models using the provider-agnostic llm library I wrote) |
| Judge     | See above                                                                                                                                                                                                     |
| Streaming | Server-Sent Events                                                                                                                                                                                            |
