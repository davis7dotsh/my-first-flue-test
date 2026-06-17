import { archiveThread, threadOwner, threadsDb } from '$lib/server/threads';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, params, platform, url }) => {
	const ownerId = threadOwner(cookies, url);
	const archived = await archiveThread(threadsDb(platform), ownerId, params.id);

	if (!archived) {
		error(404, 'Thread not found.');
	}

	return new Response(null, { status: 204 });
};
