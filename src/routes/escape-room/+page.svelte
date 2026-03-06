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