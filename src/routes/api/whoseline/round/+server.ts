import type { RequestHandler } from '@sveltejs/kit';
import {
	WHOSE_LINE_GAMES,
	buildWhoseLineHost,
	buildWhoseLineContestant,
	generateHostLine,
	generateContestantPerformance
} from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
	const {
		_hostId,
		_contestantIds,
		_aliases,
		_colors,
		round,
		totalGames
	} = await request.json() as {
		_hostId: string;
		_contestantIds: [string, string];
		_aliases: Record<string, string>;
		_colors: Record<string, string>;
		round: number;
		totalGames: number;
	};

	// Pick a random game (not ai_invented for now, keep classic)
	const classics = WHOSE_LINE_GAMES.filter((g) => g.classic);
	const game = classics[Math.floor(Math.random() * classics.length)];

	const host = buildWhoseLineHost(_hostId);
	const hostAlias = _aliases[_hostId];
	const hostColor = _colors[_hostId];

	const contestants = _contestantIds.map((id) => buildWhoseLineContestant(id));

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

			try {
				// Host announces the game
				send({ type: 'typing', from: hostAlias, color: hostColor });

				const announcePrompt = `Round ${round} of ${totalGames}. Announce the next game with your usual chaotic energy. The game is "${game.name}". Generate a funny, specific scenario for it (one sentence). Then tell the contestants it's time to perform, one at a time. Keep it under 4 sentences total.`;
				let announceText = '';
				await generateHostLine(host, announcePrompt, (tok) => {
					announceText += tok;
					send({ type: 'token', from: hostAlias, color: hostColor, text: tok });
				});
				send({ type: 'message', from: hostAlias, color: hostColor, text: announceText });

				// Extract scenario from host text or create a fallback
				const scenario = announceText || `A completely absurd scenario for ${game.name}`;

				// AI contestants perform one by one
				const performances: { alias: string; text: string }[] = [];
				for (const contestant of contestants) {
					const alias = _aliases[contestant.id];
					const color = _colors[contestant.id];

					send({ type: 'typing', from: alias, color });
					await new Promise((r) => setTimeout(r, 600));

					let perfText = '';
					const result = await generateContestantPerformance(
						contestant,
						{ name: game.name, instructions: game.instructions, scenario },
						performances.map((p) => ({ name: p.alias, text: p.text })),
						(tok) => {
							perfText += tok;
							send({ type: 'token', from: alias, color, text: tok });
						}
					);
					if (result) {
						performances.push({ alias, text: result });
						send({ type: 'message', from: alias, color, text: result });
					}

					await new Promise((r) => setTimeout(r, 300));
				}

				// Tell user it's their turn
				send({ type: 'typing', from: hostAlias, color: hostColor });
				let turnText = '';
				await generateHostLine(
					host,
					`Now it's the human player's turn! Hype them up and tell them to perform "${game.name}". Keep to 1–2 sentences.`,
					(tok) => {
						turnText += tok;
						send({ type: 'token', from: hostAlias, color: hostColor, text: tok });
					}
				);
				send({ type: 'message', from: hostAlias, color: hostColor, text: turnText });

				send({ type: 'await_input', game: { id: game.id, name: game.name, instructions: game.instructions, scenario } });
			} catch (err) {
				send({ type: 'error', message: String(err) });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }
	});
};
