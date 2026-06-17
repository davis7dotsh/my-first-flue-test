import { listThreads, threadOwner, threadsDb } from '$lib/server/threads';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, platform, url }) => {
	const ownerId = threadOwner(cookies, url);
	return {
		threads: await listThreads(threadsDb(platform), ownerId)
	};
};
