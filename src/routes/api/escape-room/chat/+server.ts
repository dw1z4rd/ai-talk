import { json } from '@sveltejs/kit';
import { buildEscapeRoomAgent, generateEscapeRoomResponse } from '$lib/agents';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const { messages, gameState } = await request.json();
    
    const agent = buildEscapeRoomAgent();

    const response = await generateEscapeRoomResponse(agent, messages, gameState);

    return json({ response });
};