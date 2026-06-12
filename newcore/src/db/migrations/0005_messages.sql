-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0005: messages table (v1 creation)
--
-- v0.1.0 stored messages in a `messages` table. This migration
-- is the one that CREATES the table for fresh installs. v0.2.0
-- migration 0005b adds two columns to it.
--
-- Splitting the table creation from the column adds lets us
-- keep the v1 schema declaration in one place (0001) and
-- evolve the schema incrementally. But for fresh installs,
-- 0001 only declares the agents table; the messages table is
-- declared here. The v0.1.0 DB had both tables, so we add
-- IF NOT EXISTS guards.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT    PRIMARY KEY,
  agentId     TEXT    NOT NULL,
  role        TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  toolCalls   TEXT,
  toolCallId  TEXT,
  name        TEXT,
  createdAt   INTEGER NOT NULL,
  FOREIGN KEY(agentId) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_agent_ts ON messages(agentId, createdAt);
