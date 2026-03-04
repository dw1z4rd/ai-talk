import type { RequestHandler } from '@sveltejs/kit';
import { buildAgents, generateReply } from '$lib/agents';
import type { Message } from '$lib/agents';

// Each SSE event is JSON: { type: 'message' | 'done' | 'error', ... }

export const POST: RequestHandler = async ({ request }) => {
	const { topic, turns, context, agentA, agentB } = (await request.json()) as {
		topic: string;
		turns: number;
		context?: string;
		agentA?: string;
		agentB?: string;
	};

	const safeTopic = topic?.trim() || 'What is consciousness?';
	const totalTurns = Math.min(Number(turns) || 12, 30);

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const agents = buildAgents(
					agentA ?? 'deepseek-v3.1:671b-cloud',
					agentB ?? 'llama3.3:70b-cloud'
				);
				const history: Message[] = [];

				for (let turn = 0; turn < totalTurns; turn++) {
					const agent = agents[turn % agents.length];
					const text = await generateReply(agent, history, safeTopic, context);

					if (!text) {
						send({ type: 'error', agentId: agent.id, message: `${agent.name} failed to respond.` });
						continue;
					}

					const msg: Message = { agentId: agent.id, agentName: agent.name, text };
					history.push(msg);

					send({ type: 'message', agentId: agent.id, agentName: agent.name, color: agent.color, text });

					await new Promise((r) => setTimeout(r, 600));
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
