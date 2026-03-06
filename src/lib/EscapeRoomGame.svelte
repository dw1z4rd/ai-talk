<script lang="ts">
    import { onMount, tick } from 'svelte';

    type GameState = {
        location: string;
        inventory: string[];
        clues: string[];
        status: 'playing' | 'won' | 'lost';
    };

    let gameState = $state<GameState>({
        location: 'Unknown',
        inventory: [],
        clues: [],
        status: 'playing'
    });

    let messages = $state<{ role: 'user' | 'assistant', content: string }[]>([]);
    let userInput = $state('');
    let isLoading = $state(true);
    let chatContainer: HTMLElement;

    async function scrollToBottom() {
        await tick();
        if (chatContainer) {
            chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        }
    }

    // Helper to parse tags and update state, returning the clean text
    function parseTagsAndUpdateState(text: string) {
        let cleanText = text;
        
        // Location
        const locationMatch = cleanText.match(/\[LOCATION_SET:\s*(.+?)(?:\]|$)/);
        if (locationMatch) {
            gameState.location = locationMatch[1].trim();
            cleanText = cleanText.replace(locationMatch[0], '');
        }

        // Inventory Add
        const invAddMatches = [...cleanText.matchAll(/\[INVENTORY_ADD:\s*(.+?)(?:\]|$)/g)];
        for (const match of invAddMatches) {
            const item = match[1].trim();
            if (!gameState.inventory.includes(item)) {
                gameState.inventory = [...gameState.inventory, item];
            }
            cleanText = cleanText.replace(match[0], '');
        }

        // Inventory Remove
        const invRemMatches = [...cleanText.matchAll(/\[INVENTORY_REMOVE:\s*(.+?)(?:\]|$)/g)];
        for (const match of invRemMatches) {
            const item = match[1].trim();
            gameState.inventory = gameState.inventory.filter(i => i !== item);
            cleanText = cleanText.replace(match[0], '');
        }

        // Clue Found
        const clueMatches = [...cleanText.matchAll(/\[CLUE_FOUND:\s*(.+?)(?:\]|$)/g)];
        for (const match of clueMatches) {
            const clue = match[1].trim();
            if (!gameState.clues.includes(clue)) {
                gameState.clues = [...gameState.clues, clue];
            }
            cleanText = cleanText.replace(match[0], '');
        }

        // Win/Lose
        const winMatch = cleanText.match(/\[WIN_CONDITION_MET(?:\]|$)/);
        if (winMatch) {
            gameState.status = 'won';
            cleanText = cleanText.replace(winMatch[0], '');
        }
        
        const loseMatch = cleanText.match(/\[LOSE_CONDITION_MET(?:\]|$)/);
        if (loseMatch) {
            gameState.status = 'lost';
            cleanText = cleanText.replace(loseMatch[0], '');
        }

        // Catch any malformed tags that might have been left over to ensure they don't render
        cleanText = cleanText.replace(/\[[A-Z_]+:.*/g, '');

        return cleanText.trim();
    }

    onMount(async () => {
        const res = await fetch('/api/escape-room/init', { method: 'POST' });
        const data = await res.json();
        const cleanText = parseTagsAndUpdateState(data.response);
        messages = [{ role: 'assistant', content: cleanText }];
        isLoading = false;
        scrollToBottom();
    });

    async function submitAction() {
        if (!userInput.trim() || isLoading) return;
        
        const action = userInput;
        userInput = '';
        messages = [...messages, { role: 'user', content: action }];
        isLoading = true;
        scrollToBottom();

        const res = await fetch('/api/escape-room/chat', {
            method: 'POST',
            body: JSON.stringify({ messages, gameState })
        });
        const data = await res.json();
        
        const cleanText = parseTagsAndUpdateState(data.response);
        messages = [...messages, { role: 'assistant', content: cleanText }];
        isLoading = false;
        scrollToBottom();
    }
</script>

<div class="flex flex-col md:flex-row gap-4 w-full h-[700px]">
    <!-- Chat Area -->
    <div class="flex-1 flex flex-col bg-[--color-panel] rounded-2xl p-5 border border-[--color-border] overflow-hidden">
        
        <div bind:this={chatContainer} class="flex-1 overflow-y-auto space-y-6 mb-4 pr-3 scroll-smooth">
            {#each messages as msg}
                <div class="p-5 rounded-xl text-[15px] leading-[1.8] tracking-wide {msg.role === 'user' ? 'bg-[#222] self-end ml-16 border border-[#333] text-[#ddd]' : 'bg-[--color-surface] text-[#e2e8f0] mr-16 border border-[--color-border] shadow-sm'}">
                    <!-- Basic formatting to handle markdown bold and newlines -->
                    {#each msg.content.split('\n') as paragraph}
                        {#if paragraph.trim()}
                            <p class="mb-3 last:mb-0">
                                <!-- Replacing **text** with <strong>text</strong> safely -->
                                {@html paragraph.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>').replace(/\*(.*?)\*/g, '<em class="text-[#a1a1aa] italic">$1</em>')}
                            </p>
                        {/if}
                    {/each}
                </div>
            {/each}
            {#if isLoading}
                <div class="text-[--color-muted] animate-pulse py-2 px-1">DM is typing...</div>
            {/if}
            {#if gameState.status === 'won'}
                <div class="p-4 bg-green-900/30 border border-green-800 text-green-300 rounded-xl text-center font-bold">🎉 You Escaped!</div>
            {:else if gameState.status === 'lost'}
                <div class="p-4 bg-red-900/30 border border-red-800 text-red-300 rounded-xl text-center font-bold">💀 Game Over</div>
            {/if}
        </div>

        <form on:submit|preventDefault={submitAction} class="flex gap-3">
            <input 
                bind:value={userInput} 
                disabled={isLoading || gameState.status !== 'playing'}
                placeholder="What do you do?" 
                class="flex-1 bg-[--color-surface] border border-[--color-border] rounded-xl px-5 py-3 text-white placeholder:text-[--color-muted] focus:outline-none focus:border-[--color-accent] focus:shadow-[0_0_0_3px_#7c6af722] transition-all disabled:opacity-50"
            />
            <button 
                type="submit" 
                disabled={isLoading || gameState.status !== 'playing'}
                class="bg-[--color-accent] hover:bg-[--color-accent-hover] px-8 py-3 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-[0_0_24px_#7c6af740] hover:shadow-[0_0_32px_#7c6af760]"
            >
                Send
            </button>
        </form>
    </div>

    <!-- HUD Sidebar -->
    <div class="w-full md:w-80 flex flex-col gap-4">
        <!-- Location -->
        <div class="bg-[--color-panel] rounded-2xl p-5 border border-[--color-border]">
            <h2 class="text-[--color-muted] text-[11px] font-bold uppercase tracking-widest mb-2">Location</h2>
            <div class="text-xl font-bold">{gameState.location}</div>
        </div>

        <!-- Inventory -->
        <div class="bg-[--color-panel] rounded-2xl p-5 border border-[--color-border] flex-1">
            <h2 class="text-[--color-muted] text-[11px] font-bold uppercase tracking-widest mb-4">Inventory</h2>
            <div class="grid grid-cols-2 gap-3">
                {#each gameState.inventory as item}
                    <div class="bg-[--color-surface] border border-[--color-border] p-3 rounded-xl flex flex-col items-center justify-center text-center aspect-square shadow-sm">
                        <span class="text-4xl mb-2">{item.split(' ')[0]}</span>
                        <span class="text-xs text-[--color-muted-fg]">{item.split(' ').slice(1).join(' ')}</span>
                    </div>
                {/each}
                {#if gameState.inventory.length === 0}
                    <div class="col-span-2 text-center text-[--color-muted] text-sm py-8 border border-dashed border-[--color-border] rounded-xl bg-[--color-surface]/50">Empty</div>
                {/if}
            </div>
        </div>

        <!-- Clues -->
        <div class="bg-[--color-panel] rounded-2xl p-5 border border-[--color-border] flex-1">
            <h2 class="text-[--color-muted] text-[11px] font-bold uppercase tracking-widest mb-4">Clues</h2>
            <ul class="space-y-3">
                {#each gameState.clues as clue}
                    <li class="bg-[--color-surface] border border-[--color-border] px-4 py-3 rounded-xl text-sm text-[--color-muted-fg]">{clue}</li>
                {/each}
                {#if gameState.clues.length === 0}
                    <div class="text-center text-[--color-muted] text-sm py-8 border border-dashed border-[--color-border] rounded-xl bg-[--color-surface]/50">None found</div>
                {/if}
            </ul>
        </div>
    </div>
</div>