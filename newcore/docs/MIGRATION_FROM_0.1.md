# Migrating from v0.1.0 to v0.2.0

**TL;DR:** Back up your old DB, run the migration runner, and run the legacy data copy. Takes under a minute.

## What's changing

| v0.1.0 | v0.2.0 |
|--------|--------|
| 3 tables | 14 tables |
| 1 file (`data/opengravity.db`) | 1 file (`data/opencentravity.db`) |
| In-memory locks | DB-backed locks |
| JSONL audit | DB audit + JSONL cache |
| Single agent | Parent/child swarms |

The `agents` table gets 11 new columns. The `messages` and `plans` tables get 2 new columns each. Everything else is new.

## Step-by-step upgrade

```bash
# 1. Stop the engine if it's running
# (Ctrl+C in the terminal, or kill the process)

# 2. Back up your old database (just in case)
cp data/opengravity.db data/snapshots/opengravity-pre-v0.2.db
cp data/audit.jsonl data/snapshots/audit-pre-v0.2.jsonl

# 3. Apply the new schema to a fresh opencentravity.db
npx tsx src/db/migrate.ts apply

# 4. Copy your old data into the new schema
npx tsx scripts/migrate-legacy-data.ts

# 5. Verify
npx tsx src/db/migrate.ts status
# Should say: "✓ Applied (12)" and "✓ Schema is up to date"

# 6. Run the engine as usual
npm run cli run "your task"
```

The legacy data script reads from `data/opengravity.db` (your v0.1.0 file) and writes into the new v0.2.0 schema. It copies all 4 of your v0.1.0 tables (agents, messages, plans) and fills in safe defaults for the new v0.2.0 columns.

## How to verify

After running the upgrade, you should see:

```bash
$ npx tsx src/db/migrate.ts status
✓ Applied (12):
  0001  0001_initial_v1.sql  (applied <date>)
  ...
  0012  0012_pragma_tuning.sql  (applied <date>)
✓ Schema is up to date.
```

And running the engine should "just work" — the public API of `Agent`, `AgentOrchestrator`, and every tool is unchanged.

## How to roll back

If something goes wrong:

```bash
# 1. Stop the engine

# 2. Restore your v0.1.0 database
cp data/snapshots/opengravity-pre-v0.2.db data/opengravity.db
cp data/snapshots/audit-pre-v0.2.jsonl data/audit.jsonl

# 3. Delete the v0.2.0 database (it'll be recreated on next run)
rm data/opencentravity.db data/opencentravity.db-wal data/opencentravity.db-shm
```

You'll be back on v0.1.0 with all your original data. No migration forward needed — the old code reads `opengravity.db`, the new code reads `opencentravity.db`. You can switch between them by which engine binary you run.
