import { env } from '$env/dynamic/private';
import { AccessAuthenticationError, authenticateAccessRequest } from '$lib/server/access';
import { threadsDb } from '$lib/server/threads';
import { resolveUser } from '$lib/server/users';
import type { Handle } from '@sveltejs/kit';

function accessConfig() {
	const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
	const audience = env.CF_ACCESS_AUD;

	if (!teamDomain || !audience) {
		return null;
	}

	return { teamDomain, audience };
}

export const handle: Handle = async ({ event, resolve }) => {
	const config = accessConfig();
	if (!config) {
		return new Response('Cloudflare Access authentication is not configured.', {
			status: 503
		});
	}

	try {
		const identity = await authenticateAccessRequest(event.request, config);
		event.locals.user = await resolveUser(threadsDb(event.platform), identity);
		return resolve(event);
	} catch (cause) {
		if (cause instanceof AccessAuthenticationError) {
			return new Response('Forbidden', { status: 403 });
		}

		throw cause;
	}
};
