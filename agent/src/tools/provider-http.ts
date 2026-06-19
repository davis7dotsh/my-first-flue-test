export type ProviderFetch = (
	input: Request | string | URL,
	init?: RequestInit
) => Promise<Response>;

type ProviderName = 'Firecrawl' | 'Context7';
type ProviderErrorKind =
	| 'aborted'
	| 'authentication'
	| 'invalid_response'
	| 'not_ready'
	| 'oversized_response'
	| 'rate_limit'
	| 'request_failed'
	| 'timeout'
	| 'unavailable';

export type ProviderDeadline = {
	signal: AbortSignal;
	error(provider: ProviderName): ProviderHttpError;
	dispose(): void;
};

const errorMessages = {
	aborted: 'request was cancelled.',
	authentication: 'authentication failed.',
	invalid_response: 'returned an invalid response.',
	not_ready: 'library documentation is not ready yet.',
	oversized_response: 'returned too much data.',
	rate_limit: 'rate limit was reached.',
	request_failed: 'request failed.',
	timeout: 'request timed out.',
	unavailable: 'is temporarily unavailable.'
} satisfies Record<ProviderErrorKind, string>;

export class ProviderHttpError extends Error {
	readonly kind: ProviderErrorKind;

	constructor(provider: ProviderName, kind: ProviderErrorKind) {
		super(`${provider} ${errorMessages[kind]}`);
		this.name = 'ProviderHttpError';
		this.kind = kind;
	}
}

export const createProviderDeadline = ({
	signal,
	parent,
	timeoutMs
}: {
	signal?: AbortSignal;
	parent?: ProviderDeadline;
	timeoutMs: number;
}) => {
	const timeoutController = new AbortController();
	const signals = [signal, parent?.signal, timeoutController.signal].filter(
		(candidate): candidate is AbortSignal => candidate !== undefined
	);
	const deadlineSignal = AbortSignal.any(signals);
	const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);

	return {
		signal: deadlineSignal,
		error(provider: ProviderName) {
			if (signal?.aborted) {
				return new ProviderHttpError(provider, 'aborted');
			}
			if (parent?.signal.aborted) {
				return parent.error(provider);
			}
			return new ProviderHttpError(provider, 'timeout');
		},
		dispose() {
			clearTimeout(timeout);
		}
	} satisfies ProviderDeadline;
};

const cancelBody = async (response: Response) => {
	if (response.body) {
		await response.body.cancel().catch(() => undefined);
	}
};

const validateContentLength = async (
	response: Response,
	maxBytes: number,
	provider: ProviderName
) => {
	const contentLength = response.headers.get('content-length');
	if (!contentLength || !/^\d+$/u.test(contentLength)) {
		return;
	}

	if (Number(contentLength) > maxBytes) {
		await cancelBody(response);
		throw new ProviderHttpError(provider, 'oversized_response');
	}
};

export const readBoundedText = async (
	response: Response,
	maxBytes: number,
	provider: ProviderName,
	deadline?: ProviderDeadline
) => {
	if (deadline?.signal.aborted) {
		await cancelBody(response);
		throw deadline.error(provider);
	}

	await validateContentLength(response, maxBytes, provider);
	if (!response.body) {
		return '';
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = '';
	let onAbort: (() => void) | undefined;
	const aborted = deadline
		? new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(deadline.error(provider));
				deadline.signal.addEventListener('abort', onAbort, { once: true });
				if (deadline.signal.aborted) {
					onAbort();
				}
			})
		: undefined;

	try {
		while (true) {
			const { done, value } = aborted
				? await Promise.race([reader.read(), aborted])
				: await reader.read();
			if (done) {
				break;
			}

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new ProviderHttpError(provider, 'oversized_response');
			}
			text += decoder.decode(value, { stream: true });
		}

		return text + decoder.decode();
	} catch (error) {
		if (error instanceof ProviderHttpError) {
			throw error;
		}
		throw new ProviderHttpError(provider, 'request_failed');
	} finally {
		if (onAbort) {
			deadline?.signal.removeEventListener('abort', onAbort);
		}
		if (deadline?.signal.aborted) {
			await reader.cancel().catch(() => undefined);
		}
		reader.releaseLock();
	}
};

export const parseBoundedJson = async (
	response: Response,
	maxBytes: number,
	provider: ProviderName,
	deadline?: ProviderDeadline
) => {
	const text = await readBoundedText(response, maxBytes, provider, deadline);
	try {
		const value: unknown = JSON.parse(text);
		return value;
	} catch {
		throw new ProviderHttpError(provider, 'invalid_response');
	}
};

export const requestProvider = async ({
	provider,
	url,
	init,
	deadline,
	fetcher
}: {
	provider: ProviderName;
	url: string | URL;
	init: RequestInit;
	deadline: ProviderDeadline;
	fetcher: ProviderFetch;
}) => {
	if (deadline.signal.aborted) {
		throw deadline.error(provider);
	}

	let response: Response;
	try {
		response = await fetcher(url, { ...init, signal: deadline.signal });
	} catch {
		if (deadline.signal.aborted) {
			throw deadline.error(provider);
		}
		throw new ProviderHttpError(provider, 'request_failed');
	}

	if (deadline.signal.aborted) {
		await cancelBody(response);
		throw deadline.error(provider);
	}
	if (provider === 'Context7' && response.status === 202) {
		await cancelBody(response);
		throw new ProviderHttpError(provider, 'not_ready');
	}
	if (provider === 'Firecrawl' && response.status === 408) {
		await cancelBody(response);
		throw new ProviderHttpError(provider, 'timeout');
	}
	if (response.ok) {
		return response;
	}

	await cancelBody(response);
	if (response.status === 401 || response.status === 403) {
		throw new ProviderHttpError(provider, 'authentication');
	}
	if (response.status === 429) {
		throw new ProviderHttpError(provider, 'rate_limit');
	}
	if (response.status >= 500) {
		throw new ProviderHttpError(provider, 'unavailable');
	}
	throw new ProviderHttpError(provider, 'request_failed');
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
