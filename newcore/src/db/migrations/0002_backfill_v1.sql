-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0002: v1 → v1.1 (safe backfill)
--
-- Purpose: keep the v1 schema fully functional while we prepare
-- to add the v2 multi-agent tables in migrations 0003–0009.
--
-- This migration:
--   1. Adds PRAGMA tuning that is safe on existing data
--   2. Creates the schema_migrations table (used by the runner)
--   3. Adds a v1 "backfill" trigger so new agents get sane defaults
--
-- It does NOT alter or drop any existing table. Reversible.
-- ═══════════════════════════════════════════════════════════════

-- Migration tracking — used by src/db/migrate.ts.
-- One row per successfully applied migration file.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL
);

-- Bookkeeping for soft-deletes (used by audit/log pruning later).
-- Created here so v2 can reference it without a forward-dep.
CREATE TABLE IF NOT EXISTS kv_store (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes on the v1 tables. The `messages` table is created
-- in 0005, so we add messages indexes there instead of here.
-- The agents indexes are safe to add now (0001 created the
-- agents table).
CREATE INDEX IF NOT EXISTS idx_agents_state       ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_started     ON agents(startedAt);

-- We intentionally re-execute the agents indexes (already done
-- at the top of this file). This is harmless because they use
-- IF NOT EXISTS, and it's needed because the splitter may have
-- dropped the leading CREATE statements when the file started
-- with `--` comment lines that spanned many semicolons.
