# SQLite Schema (v0.2.0)

**TL;DR:** OpenCentravity stores everything in one SQLite file at `data/opencentravity.db`. The schema is versioned, with 14 tables and a safe migration runner.

## What's in the database

The full schema has **14 tables**, organized by concern:

| Table | What it stores |
|-------|---------------|
| `agents` | One row per agent ever run. Has columns for `parent_id` (lineage), `swarm_id` (team), `role` (coder/verifier/etc.), `state` (idle/planning/executing/...), and counters. |
| `swarms` | A "team" of agents working on a shared root task. Has a `pattern` (pipeline/fanout/...), `status`, and cost cap. |
| `messages` | The full chat history for each agent. The LLM "remembers" via this table. |
| `tool_calls` | Every tool invocation: which tool, arguments, result, duration, success/failure. Queryable for "which tool fails most". |
| `artifacts` | Plans, diffs, logs, Z3 proofs, test results. Also indexed by FTS5 (see below). |
| `inter_agent_messages` | Inter-agent whiteboard messages (who sent what to whom, read receipts). |
| `file_locks` | Cross-process file mutexes. Auto-expire so crashed agents don't deadlock the team. |
| `lwm_snapshots` | Periodic snapshots of an agent's "thinking state" (the LWM graph). |
| `cost_events` | One row per LLM call. `input_tokens`, `output_tokens`, `cost_usd`. The cost analyzer queries this. |
| `audit_v2` | Full action log. Every tool call, every state change, every HitL approval. |
| `schema_migrations` | Tracks which migration files have been applied. |
| `kv_store` | Generic key-value store for internal use. |
| `agents_new` (transient) | Used by the 0004 migration's table-rebuild dance. Not used at runtime. |
| `artifacts_fts` (virtual) | FTS5 search index over artifacts. Maintained by triggers. |

## Migrations

The schema evolves via **migration files** in `newcore/src/db/migrations/`. Each file is a SQL script:

- `0001_initial_v1.sql` — the original 3-table schema from v0.1.0
- `0002_backfill_v1.sql` — adds indexes and the migration-tracking table
- `0003_agents_v2.sql` — adds multi-agent columns to `agents`
- `0004_swarms.sql` — creates the `swarms` table and rebuilds `agents` with FKs
- `0005_messages.sql` — creates the `messages` table
- `0005b_messages_v2.sql` — adds `is_pruned` and `token_count` to messages
- `0006_artifacts.sql` — creates `artifacts` + FTS5 index
- `0007_inter_agent_messages.sql` — creates the whiteboard
- `0008_file_locks.sql` — creates the lock table
- `0009_lwm_snapshots.sql` — creates the snapshot table
- `0010_cost_events.sql` — creates the cost table
- `0011_audit_v2.sql` — creates the audit table
- `0012_pragma_tuning.sql` — sets WAL, foreign_keys, busy_timeout

### How to use the migration runner

```bash
# See what's been applied
npx tsx src/db/migrate.ts status

# Apply pending migrations (safe to run repeatedly)
npx tsx src/db/migrate.ts apply

# DANGER: drop all tables (only for tests)
npx tsx src/db/migrate.ts reset
```

The first call to `getDb()` automatically runs pending migrations, so production rarely needs the manual command.

## WAL mode and concurrency

The DB runs in **WAL (Write-Ahead Logging) mode**, which means:
- Multiple readers can run concurrently with one writer (no "database is locked" errors)
- The DB file plus `data/opencentravity.db-wal` together form the consistent state
- `busy_timeout = 5000` means the DB waits up to 5 seconds for a lock before erroring

## FTS5 search

Artifacts (plans, logs, proofs) are searchable via SQLite's built-in FTS5:

```bash
# Via the API (see server.ts)
GET /artifacts/search?q=authentication

# Direct SQL
SELECT * FROM artifacts WHERE id IN (
  SELECT rowid FROM artifacts_fts WHERE artifacts_fts MATCH 'auth*'
);
```

The FTS5 index is auto-maintained by triggers on the `artifacts` table. You never need to rebuild it manually.
