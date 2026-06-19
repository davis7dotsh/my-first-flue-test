import {
	createFlueClient,
	DurableStreamError,
	FetchError,
	type AttachedAgentEvent
} from '@flue/sdk';
import { browser } from '$app/environment';
import type { ThreadSummary } from '$lib/threads';

type CachedThreadHistory = {
	events: AttachedAgentEvent[];
	eventKeys: Set<string>;
	offset: string;
};

export type PendingThreadPrompt = {
	id: string;
	text: string;
};

// Loose upper bound — keep recently visited threads warm without letting the
// client-side cache grow without limit over a long session. Evicts the
// least-recently-used thread once exceeded.
const MAX_CACHED_THREADS = 100;
const MAX_PENDING_PROMPTS_PER_THREAD = 20;
const PENDING_PROMPTS_KEY_PREFIX = 'flue:pending-prompts:';

const histories = new Map<string, CachedThreadHistory>();
const pendingHistories = new Map<string, Promise<CachedThreadHistory>>();

function pendingPromptsKey(threadId: string) {
	return `${PENDING_PROMPTS_KEY_PREFIX}${encodeURIComponent(threadId)}`;
}

export function loadPendingThreadPrompts(threadId: string) {
	if (!browser) {
		return [] satisfies PendingThreadPrompt[];
	}

	try {
		const stored = localStorage.getItem(pendingPromptsKey(threadId));
		if (!stored) {
			return [];
		}

		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((item): item is PendingThreadPrompt =>
			Boolean(
				item &&
				typeof item === 'object' &&
				'id' in item &&
				typeof item.id === 'string' &&
				'text' in item &&
				typeof item.text === 'string'
			)
		);
	} catch {
		return [];
	}
}

export function rememberPendingThreadPrompt(threadId: string, prompt: PendingThreadPrompt) {
	if (!browser) {
		return;
	}

	const prompts = loadPendingThreadPrompts(threadId).filter((item) => item.id !== prompt.id);
	try {
		localStorage.setItem(
			pendingPromptsKey(threadId),
			JSON.stringify([...prompts, prompt].slice(-MAX_PENDING_PROMPTS_PER_THREAD))
		);
	} catch {
		// The in-memory optimistic message still works when browser storage is unavailable.
	}
}

export function forgetPendingThreadPrompt(threadId: string, promptId: string) {
	if (!browser) {
		return;
	}

	const prompts = loadPendingThreadPrompts(threadId).filter((item) => item.id !== promptId);
	try {
		if (prompts.length) {
			localStorage.setItem(pendingPromptsKey(threadId), JSON.stringify(prompts));
		} else {
			localStorage.removeItem(pendingPromptsKey(threadId));
		}
	} catch {
		// Storage cleanup is best-effort and never blocks durable history rendering.
	}
}

export function eventKey(event: AttachedAgentEvent) {
	return [event.submissionId ?? 'session', event.eventIndex, event.timestamp, event.type].join(':');
}

function rememberHistory(threadId: string, history: CachedThreadHistory) {
	histories.set(threadId, history);
	while (histories.size > MAX_CACHED_THREADS) {
		const oldest = histories.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		histories.delete(oldest);
	}
}

function isMissingStream(error: unknown) {
	return (
		(error instanceof FetchError || error instanceof DurableStreamError) && error.status === 404
	);
}

export function loadThreadHistory(thread: ThreadSummary) {
	if (!browser) {
		return Promise.resolve<CachedThreadHistory>({
			events: [],
			eventKeys: new Set(),
			offset: '-1'
		});
	}

	const cached = histories.get(thread.id);
	if (cached) {
		// Touch on access so eviction stays least-recently-used.
		histories.delete(thread.id);
		histories.set(thread.id, cached);
		return Promise.resolve(cached);
	}

	const pending = pendingHistories.get(thread.id);
	if (pending) {
		return pending;
	}

	const request = (async () => {
		const client = createFlueClient({ baseUrl: '/api/flue' });
		const events: AttachedAgentEvent[] = [];
		const stream = client.agents.stream(thread.agentName, thread.id, {
			offset: '-1',
			live: false
		});

		try {
			for await (const event of stream) {
				events.push(event);
			}
		} catch (error) {
			if (!isMissingStream(error)) {
				throw error;
			}
		}

		const history = {
			events,
			eventKeys: new Set(events.map(eventKey)),
			offset: stream.offset
		};
		rememberHistory(thread.id, history);
		return history;
	})();

	pendingHistories.set(thread.id, request);
	void request.then(
		() => pendingHistories.delete(thread.id),
		() => pendingHistories.delete(thread.id)
	);

	return request;
}

export function appendThreadHistoryEvent(
	threadId: string,
	event: AttachedAgentEvent,
	offset: string
) {
	if (!browser) {
		return;
	}

	const history = histories.get(threadId);
	if (!history) {
		return;
	}

	const key = eventKey(event);
	if (!history.eventKeys.has(key)) {
		history.eventKeys.add(key);
		history.events.push(event);
	}
	history.offset = offset;
}

export function deleteThreadHistory(threadId: string) {
	if (!browser) {
		return;
	}

	histories.delete(threadId);
	pendingHistories.delete(threadId);
	try {
		localStorage.removeItem(pendingPromptsKey(threadId));
	} catch {
		// Storage cleanup is best-effort.
	}
}
