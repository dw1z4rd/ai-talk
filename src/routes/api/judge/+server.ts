import type { RequestHandler } from '@sveltejs/kit';
import { getLiveJudgeState, getLiveJudgeSystem } from '$lib/agents';

// Get current live judge panel state
export const GET: RequestHandler = async () => {
	try {
		const judgeState = getLiveJudgeState();
		
		return new Response(JSON.stringify({
			success: true,
			panelState: judgeState
		}), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({
			success: false,
			error: String(error)
		}), {
			status: 500,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	}
};

// Reset live judge system
export const DELETE: RequestHandler = async () => {
	try {
		const liveJudgeSystem = getLiveJudgeSystem();
		liveJudgeSystem.reset();
		
		return new Response(JSON.stringify({
			success: true,
			message: 'Live judge system reset successfully'
		}), {
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({
			success: false,
			error: String(error)
		}), {
			status: 500,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	}
};
