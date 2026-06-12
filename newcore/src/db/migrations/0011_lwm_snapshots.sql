-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0009: lwm_snapshots (memory history)
--
-- The Liquid Working Memory (LWM) is in-RAM by design (zero
-- dependencies, no GPU). But for replay and observability, we
-- periodically snapshot the full LWM state to the DB.
--
-- The Manager UI will use this to show "what was the agent
-- thinking 3 steps ago?" — which is the killer feature for
-- debugging multi-agent runs.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lwm_snapshots (
  id              TEXT    PRIMARY KEY,
  agent_id        TEXT    NOT NULL,
  tick            INTEGER NOT NULL,
  active_focus    TEXT,
  cognitive_load  REAL    NOT NULL DEFAULT 0,
  nodes_json      TEXT    NOT NULL,             -- full LWM node map
  edges_json      TEXT    NOT NULL,             -- full LWM edge map
  created_at      INTEGER NOT NULL,

  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lwm_agent_tick ON lwm_snapshots(agent_id, tick);
CREATE INDEX IF NOT EXISTS idx_lwm_agent_time ON lwm_snapshots(agent_id, created_at DESC);
