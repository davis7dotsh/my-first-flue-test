import { listThreads, threadsDb } from '$lib/server/threads';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	return {
		threads: await listThreads(threadsDb(platform), locals.user.id)
	};
};
