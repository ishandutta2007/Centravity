-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0006: artifacts (DB index)
--
-- In v0.1.0 artifacts lived only as JSON files in artifacts/<id>/.
-- v0.2.0 keeps the files (they're convenient) but ALSO stores
-- them in a queryable DB table with a full-text-search index.
--
-- This unlocks:
--   "find me every Z3 proof from the last week"
--   "search across all artifacts for 'authentication'"
--   "show me artifacts shared with the swarm"
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS artifacts (
  id            TEXT    PRIMARY KEY,
  agent_id      TEXT    NOT NULL,
  swarm_id      TEXT,                            -- shared artifacts
  type          TEXT    NOT NULL,                -- 'execution_plan'|'diff'|'log'|
                                                  -- 'test_result'|'verification'|
                                                  -- 'z3_proof'|'error_trace'
  title         TEXT    NOT NULL,
  content       TEXT    NOT NULL,                -- markdown
  metadata_json TEXT,                            -- arbitrary JSON
  visibility    TEXT    NOT NULL DEFAULT 'private', -- 'private'|'swarm'|'public'
  created_at    INTEGER NOT NULL,

  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY(swarm_id) REFERENCES swarms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_agent  ON artifacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_swarm  ON artifacts(swarm_id) WHERE swarm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_type   ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_vis    ON artifacts(visibility);
CREATE INDEX IF NOT EXISTS idx_artifacts_time   ON artifacts(created_at DESC);

-- Full-Text Search over title and content.
-- FTS5 is built into SQLite; this gives us millisecond search
-- across millions of artifacts. The triggers below keep the FTS
-- index in sync with the artifacts table.
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  title,
  content,
  content='artifacts',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO artifacts_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;
