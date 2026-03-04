import type { RequestHandler } from '@sveltejs/kit';
import { buildWhoseLineHost, generateHostLine } from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
	const {
		_hostId,
		_aliases,
		_colors,
		performances,
		game,
		scenario
	} = await request.json() as {
		_hostId: string;
		_aliases: Record<string, string>;
		_colors: Record<string, string>;
		performances: { alias: string; text: string; isPlayer?: boolean }[];
		game: { name: string; scenario: string };
		scenario: string;
	};

	const host = buildWhoseLineHost(_hostId);
	const hostAlias = _aliases[_hostId];
	const hostColor = _colors[_hostId];

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

			try {
				send({ type: 'typing', from: hostAlias, color: hostColor });

				const perfSummary = performances
					.map((p) => `${p.alias}${p.isPlayer ? ' (the human!)' : ''}: "${p.text}"`)
					.join('\n');

				const prompt = `The game was "${game.name}". Scenario: "${scenario}"\n\nHere are the performances:\n${perfSummary}\n\nNow score everyone with your signature absurd, random, completely meaningless point values. Roast and praise each performer in 1 sentence each. Be chaotic and hilarious. Total 6–10 sentences.`;

				let scoreText = '';
				await generateHostLine(host, prompt, (tok) => {
					scoreText += tok;
					send({ type: 'token', from: hostAlias, color: hostColor, text: tok });
				});
				send({ type: 'message', from: hostAlias, color: hostColor, text: scoreText });
				send({ type: 'done' });
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
