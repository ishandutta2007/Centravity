-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0011: audit_v2 (DB-backed audit)
--
-- v0.1.0 audit was a JSONL file. v0.2.0 makes the DB the source
-- of truth and keeps writing to JSONL as a best-effort cache
-- (existing log-parsing tools keep working).
--
-- The shape is intentionally similar to the old AuditEntry type
-- in src/types so the existing AuditLogger.query() API is
-- preserved.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_v2 (
  id            TEXT    PRIMARY KEY,
  timestamp     INTEGER NOT NULL,
  agent_id      TEXT,
  action        TEXT    NOT NULL,                -- 'agent:start' | 'tool:write_file' | 'hitl:goal_approved' | ...
  target        TEXT    NOT NULL,                -- the resource acted on
  result        TEXT    NOT NULL,                -- 'success'|'failure'|'blocked'
  details       TEXT    NOT NULL DEFAULT '',
  duration_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_agent    ON audit_v2(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_v2(action);
CREATE INDEX IF NOT EXISTS idx_audit_time     ON audit_v2(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_result   ON audit_v2(result);
