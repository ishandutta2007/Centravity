-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0012: pragma_tuning
--
-- Final PRAGMA settings applied after all migrations. These
-- are run as a single batch at the end of the migration phase
-- to ensure a consistent configuration.
--
-- WAL = Write-Ahead Logging: concurrent readers + one writer.
-- foreign_keys = enforce referential integrity.
-- busy_timeout = wait 5s if the DB is locked by another process.
-- synchronous = NORMAL: ~10x faster than FULL, still crash-safe
--   in WAL mode (only the last transaction can be lost on power
--   failure, not the whole DB).
-- ═══════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;

-- SQLite can be configured with a per-DB user_version.
-- We set it to the migration count so other tools can detect
-- the schema version with a single PRAGMA user_version.
PRAGMA user_version = 12;
