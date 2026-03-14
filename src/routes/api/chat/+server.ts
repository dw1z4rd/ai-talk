import type { RequestHandler } from '@sveltejs/kit';
import { buildAdaptiveAgents, generateAdaptiveReply, resetLiveJudgeDebate } from '$lib/agents';
import type { Message, LiveJudgeResult } from '$lib/agents';

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
				// Reset live judge system for new debate
				resetLiveJudgeDebate();

				const agents = buildAdaptiveAgents(
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
				
				let turn = aiMessagesCount;
				while (turn < totalTurns) {
					const agent = agents[turn % agents.length];
					const opponentAgent = agents[(turn + 1) % agents.length];
					const turnNumber = turn + 1;
					
					const result = await generateAdaptiveReply(
						agent,
						history,
						safeTopic,
						turnNumber,
						opponentAgent,
						context,
						(token) => {
							send({ type: 'token', agentId: agent.id, agentName: agent.name, color: agent.color, text: token });
						},
						(reply) => {
							// Fires as soon as the reply text is ready, before judge analysis runs.
							// Committing the message here ensures the debate moves forward even
							// if judge LLM calls are slow or unresponsive.
							history.push({ agentId: agent.id, agentName: agent.name, text: reply });
							send({ type: 'message', agentId: agent.id, agentName: agent.name, color: agent.color, text: reply });
						}
					);

					if (!result.reply) {
						// All retries exhausted — silently skip this turn so the debate continues uninterrupted.
						turn++;
						continue;
					}

					// Send judge results if available (message already sent via onReply callback)
					if (result.judgeResult) {
						console.log('[chat] sending judgeResult, reasoning length:', result.judgeResult.reasoning?.length, 'value:', JSON.stringify(result.judgeResult.reasoning)?.slice(0, 80));
						send({
							type: 'judgeResult',
							agentId: agent.id,
							turnNumber: result.judgeResult.turnNumber,
							scores: result.judgeResult.scores,
							momentumShift: result.judgeResult.momentumShift,
							frameControlShift: result.judgeResult.frameControlShift,
							tacticalAnalysis: result.judgeResult.tacticalAnalysis,
							reasoning: result.judgeResult.reasoning
						});
					}

					turn++; // Increment turn counter
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