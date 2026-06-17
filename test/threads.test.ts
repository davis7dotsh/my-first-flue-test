import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createThread, getThread, listThreads, tombstoneThread } from '../src/lib/server/threads';
import { resolveUser } from '../src/lib/server/users';

async function createUser(subject: string) {
	return resolveUser(env.THREADS_DB, {
		subject,
		email: `${subject}@example.com`
	});
}

describe('Access-owned threads', () => {
	it('isolates threads between authenticated users', async () => {
		const alice = await createUser('alice');
		const bob = await createUser('bob');
		const thread = await createThread(env.THREADS_DB, alice.id);

		expect(await getThread(env.THREADS_DB, alice.id, thread.id)).toEqual(thread);
		expect(await getThread(env.THREADS_DB, bob.id, thread.id)).toBeNull();
		expect(await listThreads(env.THREADS_DB, bob.id)).toEqual([]);
	});

	it('does not expose legacy cookie-owned rows', async () => {
		const user = await createUser('current-user');
		const now = new Date().toISOString();

		await env.THREADS_DB.prepare(
			`INSERT INTO threads (
			     id,
			     owner_id,
			     agent_name,
			     title,
			     created_at,
			     updated_at
			 )
			 VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
		)
			.bind('legacy-thread', 'legacy-cookie-owner', 'demo-agent', 'Legacy thread', now)
			.run();

		expect(await listThreads(env.THREADS_DB, user.id)).toEqual([]);
		expect(await getThread(env.THREADS_DB, user.id, 'legacy-thread')).toBeNull();
	});

	it('hides a thread immediately after tombstoning it', async () => {
		const user = await createUser('deleter');
		const thread = await createThread(env.THREADS_DB, user.id);

		expect(await tombstoneThread(env.THREADS_DB, user.id, thread.id)).toBe(true);
		expect(await getThread(env.THREADS_DB, user.id, thread.id)).toBeNull();
		expect(await listThreads(env.THREADS_DB, user.id)).toEqual([]);

		const row = await env.THREADS_DB.prepare(
			`SELECT status, cancellation_requested_at, tombstoned_at
			 FROM threads
			 WHERE id = ?1`
		)
			.bind(thread.id)
			.first<{
				status: string;
				cancellation_requested_at: string | null;
				tombstoned_at: string | null;
			}>();

		expect(row?.status).toBe('deleting');
		expect(row?.cancellation_requested_at).not.toBeNull();
		expect(row?.tombstoned_at).not.toBeNull();
	});
});
