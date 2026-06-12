-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0005: tool_calls (normalized)
--
-- v0.1.0 stored tool calls as a JSON blob inside messages.toolCalls.
-- That made it impossible to query "which tools fail most" or
-- "what's the average latency of run_command" without parsing JSON
-- for every row.
--
-- v0.2.0 normalizes them into their own table. Old data is
-- preserved: we still read the JSON blob from messages, and a
-- separate one-time backfill populates tool_calls from existing
-- message rows.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tool_calls (
  id              TEXT    PRIMARY KEY,
  message_id      TEXT    NOT NULL,
  tool_call_id    TEXT,                        -- provider's own ID (tc.id)
  tool_name       TEXT    NOT NULL,
  arguments_json  TEXT    NOT NULL,            -- raw JSON arguments
  result_json     TEXT,                        -- raw JSON result (or null)
  success         INTEGER,                     -- 0/1; NULL = unknown
  duration_ms     INTEGER,                     -- wall-clock duration
  created_at      INTEGER NOT NULL,

  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Indexes for the queries the Manager UI / cost analyzer will run
CREATE INDEX IF NOT EXISTS idx_tool_calls_message     ON tool_calls(message_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool        ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_succ   ON tool_calls(tool_name, success);
CREATE INDEX IF NOT EXISTS idx_tool_calls_created    ON tool_calls(created_at DESC);

-- Backfill: convert legacy JSON blobs in messages.toolCalls into
-- rows in tool_calls. We do this best-effort: a malformed blob is
-- skipped (logged via the migration runner) so it doesn't block
-- the upgrade. Idempotent: re-running the migration is a no-op
-- because we mark rows as 'backfilled' in messages via a side table.
--
-- Implementation note: SQLite has no JSON parsing built in. We
-- rely on a regex from the migration runner to split the blob.
-- Here we just create the table; the backfill is in 0005b.
