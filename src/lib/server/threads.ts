import { error } from '@sveltejs/kit';
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

export async function listThreads(db: D1Database, userId: string) {
	const result = await db
		.prepare(
			`SELECT id, agent_name, title, has_activity, created_at, updated_at
			 FROM threads
			 WHERE user_id = ?1
			   AND archived_at IS NULL
			   AND tombstoned_at IS NULL
			 ORDER BY updated_at DESC, id DESC`
		)
		.bind(userId)
		.all<ThreadRow>();

	return result.results.map(toThread);
}

export async function createThread(db: D1Database, userId: string) {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO threads (
			     id,
			     owner_id,
			     user_id,
			     agent_name,
			     title,
			     created_at,
			     updated_at
			 )
			 VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?5)`
		)
		.bind(id, userId, DEFAULT_AGENT_NAME, NEW_THREAD_TITLE, now)
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

export async function getThread(db: D1Database, userId: string, id: string) {
	const row = await db
		.prepare(
			`SELECT id, agent_name, title, has_activity, created_at, updated_at
			 FROM threads
			 WHERE id = ?1
			   AND user_id = ?2
			   AND archived_at IS NULL
			   AND tombstoned_at IS NULL`
		)
		.bind(id, userId)
		.first<ThreadRow>();

	return row ? toThread(row) : null;
}

export async function tombstoneThread(db: D1Database, userId: string, id: string) {
	const now = new Date().toISOString();
	const result = await db
		.prepare(
			`UPDATE threads
			 SET status = 'deleting',
			     cancellation_requested_at = COALESCE(cancellation_requested_at, ?1),
			     tombstoned_at = ?1
			 WHERE id = ?2
			   AND user_id = ?3
			   AND archived_at IS NULL
			   AND tombstoned_at IS NULL`
		)
		.bind(now, id, userId)
		.run();

	return result.meta.changes > 0;
}

export async function touchThread(db: D1Database, userId: string, id: string, message: string) {
	const now = new Date().toISOString();
	const title = message.replace(/\s+/g, ' ').trim().slice(0, 64) || NEW_THREAD_TITLE;

	await db
		.prepare(
			`UPDATE threads
			 SET updated_at = ?1,
			     has_activity = 1,
			     title = CASE WHEN title = ?2 THEN ?3 ELSE title END
			 WHERE id = ?4
			   AND user_id = ?5
			   AND archived_at IS NULL
			   AND tombstoned_at IS NULL`
		)
		.bind(now, NEW_THREAD_TITLE, title, id, userId)
		.run();
}
