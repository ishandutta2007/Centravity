-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0010: cost_events (per-LLM-call cost)
--
-- Every call to an LLM provider records one row here with the
-- exact token counts and USD cost. The orchestrator sums this
-- to enforce MAX_COST_USD and to display per-role/per-swarm
-- cost breakdowns in the Manager UI.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cost_events (
  id              TEXT    PRIMARY KEY,
  agent_id        TEXT    NOT NULL,
  swarm_id        TEXT,                            -- denormalized for fast queries
  provider        TEXT    NOT NULL,                -- 'openai'|'anthropic'|'gemini'|'ollama'|'mock'
  model           TEXT    NOT NULL,                -- the model ID
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        REAL    NOT NULL,                -- computed at write time
  created_at      INTEGER NOT NULL,

  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY(swarm_id) REFERENCES swarms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_agent       ON cost_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_swarm_time  ON cost_events(swarm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_provider    ON cost_events(provider, model);
CREATE INDEX IF NOT EXISTS idx_cost_time        ON cost_events(created_at DESC);
