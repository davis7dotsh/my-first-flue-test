import type { AccessIdentity } from '$lib/server/access';

const loopbackHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function localDevelopmentIdentity(
	url: URL,
	clientAddress: string | undefined,
	isDevelopment: boolean
) {
	if (
		!isDevelopment ||
		!loopbackHostnames.has(url.hostname) ||
		(clientAddress !== undefined && !loopbackAddresses.has(clientAddress))
	) {
		return null;
	}

	return {
		subject: 'local-development-user',
		email: 'local-development@localhost.invalid'
	} satisfies AccessIdentity;
}
