import type { RequestHandler } from '@sveltejs/kit';
import { buildAgents, generateReply } from '$lib/agents';
import type { Message } from '$lib/agents';

// Each SSE event is JSON: { type: 'message' | 'done' | 'error', ... }

export const POST: RequestHandler = async ({ request }) => {
	const { topic, turns, context, agentA, agentB, messages } = (await request.json()) as {
		topic: string;
		turns: number;
		context?: string;
		agentA?: string;
		agentB?: string;
		messages?: Message[];
	};

	const safeTopic = topic?.trim() || 'What is consciousness?';
	const totalTurns = Math.min(Number(turns) || 12, 30) * 2; // Multiply by 2 debaters

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const agents = buildAgents(
          agentA ?? 'deepseek-v3.1:671b-cloud',
          agentB ?? 'deepseek-v3.2-cloud'
				);
				
				const history: Message[] = (messages || []).map((m: any) => {
					if (m.agentId === 'moderator') {
						return {
							agentId: 'moderator',
							agentName: 'Moderator',
							text: `The debate was interrupted by the Moderator, who said: '${m.text}'. You must address this point before continuing your attack on your opponent.`
						};
					}
					return m;
				});

				const aiMessagesCount = history.filter(m => m.agentId !== 'moderator').length;
				
				for (let turn = aiMessagesCount; turn < totalTurns; turn++) {
					const agent = agents[turn % agents.length];
					const text = await generateReply(agent, history, safeTopic, context, (token) => {
						send({ type: 'token', agentId: agent.id, agentName: agent.name, color: agent.color, text: token });
					});

if (!text) {
// All retries exhausted — silently skip this turn so the debate continues uninterrupted.
continue;
}

					const msg: Message = { agentId: agent.id, agentName: agent.name, text };
					history.push(msg);

					send({ type: 'message', agentId: agent.id, agentName: agent.name, color: agent.color, text });

					await new Promise((r) => setTimeout(r, 250));
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