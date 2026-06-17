import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { threads } = await parent();
	const thread = threads.find((summary) => summary.id === params.id);

	if (!thread) {
		error(404, 'Thread not found.');
	}

	return { thread };
};
