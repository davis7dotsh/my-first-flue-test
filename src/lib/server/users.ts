import type { D1Database } from '@cloudflare/workers-types';
import type { AccessIdentity } from '$lib/server/access';

type UserRow = {
	id: string;
	access_sub: string;
	email: string | null;
};

export type AppUser = {
	id: string;
	accessSubject: string;
	email: string | null;
};

function toUser(row: UserRow): AppUser {
	return {
		id: row.id,
		accessSubject: row.access_sub,
		email: row.email
	};
}

export async function resolveUser(db: D1Database, identity: AccessIdentity) {
	const now = new Date().toISOString();
	const row = await db
		.prepare(
			`INSERT INTO users (id, access_sub, email, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?4)
			 ON CONFLICT(access_sub) DO UPDATE SET
			     email = excluded.email,
			     updated_at = excluded.updated_at
			 RETURNING id, access_sub, email`
		)
		.bind(crypto.randomUUID(), identity.subject, identity.email, now)
		.first<UserRow>();

	if (!row) {
		throw new Error('The authenticated user could not be resolved.');
	}

	return toUser(row);
}
