import { threadsDb, tombstoneThread } from '$lib/server/threads';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	const tombstoned = await tombstoneThread(threadsDb(platform), locals.user.id, params.id);

	if (!tombstoned) {
		error(404, 'Thread not found.');
	}

	return new Response(null, { status: 202 });
};
