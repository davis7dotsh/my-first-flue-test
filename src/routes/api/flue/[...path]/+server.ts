import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type AgentService = {
	fetch(request: Request): Promise<Response>;
};

function hasFlueAgent(value: unknown): value is { FLUE_AGENT: AgentService } {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const binding = Reflect.get(value, 'FLUE_AGENT');
	return (
		typeof binding === 'object' &&
		binding !== null &&
		typeof Reflect.get(binding, 'fetch') === 'function'
	);
}

const proxy: RequestHandler = async ({ params, platform, request, url }) => {
	if (!params.path) {
		error(404, 'Missing Flue route.');
	}

	const localAgentUrl = env.FLUE_AGENT_URL?.replace(/\/$/, '');
	const origin = localAgentUrl ?? 'https://flue-agent.internal';
	const target = new URL(`/${params.path}`, origin);
	target.search = url.search;
	const upstreamRequest = new Request(target, request);

	try {
		if (localAgentUrl) {
			return await fetch(upstreamRequest);
		}

		const platformEnv = platform?.env;
		if (!hasFlueAgent(platformEnv)) {
			error(
				503,
				'The Flue agent is not connected. Set FLUE_AGENT_URL locally or configure the FLUE_AGENT service binding.'
			);
		}

		return await platformEnv.FLUE_AGENT.fetch(upstreamRequest);
	} catch (cause) {
		// Flue cancels its prefetched long poll when the event consumer stops at `idle`.
		if (request.signal.aborted && cause instanceof Error && cause.name === 'AbortError') {
			return new Response(null, { status: 204 });
		}

		throw cause;
	}
};

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
