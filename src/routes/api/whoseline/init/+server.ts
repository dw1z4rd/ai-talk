import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { pickRandomWhoseLineCast } from '$lib/agents';

export const POST: RequestHandler = async () => {
	const { hostId, contestantIds, aliases, colors } = pickRandomWhoseLineCast();

	// Return client-safe cast (aliases + colors only) plus opaque _ids for round/score calls
	return json({
		host: { alias: aliases[hostId], color: colors[hostId] },
		contestants: contestantIds.map((id) => ({ alias: aliases[id], color: colors[id] })),
		// passed back by client in subsequent requests — never shown in UI
		_hostId: hostId,
		_contestantIds: contestantIds,
		_aliases: aliases,
		_colors: colors
	});
};
