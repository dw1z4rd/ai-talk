import { json } from '@sveltejs/kit';
import { buildEscapeRoomAgent, generateEscapeRoomResponse } from '$lib/agents';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
    const agent = buildEscapeRoomAgent();
    const systemContent = `Generate a random, unique setting (e.g., a haunted submarine, a sci-fi cloning lab, a 1920s speakeasy) with a single main win condition and 3-5 interactable objects. Present the opening scene to the player, set the [LOCATION_SET: 🏠 LocationName] tag, and begin the game. Always use emojis for items and locations.`;
    
    const response = await generateEscapeRoomResponse(agent, [
        { role: 'system', content: systemContent },
        { role: 'user', content: 'Start the game.' }
    ]);

    return json({ response });
};