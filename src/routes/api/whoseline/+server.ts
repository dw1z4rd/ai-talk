// POST /api/whoseline — host scores a completed round (SSE)
import type { RequestHandler } from '@sveltejs/kit';
import { buildWhoseLineHost, generateHostLine } from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
const {
_hostId,
_aliases,
_colors,
game,
performances,
round,
totalGames
} = (await request.json()) as {
_hostId: string;
_aliases: Record<string, string>;
_colors: Record<string, string>;
game: { name: string; scenario: string };
performances: { alias: string; text: string }[];
round: number;
totalGames: number;
};

const host = buildWhoseLineHost(_hostId);
const hostAlias = _aliases[_hostId];
const hostColor = _colors[_hostId];
const isLastRound = round >= totalGames;

const perfSummary = performances
.map((p) => `${p.alias}: "${p.text.slice(0, 150).trim()}${p.text.length > 150 ? '...' : ''}"`)
.join('\n');

const prompt = isLastRound
? `That was the FINAL game! React to these performances from "${game.name}":\n${perfSummary}\n\nAward completely absurd, ridiculous final point totals (like "a million bajillion" or "negative infinity"). Crown the winner dramatically even though the points mean nothing. Sign off the show with your signature terrible pun and remind everyone the points don't matter.`
: `Round ${round} of ${totalGames} is over! React to these performances from "${game.name}":\n${perfSummary}\n\nAward completely absurd, unequal, nonsensical points to each performer (e.g. "47 points and a cheese grater"). Be funny and brief — 3 to 4 sentences max. Keep it moving!`;

const stream = new ReadableStream({
async start(controller) {
const send = (data: object) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
try {
send({ type: 'typing', from: hostAlias, color: hostColor });
let full = '';
await generateHostLine(host, prompt, (tok) => {
full += tok;
send({ type: 'token', from: hostAlias, color: hostColor, text: tok });
});
send({ type: 'message', from: hostAlias, color: hostColor, text: full });
if (isLastRound) {
send({ type: 'show_over' });
}
send({ type: 'done' });
} catch (err) {
send({ type: 'error', message: String(err) });
} finally {
controller.close();
}
}
});

return new Response(stream, {
headers: {
'Content-Type': 'text/event-stream',
'Cache-Control': 'no-cache',
Connection: 'keep-alive'
}
});
};
