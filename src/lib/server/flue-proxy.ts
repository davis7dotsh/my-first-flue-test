export const MAX_AGENT_REQUEST_BYTES = 64 * 1024;

const sensitiveUpstreamHeaders = [
	'authorization',
	'cf-access-client-id',
	'cf-access-client-secret',
	'cf-access-authenticated-user-email',
	'cf-access-jwt-assertion',
	'cookie'
];

export class AgentRequestTooLargeError extends Error {
	constructor() {
		super(`Agent requests are limited to ${MAX_AGENT_REQUEST_BYTES} bytes.`);
		this.name = 'AgentRequestTooLargeError';
	}
}

async function readLimitedBody(request: Request) {
	const declaredLength = request.headers.get('content-length');
	if (declaredLength && Number.parseInt(declaredLength, 10) > MAX_AGENT_REQUEST_BYTES) {
		throw new AgentRequestTooLargeError();
	}

	const reader = request.clone().body?.getReader();
	if (!reader) {
		return '';
	}

	const decoder = new TextDecoder();
	let size = 0;
	let body = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				return body + decoder.decode();
			}

			size += value.byteLength;
			if (size > MAX_AGENT_REQUEST_BYTES) {
				throw new AgentRequestTooLargeError();
			}

			body += decoder.decode(value, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

export async function submittedMessage(request: Request) {
	if (request.method !== 'POST') {
		return null;
	}

	try {
		const body: unknown = JSON.parse(await readLimitedBody(request));
		if (typeof body !== 'object' || body === null) {
			return null;
		}

		const message = Reflect.get(body, 'message');
		return typeof message === 'string' ? message : null;
	} catch (cause) {
		if (cause instanceof AgentRequestTooLargeError) {
			throw cause;
		}

		return null;
	}
}

export function stripAccessCredentials(request: Request) {
	const upstreamRequest = new Request(request);
	for (const header of sensitiveUpstreamHeaders) {
		upstreamRequest.headers.delete(header);
	}

	return upstreamRequest;
}
