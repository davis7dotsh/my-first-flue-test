import { env } from '$env/dynamic/private';
import { parseFlueAgentPath } from '$lib/server/flue-path';
import {
	AgentRequestTooLargeError,
	stripAccessCredentials,
	submittedMessage
} from '$lib/server/flue-proxy';
import {
	admitThreadMessage,
	getThread,
	threadsDb,
	touchThread,
	workerBindings
} from '$lib/server/threads';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function isAbortError(cause: unknown) {
	return cause instanceof Error && cause.name === 'AbortError';
}

function isLocalAgentUnavailable(cause: unknown) {
	return cause instanceof TypeError && cause.message === 'fetch failed';
}

function localAgentUnavailableResponse() {
	return Response.json(
		{
			error: {
				type: 'service_unavailable',
				message: 'The local Flue agent is temporarily unavailable.',
				details: 'The durable stream client will retry automatically.'
			}
		},
		{
			status: 503,
			headers: { 'retry-after': '1' }
		}
	);
}

const proxy: RequestHandler = async ({ locals, params, platform, request, url }) => {
	if (!params.path) {
		error(404, 'Missing Flue route.');
	}

	const targetAgent = parseFlueAgentPath(params.path);
	if (!targetAgent) {
		error(404, 'Unknown Flue route.');
	}

	const db = threadsDb(platform);
	let message: string | null;
	try {
		message = await submittedMessage(request);
	} catch (cause) {
		if (cause instanceof AgentRequestTooLargeError) {
			return Response.json(
				{ error: { type: 'request_too_large', message: cause.message } },
				{ status: 413 }
			);
		}

		throw cause;
	}

	const thread = message
		? await admitThreadMessage(db, locals.user.id, targetAgent.threadId, targetAgent.agentName)
		: await getThread(db, locals.user.id, targetAgent.threadId);
	if (!thread || thread.agentName !== targetAgent.agentName) {
		error(404, 'Thread not found.');
	}

	if (message) {
		const limiter = workerBindings(platform).AI_SUBMISSION_RATE_LIMITER;
		if (!limiter) {
			error(503, 'The AI submission rate limiter is not connected.');
		}

		const { success } = await limiter.limit({ key: locals.user.id });
		if (!success) {
			return Response.json(
				{ error: { type: 'rate_limited', message: 'Too many agent submissions.' } },
				{ status: 429, headers: { 'retry-after': '60' } }
			);
		}
	}

	const localAgentUrl = env.FLUE_AGENT_URL?.replace(/\/$/, '');
	const origin = localAgentUrl ?? 'https://flue-agent.internal';
	const target = new URL(`/${params.path}`, origin);
	target.search = url.search;
	const upstreamRequest = stripAccessCredentials(new Request(target, request));

	try {
		let response: Response;
		if (localAgentUrl) {
			response = await fetch(upstreamRequest);
		} else {
			const agent = workerBindings(platform).FLUE_AGENT;
			if (!agent) {
				error(
					503,
					'The Flue agent is not connected. Set FLUE_AGENT_URL locally or configure the FLUE_AGENT service binding.'
				);
			}
			response = await agent.fetch(upstreamRequest);
		}

		if (response.ok && message) {
			await touchThread(db, locals.user.id, thread.id, message);
		}

		return response;
	} catch (cause) {
		if (request.signal.aborted || isAbortError(cause)) {
			return new Response(null, { status: 204 });
		}

		if (localAgentUrl && isLocalAgentUnavailable(cause)) {
			return localAgentUnavailableResponse();
		}

		throw cause;
	}
};

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
