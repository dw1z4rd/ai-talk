import fs from 'node:fs/promises';
import path from 'node:path';
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
    // Explicitly target the logs folder in the project root
    const logPath = path.join(process.cwd(), 'logs', 'tarpit_victims.jsonl');
    
    let rawData = '';
    
    try {
        rawData = await fs.readFile(logPath, 'utf-8');
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            // The file doesn't exist yet, meaning no bots have finished suffering.
            return { victims: [], totalWasted: 0 };
        }
        console.error('Error reading tarpit logs:', err);
        throw error(500, 'Failed to read tarpit logs.');
    }

    // Parse the JSON Lines safely
    const lines = rawData.split('\n').filter(Boolean);
    const logs = lines.map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null; // Silently ignore any corrupted lines if the server crashed mid-write
        }
    }).filter(Boolean);

    // We only care about the drop events because they contain the final duration
    const dropEvents = logs.filter((log: any) =>
      log.event === 'connection_dropped' || log.event === 'bomb_served'
    );

    // Sort by longest duration first
    dropEvents.sort((a: any, b: any) => parseFloat(b.duration_seconds ?? 0) - parseFloat(a.duration_seconds ?? 0));

    // Calculate total time stolen from the internet
    const totalWasted = dropEvents.reduce((acc: number, curr: any) => acc + parseFloat(curr.duration_seconds ?? 0), 0);

    return {
        // Return the top 50 longest suffering bots
        victims: dropEvents.slice(0, 50),
        totalWasted: totalWasted.toFixed(1)
    };
};

export const actions: Actions = {
    nuke: async () => {
        const logPath = path.join(process.cwd(), 'logs', 'tarpit_victims.jsonl');
        
        try {
            await fs.unlink(logPath); // Completely delete the file
            return { success: true };
        } catch (err: any) {
            // If the file is already gone, consider it a success anyway
            if (err.code === 'ENOENT') {
                return { success: true }; 
            }
            console.error('[Tarpit] Failed to nuke logs:', err);
            return fail(500, { message: 'Failed to obliterate the log file.' });
        }
    }
};