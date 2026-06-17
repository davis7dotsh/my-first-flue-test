-- Migration number: 0001 	 2026-06-16T23:14:21.352Z

CREATE TABLE threads (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	agent_name TEXT NOT NULL DEFAULT 'demo_agent',
	title TEXT NOT NULL DEFAULT 'New thread',
	has_activity INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	archived_at TEXT
);

CREATE INDEX threads_owner_updated_idx
	ON threads (owner_id, updated_at DESC);
