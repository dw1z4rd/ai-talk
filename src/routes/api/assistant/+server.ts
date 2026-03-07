import type { RequestHandler } from '@sveltejs/kit';
import { buildAssistantAgent, generateAssistantReply } from '$lib/agents';
import type { AssistantMessage } from '$lib/agents';

export const POST: RequestHandler = async ({ request }) => {
	const { modelId, messages, useSearch } = (await request.json()) as {
		modelId: string;
		messages: AssistantMessage[];
		useSearch?: boolean;
	};

	const isGemini = (modelId ?? '').startsWith('gemini');

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const agent = buildAssistantAgent(modelId ?? 'gemini-2.0-flash');

				const text = await generateAssistantReply(
					agent,
					messages,
					(useSearch ?? false) && isGemini,
					(token) => send({ type: 'token', text: token })
				);

				if (text) {
					send({ type: 'message', text });
				} else {
					send({ type: 'error', message: 'The assistant failed to respond. Please try again.' });
				}
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