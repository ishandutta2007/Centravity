-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0003: agents v2 (multi-agent ready)
--
-- Adds columns needed for the upcoming multi-agent and sub-agent
-- features. Every column is added with a safe default so existing
-- rows remain valid. Foreign keys are declared here but only
-- enforced after the referenced tables exist (0004 swarms).
--
-- The original `agents` table is left in place; we just widen it.
--
-- Idempotency: handled by the migration runner; duplicate-column
-- errors on re-run are caught and ignored.
-- ═══════════════════════════════════════════════════════════════

-- parent_id lineage NULL means root agent no parent
ALTER TABLE agents ADD COLUMN parent_id TEXT;
ALTER TABLE agents ADD COLUMN swarm_id TEXT;
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'coder';
ALTER TABLE agents ADD COLUMN task_hash TEXT;
ALTER TABLE agents ADD COLUMN state_before_pause TEXT;
ALTER TABLE agents ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN cost_json TEXT;
ALTER TABLE agents ADD COLUMN completed_at INTEGER;
ALTER TABLE agents ADD COLUMN error TEXT;
ALTER TABLE agents ADD COLUMN artifacts_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN tool_calls_count INTEGER NOT NULL DEFAULT 0;

-- Indexes for the new query patterns
CREATE INDEX IF NOT EXISTS idx_agents_parent      ON agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_swarm       ON agents(swarm_id);
CREATE INDEX IF NOT EXISTS idx_agents_state_v2    ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_role        ON agents(role);
CREATE INDEX IF NOT EXISTS idx_agents_started_v2  ON agents(startedAt DESC);
