-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0004: swarms (team grouping)
--
-- A "swarm" is a group of agents working on a shared root task.
-- Created by the orchestrator when a parent agent spawns sub-agents.
-- The swarm carries shared invariants and a cost cap.
--
-- In v0.1.0 there was no swarm concept. The orchestrator had only
-- a flat Map<id, Agent>. The closest analog was the 'root' agent.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS swarms (
  id                TEXT    PRIMARY KEY,
  root_task         TEXT    NOT NULL,         -- the user-facing task
  root_agent_id     TEXT    NOT NULL,         -- who started the swarm
  pattern           TEXT    NOT NULL DEFAULT 'pipeline',
                                                -- 'pipeline' | 'fanout' |
                                                -- 'generator-critic' | 'tournament'
  status            TEXT    NOT NULL DEFAULT 'active',
                                                -- 'active' | 'completed' |
                                                -- 'failed' | 'cancelled'
  max_cost_usd      REAL    NOT NULL DEFAULT 0,  -- 0 = unlimited
  shared_goals_json TEXT,                       -- shared LWM goal nodes
  created_at        INTEGER NOT NULL,
  completed_at      INTEGER,

  -- FK: root_agent_id must exist in agents. ON DELETE RESTRICT
  -- (not CASCADE) so we can never accidentally delete the lineage.
  FOREIGN KEY(root_agent_id) REFERENCES agents(id) ON DELETE RESTRICT
);

-- Now that swarms exists, we can attach the FK on agents.parent_id
-- and agents.swarm_id. SQLite has no ALTER TABLE ... ADD CONSTRAINT,
-- so we do this via a recreate-table dance. Safe because we are
-- still in the migration phase and no production traffic.
--
-- We use the standard SQLite 12-step table rebuild to add FKs:
--   1. PRAGMA foreign_keys=OFF (so we can drop + recreate)
--   2. CREATE new table with FKs
--   3. INSERT SELECT from old
--   4. DROP old
--   5. RENAME new to old
--   6. Recreate indexes
--   7. PRAGMA foreign_keys=ON

PRAGMA foreign_keys = OFF;

CREATE TABLE agents_new (
  id                TEXT    PRIMARY KEY,
  task              TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  state             TEXT    NOT NULL,
  workspaceDir      TEXT    NOT NULL,
  currentStep       INTEGER NOT NULL DEFAULT 0,
  startedAt         INTEGER NOT NULL,
  updatedAt         INTEGER NOT NULL,
  parent_id         TEXT    REFERENCES agents_new(id) ON DELETE SET NULL,
  swarm_id          TEXT    REFERENCES swarms(id)     ON DELETE SET NULL,
  role              TEXT    NOT NULL DEFAULT 'coder',
  task_hash         TEXT,
  state_before_pause TEXT,
  config_json       TEXT    NOT NULL DEFAULT '{}',
  cost_json         TEXT,
  completed_at      INTEGER,
  error             TEXT,
  artifacts_count   INTEGER NOT NULL DEFAULT 0,
  tool_calls_count  INTEGER NOT NULL DEFAULT 0
);

-- The first 6 v2 columns already exist on the OLD agents table
-- (added in 0003). We copy them through. The remaining columns
-- (cost_json, completed_at, error, artifacts_count, tool_calls_count)
-- are added HERE in 0004 by including them in the new table and
-- copying NULL/default values.
INSERT INTO agents_new (
  id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt,
  parent_id, swarm_id, role, task_hash, state_before_pause, config_json,
  cost_json, completed_at, error, artifacts_count, tool_calls_count
)
SELECT
  id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt,
  parent_id, swarm_id, role, task_hash, state_before_pause, config_json,
  NULL,    -- cost_json
  NULL,    -- completed_at
  NULL,    -- error
  0,       -- artifacts_count
  0        -- tool_calls_count
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

-- Re-create the indexes on the new agents table
CREATE INDEX IF NOT EXISTS idx_agents_parent     ON agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_swarm      ON agents(swarm_id);
CREATE INDEX IF NOT EXISTS idx_agents_state_v2   ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_role       ON agents(role);
CREATE INDEX IF NOT EXISTS idx_agents_started_v2 ON agents(startedAt DESC);
CREATE INDEX IF NOT EXISTS idx_agents_state      ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_started    ON agents(startedAt);

PRAGMA foreign_keys = ON;

-- Indexes on the swarms table
CREATE INDEX IF NOT EXISTS idx_swarms_status     ON swarms(status);
CREATE INDEX IF NOT EXISTS idx_swarms_root_agent ON swarms(root_agent_id);
CREATE INDEX IF NOT EXISTS idx_swarms_created    ON swarms(created_at DESC);
