# Escape Room Game Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "Whose Line" game link with a new LLM-powered interactive text "Escape Room" with a real-time HUD showing dynamically generated emojis for location, inventory, and clues.

**Architecture:** A SvelteKit frontend (`/escape-room`) communicating with new backend API endpoints (`/api/escape-room/init` and `/api/escape-room/chat`). The LLM acts as the Dungeon Master, appending state change tags to its responses (like `[INVENTORY_ADD: 🗝️ rusted_key]`). The frontend strips these tags from the narrative text and uses them to visually update the user's HUD.

**Tech Stack:** SvelteKit, TypeScript, existing `llm-agent` logic.

---

### Task 1: Replace Link on Home Page

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Write minimal code**
(No tests needed for simple HTML link replacement in `+page.svelte`)
```html
------- SEARCH
				<a href="/whoseline" class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg text-[--color-muted] hover:text-white transition-colors">🎭 Whose Line</a>
=======
				<a href="/escape-room" class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg text-[--color-muted] hover:text-white transition-colors">🗝️ Escape Room</a>
+++++++ REPLACE
```

**Step 2: Commit**
```bash
git commit -am "refactor: replace whose line link with escape room link"
```

---

### Task 2: Create Escape Room API Endpoints

**Files:**
- Create: `src/routes/api/escape-room/init/+server.ts`
- Create: `src/routes/api/escape-room/chat/+server.ts`

**Step 1: Create the Init Endpoint**
```typescript
// src/routes/api/escape-room/init/+server.ts
import { json } from '@sveltejs/kit';
import { generateChatResponse } from '$lib/llm-agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    // Basic implementation that calls the LLM with a system prompt to generate the scenario
    // We will instruct it to return [LOCATION_SET: ...] in its opening response
    const systemPrompt = `You are the Game Master of a unique escape room. Generate a random, unique setting (e.g., a haunted submarine, a sci-fi cloning lab, a 1920s speakeasy) with a single main win condition and 3-5 interactable objects. Present the opening scene to the player, set the [LOCATION_SET: 🏠 LocationName] tag, and begin the game. Always use emojis for items and locations.`;
    
    const response = await generateChatResponse([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Start the game.' }
    ]);

    return json({ response });
};
```

**Step 2: Create the Chat Endpoint**
```typescript
// src/routes/api/escape-room/chat/+server.ts
import { json } from '@sveltejs/kit';
import { generateChatResponse } from '$lib/llm-agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const { messages, gameState } = await request.json();
    
    const systemPrompt = `You are the Game Master of an escape room. 
    Evaluate the user's actions against the rules of the world. 
    Use the following tags in your response to update the game state:
    [LOCATION_SET: 🏠 LocationName]
    [INVENTORY_ADD: 🗝️ itemName]
    [INVENTORY_REMOVE: 🗝️ itemName]
    [CLUE_FOUND: 📜 clueName]
    [WIN_CONDITION_MET]
    [LOSE_CONDITION_MET]
    
    Current State: ${JSON.stringify(gameState)}`;

    const response = await generateChatResponse([
        { role: 'system', content: systemPrompt },
        ...messages
    ]);

    return json({ response });
};
```

**Step 3: Commit**
```bash
git add src/routes/api/escape-room
git commit -m "feat: add escape room api endpoints"
```

---

### Task 3: Create the Escape Room Frontend Page

**Files:**
- Create: `src/routes/escape-room/+page.svelte`

**Step 1: Build the UI**
```svelte
// src/routes/escape-room/+page.svelte
<script lang="ts">
    import { onMount } from 'svelte';

    type GameState = {
        location: string;
        inventory: string[];
        clues: string[];
        status: 'playing' | 'won' | 'lost';
    };

    let gameState: GameState = {
        location: 'Unknown',
        inventory: [],
        clues: [],
        status: 'playing'
    };

    let messages: { role: 'user' | 'assistant', content: string }[] = [];
    let userInput = '';
    let isLoading = true;

    // Helper to parse tags and update state, returning the clean text
    function parseTagsAndUpdateState(text: string) {
        let cleanText = text;
        
        // Location
        const locationMatch = cleanText.match(/\[LOCATION_SET:\s*(.+?)\]/);
        if (locationMatch) {
            gameState.location = locationMatch[1];
            cleanText = cleanText.replace(locationMatch[0], '');
        }

        // Inventory Add
        const invAddMatches = [...cleanText.matchAll(/\[INVENTORY_ADD:\s*(.+?)\]/g)];
        for (const match of invAddMatches) {
            if (!gameState.inventory.includes(match[1])) {
                gameState.inventory = [...gameState.inventory, match[1]];
            }
            cleanText = cleanText.replace(match[0], '');
        }

        // Inventory Remove
        const invRemMatches = [...cleanText.matchAll(/\[INVENTORY_REMOVE:\s*(.+?)\]/g)];
        for (const match of invRemMatches) {
            gameState.inventory = gameState.inventory.filter(i => i !== match[1]);
            cleanText = cleanText.replace(match[0], '');
        }

        // Clue Found
        const clueMatches = [...cleanText.matchAll(/\[CLUE_FOUND:\s*(.+?)\]/g)];
        for (const match of clueMatches) {
            if (!gameState.clues.includes(match[1])) {
                gameState.clues = [...gameState.clues, match[1]];
            }
            cleanText = cleanText.replace(match[0], '');
        }

        // Win/Lose
        if (cleanText.includes('[WIN_CONDITION_MET]')) {
            gameState.status = 'won';
            cleanText = cleanText.replace('[WIN_CONDITION_MET]', '');
        }
        if (cleanText.includes('[LOSE_CONDITION_MET]')) {
            gameState.status = 'lost';
            cleanText = cleanText.replace('[LOSE_CONDITION_MET]', '');
        }

        return cleanText.trim();
    }

    onMount(async () => {
        const res = await fetch('/api/escape-room/init', { method: 'POST' });
        const data = await res.json();
        const cleanText = parseTagsAndUpdateState(data.response);
        messages = [{ role: 'assistant', content: cleanText }];
        isLoading = false;
    });

    async function submitAction() {
        if (!userInput.trim() || isLoading) return;
        
        const action = userInput;
        userInput = '';
        messages = [...messages, { role: 'user', content: action }];
        isLoading = true;

        const res = await fetch('/api/escape-room/chat', {
            method: 'POST',
            body: JSON.stringify({ messages, gameState })
        });
        const data = await res.json();
        
        const cleanText = parseTagsAndUpdateState(data.response);
        messages = [...messages, { role: 'assistant', content: cleanText }];
        isLoading = false;
    }
</script>

<div class="flex h-screen bg-[#0a0a0a] text-white p-4 gap-4">
    <!-- Chat Area -->
    <div class="flex-1 flex flex-col bg-[#111] rounded-xl p-4 border border-[#222]">
        <h1 class="text-2xl font-bold mb-4">🚪 Escape Room</h1>
        
        <div class="flex-1 overflow-y-auto space-y-4 mb-4">
            {#each messages as msg}
                <div class="p-3 rounded-lg {msg.role === 'user' ? 'bg-[#222] self-end ml-12' : 'bg-[#1a1a1a] text-[#aaa] mr-12'}">
                    {msg.content}
                </div>
            {/each}
            {#if isLoading}
                <div class="text-[#666] animate-pulse">DM is typing...</div>
            {/if}
            {#if gameState.status === 'won'}
                <div class="p-4 bg-green-900 text-green-100 rounded-lg text-center font-bold">🎉 You Escaped!</div>
            {:else if gameState.status === 'lost'}
                <div class="p-4 bg-red-900 text-red-100 rounded-lg text-center font-bold">💀 Game Over</div>
            {/if}
        </div>

        <form on:submit|preventDefault={submitAction} class="flex gap-2">
            <input 
                bind:value={userInput} 
                disabled={isLoading || gameState.status !== 'playing'}
                placeholder="What do you do?" 
                class="flex-1 bg-[#222] border border-[#333] rounded-lg px-4 py-2 focus:outline-none focus:border-[#444]"
            />
            <button 
                type="submit" 
                disabled={isLoading || gameState.status !== 'playing'}
                class="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50"
            >
                Send
            </button>
        </form>
    </div>

    <!-- HUD Sidebar -->
    <div class="w-80 flex flex-col gap-4">
        <!-- Location -->
        <div class="bg-[#111] rounded-xl p-4 border border-[#222]">
            <h2 class="text-[#666] text-xs font-bold uppercase tracking-widest mb-2">Location</h2>
            <div class="text-xl font-bold">{gameState.location}</div>
        </div>

        <!-- Inventory -->
        <div class="bg-[#111] rounded-xl p-4 border border-[#222] flex-1">
            <h2 class="text-[#666] text-xs font-bold uppercase tracking-widest mb-4">Inventory</h2>
            <div class="grid grid-cols-2 gap-2">
                {#each gameState.inventory as item}
                    <div class="bg-[#222] p-2 rounded flex flex-col items-center justify-center text-center aspect-square">
                        <span class="text-3xl mb-1">{item.split(' ')[0]}</span>
                        <span class="text-xs text-[#aaa]">{item.split(' ').slice(1).join(' ')}</span>
                    </div>
                {/each}
                {#if gameState.inventory.length === 0}
                    <div class="col-span-2 text-center text-[#444] text-sm py-4">Empty</div>
                {/if}
            </div>
        </div>

        <!-- Clues -->
        <div class="bg-[#111] rounded-xl p-4 border border-[#222] flex-1">
            <h2 class="text-[#666] text-xs font-bold uppercase tracking-widest mb-4">Clues</h2>
            <ul class="space-y-2">
                {#each gameState.clues as clue}
                    <li class="bg-[#222] px-3 py-2 rounded text-sm text-[#ccc]">{clue}</li>
                {/each}
                {#if gameState.clues.length === 0}
                    <div class="text-center text-[#444] text-sm py-4">None found</div>
                {/if}
            </ul>
        </div>
    </div>
</div>
```

**Step 2: Commit**
```bash
git add src/routes/escape-room
git commit -m "feat: add escape room frontend and hud"
```

---

### Task 4: Remove the old Whose Line code

**Files:**
- Delete: `src/routes/api/whoseline`
- Delete: `src/routes/whoseline`

**Step 1: Execute Delete Commands**
```bash
rm -rf src/routes/api/whoseline
rm -rf src/routes/whoseline
```

**Step 2: Update Links in Other Layouts (Story)**
```html
// src/routes/story/+page.svelte
------- SEARCH
				<a href="/whoseline" class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg text-[--color-muted] hover:text-white transition-colors">🎭 Whose Line</a>
=======
				<a href="/escape-room" class="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-lg text-[--color-muted] hover:text-white transition-colors">🗝️ Escape Room</a>
+++++++ REPLACE
```

**Step 3: Commit**
```bash
git commit -am "refactor: remove old whoseline game code and update links"
```
