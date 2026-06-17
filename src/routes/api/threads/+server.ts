import { createThread, listThreads, threadOwner, threadsDb } from '$lib/server/threads';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, platform, url }) => {
	const ownerId = threadOwner(cookies, url);
	return json(await listThreads(threadsDb(platform), ownerId));
};

export const POST: RequestHandler = async ({ cookies, platform, url }) => {
	const ownerId = threadOwner(cookies, url);
	return json(await createThread(threadsDb(platform), ownerId), { status: 201 });
};
