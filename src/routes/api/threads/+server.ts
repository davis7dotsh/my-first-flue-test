import { createThread, listThreads, threadsDb } from '$lib/server/threads';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform }) => {
	return json(await listThreads(threadsDb(platform), locals.user.id));
};

export const POST: RequestHandler = async ({ locals, platform }) => {
	return json(await createThread(threadsDb(platform), locals.user.id), { status: 201 });
};
