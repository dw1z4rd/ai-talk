import { json } from '@sveltejs/kit';
import { buildEscapeRoomAgent, generateEscapeRoomResponse } from '$lib/agents';
import type { RequestHandler } from './$types';

const GENRES = [
    "Cyberpunk Dystopia",
    "Gothic Horror Castle",
    "Abandoned Underwater Research Facility",
    "Medieval Alchemist's Tower",
    "Derelict Space Station",
    "1920s Noir Detective Office",
    "Ancient Egyptian Tomb",
    "Post-Apocalyptic Wasteland Bunker",
    "Victorian Steampunk Train",
    "Alien Planetary Outpost",
    "Secret Government Area 51 Vault",
    "Haunted Victorian Orphanage",
    "Pirate Captain's Sinking Galleon",
    "Overgrown Mayan Temple",
    "High-Tech Corporate Espionage Server Room"
];

export const POST: RequestHandler = async () => {
    const agent = buildEscapeRoomAgent();
    const randomGenre = GENRES[Math.floor(Math.random() * GENRES.length)];
    
    const systemContent = `You are designing a brand new escape room. 
The theme/genre for this specific game MUST be: **${randomGenre}**.
Do not use any generic labs or repetitive tropes. Lean heavily into the aesthetics, vocabulary, and unique objects of the assigned genre.

Create a completely original scenario with a single main win condition and 3-5 highly thematic interactable objects. 
CRITICAL: You MUST design a strictly logical and solvable puzzle path. The solution must make sense based on the items provided. 
Present the opening scene to the player, describing the room and dropping a hint about how to escape. Set the [LOCATION_SET: 🏠 LocationName] tag, and begin the game. Always use emojis for items and locations.`;
    
    const response = await generateEscapeRoomResponse(agent, [
        { role: 'system', content: systemContent },
        { role: 'user', content: 'Start the game.' }
    ]);

    return json({ response });
};