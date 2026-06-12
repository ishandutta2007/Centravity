-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0001: Initial v1 schema (legacy)
-- This is the original 3-table schema that shipped in v0.1.0.
-- We keep it here so that:
--   1. Fresh installs get a known starting point.
--   2. The migration runner can diff old vs new.
-- The 3 tables are declared exactly as the original code used
-- CREATE TABLE IF NOT EXISTS — no foreign keys, no extra indexes.
-- ═══════════════════════════════════════════════════════════════

-- ── agents ──────────────────────────────────────────────────────
-- The single root table. One row per agent ever created.
-- v1 columns only — v0.2.0 adds parent_id, role, swarm_id, etc.
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT    PRIMARY KEY,
  task          TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  workspaceDir  TEXT    NOT NULL,
  currentStep   INTEGER NOT NULL DEFAULT 0,
  startedAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

-- ── plans ───────────────────────────────────────────────────────
-- One plan per agent (1:1 keyed by agentId). Stored as a JSON blob
-- because the plan shape evolves; in v0.2.0 we keep this blob but
-- also derive plan steps from messages.
CREATE TABLE IF NOT EXISTS plans (
  agentId  TEXT PRIMARY KEY,
  planJson TEXT NOT NULL,
  FOREIGN KEY(agentId) REFERENCES agents(id)
);

-- NOTE: the `messages` table is declared in migration 0005
-- (not here) so that 0005b can ALTER it without breaking
-- fresh installs.