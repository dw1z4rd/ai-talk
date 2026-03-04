import type { RequestHandler } from '@sveltejs/kit';
import { buildStoryAgents, generateStoryContinuation } from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
	const { premise, agentIds, rounds } = (await request.json()) as {
		premise: string;
		agentIds: string[];
		rounds: number;
	};

	const safePremise = premise?.trim() || 'Once upon a time, in a city that never slept,';
	const totalRounds = Math.min(Number(rounds) || 6, 20);
	const safeAgentIds = Array.isArray(agentIds) && agentIds.length >= 2 ? agentIds : agentIds?.slice(0, 4);

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const agents = buildStoryAgents(safeAgentIds);
				let storySoFar = safePremise;
				const totalTurns = totalRounds * agents.length;

				for (let turn = 0; turn < totalTurns; turn++) {
					const agent = agents[turn % agents.length];

					const text = await generateStoryContinuation(agent, storySoFar, (token) => {
						send({ type: 'token', agentId: agent.id, agentName: agent.name, color: agent.color, text: token });
					});

					if (!text) {
						send({ type: 'error', agentId: agent.id, message: `${agent.name} failed to respond.` });
						continue;
					}

					storySoFar += '\n\n' + text;

					send({ type: 'paragraph', agentId: agent.id, agentName: agent.name, color: agent.color, text });

					await new Promise((r) => setTimeout(r, 150));
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
