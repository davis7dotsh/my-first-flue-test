CREATE TABLE threads_next (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	agent_name TEXT NOT NULL DEFAULT 'demo-agent',
	title TEXT NOT NULL DEFAULT 'New thread',
	has_activity INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	archived_at TEXT
);

INSERT INTO threads_next (
	id,
	owner_id,
	agent_name,
	title,
	has_activity,
	created_at,
	updated_at,
	archived_at
)
SELECT
	id,
	owner_id,
	CASE agent_name
		WHEN 'demo_agent' THEN 'demo-agent'
		ELSE agent_name
	END,
	title,
	has_activity,
	created_at,
	updated_at,
	archived_at
FROM threads;

DROP INDEX threads_owner_updated_idx;
DROP TABLE threads;
ALTER TABLE threads_next RENAME TO threads;

CREATE INDEX threads_owner_updated_idx
	ON threads (owner_id, updated_at DESC);
