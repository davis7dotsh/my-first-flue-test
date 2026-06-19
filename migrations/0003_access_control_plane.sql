CREATE TABLE users (
	id TEXT PRIMARY KEY,
	access_sub TEXT NOT NULL UNIQUE,
	email TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

ALTER TABLE threads ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE threads ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE threads ADD COLUMN active_submission_id TEXT;
ALTER TABLE threads ADD COLUMN last_event_offset TEXT;
ALTER TABLE threads ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE threads ADD COLUMN tombstoned_at TEXT;

CREATE INDEX threads_user_updated_idx
	ON threads (user_id, updated_at DESC);

CREATE INDEX threads_user_tombstone_idx
	ON threads (user_id, tombstoned_at);
