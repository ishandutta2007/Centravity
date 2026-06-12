-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0008: file_locks (DB-backed mutexes)
--
-- v0.1.0 file locks were an in-memory Set<string> in the
-- orchestrator. Two problems: (1) restart lost them, (2) two
-- processes racing wrote garbage. v0.2.0 moves them to the DB.
--
-- Locks have an expires_at timestamp so a crashed agent's locks
-- auto-release after LOCK_TTL_SECONDS. A holder is the agent_id
-- that acquired the lock; only the same agent can release.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS file_locks (
  id                TEXT    PRIMARY KEY,
  workspace_dir     TEXT    NOT NULL,
  file_path         TEXT    NOT NULL,
  held_by_agent_id  TEXT    NOT NULL,
  acquired_at       INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  reason            TEXT,                            -- 'write' | 'read-modify-write' | 'exclusive'

  FOREIGN KEY(held_by_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- A given file within a workspace can have at most one active lock.
-- The composite UNIQUE index enforces this at the DB level so we
-- can never have two concurrent writers, even from different
-- processes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_locks_path
  ON file_locks(workspace_dir, file_path)
  WHERE expires_at > 0;

CREATE INDEX IF NOT EXISTS idx_locks_holder ON file_locks(held_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_locks_expiry ON file_locks(expires_at);
