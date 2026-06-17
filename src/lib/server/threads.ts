import { error, type Cookies } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_AGENT_NAME, NEW_THREAD_TITLE, type ThreadSummary } from '$lib/threads';

type ThreadRow = {
	id: string;
	agent_name: string;
	title: string;
	has_activity: number;
	created_at: string;
	updated_at: string;
};

const ownerCookie = 'flue-demo-owner';

type WebBindings = {
	FLUE_AGENT: {
		fetch(request: Request): Promise<Response>;
	};
	THREADS_DB: D1Database;
};

export function workerBindings(platform: App.Platform | undefined) {
	if (!platform) {
		error(503, 'Cloudflare bindings are not connected.');
	}

	return platform.env as WebBindings;
}

export function threadsDb(platform: App.Platform | undefined) {
	const db = workerBindings(platform).THREADS_DB;
	if (!db) {
		error(503, 'The thread database is not connected.');
	}

	return db;
}

export function threadOwner(cookies: Cookies, url: URL) {
	const existing = cookies.get(ownerCookie);
	if (existing) {
		return existing;
	}

	const ownerId = crypto.randomUUID();
	cookies.set(ownerCookie, ownerId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});
	return ownerId;
}

function toThread(row: ThreadRow): ThreadSummary {
	return {
		id: row.id,
		agentName: row.agent_name,
		title: row.title,
		hasActivity: row.has_activity === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function listThreads(db: D1Database, ownerId: string) {
	const result = await db
		.prepare(
			`SELECT id, agent_name, title, has_activity, created_at, updated_at
			 FROM threads
			 WHERE owner_id = ?1 AND archived_at IS NULL
			 ORDER BY updated_at DESC, id DESC`
		)
		.bind(ownerId)
		.all<ThreadRow>();

	return result.results.map(toThread);
}

export async function createThread(db: D1Database, ownerId: string) {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO threads (id, owner_id, agent_name, title, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
		)
		.bind(id, ownerId, DEFAULT_AGENT_NAME, NEW_THREAD_TITLE, now)
		.run();

	return {
		id,
		agentName: DEFAULT_AGENT_NAME,
		title: NEW_THREAD_TITLE,
		hasActivity: false,
		createdAt: now,
		updatedAt: now
	} satisfies ThreadSummary;
}

export async function getThread(db: D1Database, ownerId: string, id: string) {
	const row = await db
		.prepare(
			`SELECT id, agent_name, title, has_activity, created_at, updated_at
			 FROM threads
			 WHERE id = ?1 AND owner_id = ?2 AND archived_at IS NULL`
		)
		.bind(id, ownerId)
		.first<ThreadRow>();

	return row ? toThread(row) : null;
}

export async function archiveThread(db: D1Database, ownerId: string, id: string) {
	const result = await db
		.prepare(
			`UPDATE threads
			 SET archived_at = ?1
			 WHERE id = ?2 AND owner_id = ?3 AND archived_at IS NULL`
		)
		.bind(new Date().toISOString(), id, ownerId)
		.run();

	return result.meta.changes > 0;
}

export async function touchThread(db: D1Database, ownerId: string, id: string, message: string) {
	const now = new Date().toISOString();
	const title = message.replace(/\s+/g, ' ').trim().slice(0, 64) || NEW_THREAD_TITLE;

	await db
		.prepare(
			`UPDATE threads
			 SET updated_at = ?1,
			     has_activity = 1,
			     title = CASE WHEN title = ?2 THEN ?3 ELSE title END
			 WHERE id = ?4 AND owner_id = ?5 AND archived_at IS NULL`
		)
		.bind(now, NEW_THREAD_TITLE, title, id, ownerId)
		.run();
}
