-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0007: inter_agent_messages (whiteboard)
--
-- In v0.1.0 the "whiteboard" was a process-local array in the
-- orchestrator. Restarts wiped it. v0.2.0 persists messages here
-- so sub-agents can talk across server restarts.
--
-- to_agent_id NULL = broadcast to the whole swarm.
-- read_at is set when the recipient picks the message up.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inter_agent_messages (
  id            TEXT    PRIMARY KEY,
  swarm_id      TEXT    NOT NULL,
  from_agent_id TEXT    NOT NULL,
  to_agent_id   TEXT,                            -- NULL = broadcast
  content       TEXT    NOT NULL,
  message_type  TEXT    NOT NULL DEFAULT 'info', -- 'info'|'request'|'response'|'error'|'artifact_share'
  read_at       INTEGER,
  created_at    INTEGER NOT NULL,

  FOREIGN KEY(swarm_id)      REFERENCES swarms(id) ON DELETE CASCADE,
  FOREIGN KEY(from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY(to_agent_id)   REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_msg_to         ON inter_agent_messages(to_agent_id, read_at);
CREATE INDEX IF NOT EXISTS idx_msg_to_unread  ON inter_agent_messages(to_agent_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_msg_swarm_time ON inter_agent_messages(swarm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_from       ON inter_agent_messages(from_agent_id);
