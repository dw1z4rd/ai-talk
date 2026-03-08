import type { RequestHandler } from '@sveltejs/kit';
import { buildJudgeAgent, generateJudgeVerdict } from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
	const { judgeId, agentAName, agentBName, topic, transcript } = (await request.json()) as {
		judgeId: string;
		agentAName: string;
		agentBName: string;
		topic: string;
		transcript: string;
	};

	const judge = buildJudgeAgent(judgeId, agentAName, agentBName);

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				await generateJudgeVerdict(judge, topic, transcript, (token) => {
					send({ type: 'token', text: token });
				});
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