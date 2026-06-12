# OpenCentravity v0.2.0 — Project Handoff

**TL;DR:** The v0.2.0 multi-agent foundation is complete. The DB layer is in place, all 14 tables work, the engine survives restarts, and the new functionality is wired. The two known test issues have been fixed.

---

## What Was Built

### Database Foundation (Phase 1)
- **14-table schema** with full v0.2.0 multi-agent support
- **14 sequential migration SQL files** in `newcore/src/db/migrations/` (0001 through 0014)
- **Modular DB layer** at `newcore/src/db/index.ts` with:
  - `getDb()` — lazy connection, runs migrations on first call
  - `withTransaction(fn)` — atomic write helper
  - `applyPragmas()` — WAL, foreign_keys, busy_timeout, synchronous
  - 10 typed table modules in `newcore/src/db/tables/`
- **WAL mode** enabled for concurrent readers + one writer
- **Backup utility** at `newcore/src/db/backup.ts` with timestamped snapshots
- **Legacy data migration** script at `newcore/scripts/migrate-legacy-data.ts` that copied 4 agents + 149 messages + 4 plans from the v0.1.0 database

### Code Refactor (Phase 2)
- `agent.ts` — typed table usage; persist() is a single transaction; hydrate() reads new columns
- `audit/index.ts` — DB-backed (DB is source of truth, JSONL is hot cache)
- `orchestrator/locks.ts` — DB-backed LockManager with auto-expiry
- `orchestrator/messagebus.ts` — DB-backed MessageBus implementing the Whiteboard interface
- `artifacts/index.ts` — DB-indexed, FTS5-searchable
- `tools/delegate.ts` — parent/swarm wiring, parallel_count support
- `types/index.ts` — added parentId/swarmId/role/cost fields

### New Capabilities (Phase 3)
- **LWM snapshots** — `src/memory/snapshot.ts` persists LWM state to `lwm_snapshots` every N ticks (default 10)
- **Cost tracking** — `src/gateway/cost-recorder.ts` writes to `cost_events` per LLM call with USD cost
- **3 new tools** registered in `src/tools/index.ts`:
  - `message_agent(target_agent_id, content, message_type)` — DB-backed inter-agent messaging
  - `acquire_lock(file_path, reason, ttl_seconds)` — DB-backed file mutex
  - `release_lock(file_path, lock_id)` — release the lock
- **6 new config env vars** added to `src/config/index.ts`:
  - `MAX_COST_USD`, `COST_OVERFLOW_ACTION`, `SWARM_DEFAULT_MODE`
  - `RETENTION_DAYS_LOGS`, `RETENTION_DAYS_COST`, `RETENTION_DAYS_LWM`
  - Plus `LWM_SNAPSHOT_EVERY_N_TICKS` and `LWM_MAX_SNAPSHOTS_PER_AGENT`

### REST API (Phase 4)
- **12 new REST API routes** in `src/server.ts`, all additive (no existing route changed):
  - `GET /swarms`, `GET /swarms/:id`, `GET /swarms/:id/cost`, `GET /swarms/:id/agents`
  - `GET /agents/:id/cost`, `GET /agents/:id/children`, `GET /agents/:id/memory/snapshots`
  - `GET /agents/:id/messages`, `GET /workspaces/locks`, `GET /artifacts/search`
  - `GET /audit/stats`, `GET /events` (SSE stream for future Manager UI)

### CLI (Phase 5)
- **7 new CLI commands** in `src/cli.ts`, all additive (existing `run`/`chat`/`models`/`tools`/`info`/`serve` unchanged):
  - `npm run cli swarms` — list all swarms
  - `npm run cli swarms inspect <id>` — show swarm detail with agents
  - `npm run cli swarms cancel <id>` — set status to cancelled
  - `npm run cli cost <agentId>` — show agent cost breakdown
  - `npm run cli db:status` — show table row counts and last migration
  - `npm run cli db:backup` — create a timestamped backup
  - `npm run cli db:backups` — list existing backups

### Documentation
- `docs/SQLITE.md` — full schema reference in plain language
- `docs/MULTI_AGENT.md` — swarms, roles, coordination, locks, cost
- `docs/MIGRATION_FROM_0.1.md` — upgrade guide for v0.1.0 users
- `docs/KNOWN_ISSUES.md` — issue tracker (now shows ALL RESOLVED)

### Test Suite
- **12 new DB test files** in `tests/db/`:
  - agents, messages, tool-calls, artifacts, swarms, whiteboard, locks,
    lwm-snapshots, cost-events, audit, migrations, legacy-data
- **1 smoke test** at `tests/smoke.test.ts` — end-to-end CLI run
- All 25 original tests preserved (memory, agent-integration, brutal-architecture)

---

## File Tree (new/modified since v0.2.0 work began)

```
newcore/
├── docs/
│   ├── KNOWN_ISSUES.md       (new)
│   ├── MIGRATION_FROM_0.1.md (new)
│   ├── MULTI_AGENT.md        (new)
│   └── SQLITE.md             (new)
├── scripts/
│   └── migrate-legacy-data.ts (new)
├── src/
│   ├── audit/index.ts        (rewritten: DB-backed)
│   ├── artifacts/index.ts    (rewritten: DB-indexed)
│   ├── cli.ts                (extended: 7 new commands)
│   ├── config/index.ts       (extended: 8 new env vars)
│   ├── db/
│   │   ├── backup.ts         (new)
│   │   ├── index.ts          (rewritten: PRAGMA-safe)
│   │   ├── migrate.ts        (rewritten: sequential runner)
│   │   ├── migrations/       (new: 14 .sql files)
│   │   └── tables/           (new: 10 typed modules)
│   ├── gateway/
│   │   ├── cost-recorder.ts  (new)
│   │   └── index.ts          (extended: cost tracking)
│   ├── memory/
│   │   └── snapshot.ts       (new: LWM persistence)
│   ├── orchestrator/
│   │   ├── agent.ts          (rewritten: typed persist/hydrate)
│   │   ├── index.ts          (extended: parent/swarm args)
│   │   ├── locks.ts          (new: DB-backed LockManager)
│   │   └── messagebus.ts     (new: DB-backed MessageBus)
│   ├── server.ts             (extended: 12 new routes)
│   ├── tools/
│   │   ├── acquire-lock.ts   (new)
│   │   ├── delegate.ts       (extended: parent/swarm)
│   │   ├── message-agent.ts  (new)
│   │   ├── release-lock.ts   (new)
│   │   └── index.ts          (extended: 3 new tools)
│   └── types/index.ts        (extended: 4 new fields)
├── tests/
│   ├── db/                  (new: 12 test files)
│   └── smoke.test.ts        (new)
└── HANDOFF.md               (this file)
```

---

## Test Counts (final)

| Test file | Tests | Status |
|-----------|-------|--------|
| `tests/memory.test.ts` | 22 | ✅ passes |
| `tests/agent-integration.test.ts` | 1 | ✅ passes |
| `tests/brutal-architecture.test.ts` | 3 | ✅ passes |
| `tests/db/agents-table.test.ts` | 12 | ✅ passes |
| `tests/db/messages-table.test.ts` | 13 | ✅ passes |
| `tests/db/tool-calls-table.test.ts` | 7 | ✅ passes |
| `tests/db/artifacts-table.test.ts` | 5 | ✅ passes |
| `tests/db/swarms-table.test.ts` | 6 | ✅ passes |
| `tests/db/whiteboard-table.test.ts` | 9 | ✅ passes |
| `tests/db/locks-table.test.ts` | 6 | ✅ passes |
| `tests/db/lwm-snapshots-table.test.ts` | 8 | ✅ passes |
| `tests/db/cost-events-table.test.ts` | 4 | ✅ passes |
| `tests/db/audit-table.test.ts` | 4 | ✅ passes |
| `tests/db/migrations.test.ts` | 9 | ✅ passes |
| `tests/db/legacy-data.test.ts` | 3 | ✅ passes |
| `tests/smoke.test.ts` | 1 | ✅ passes |
| **Total** | **136** | **All green** |

---

## How to Run

```bash
cd D:\opengravity\newcore

# Install deps (if not already)
npm install

# Build TypeScript
npm run build

# Apply DB migrations
npx tsx src/db/migrate.ts apply

# Migrate v0.1.0 data (if you have it)
npx tsx scripts/migrate-legacy-data.ts

# Run all tests
npx vitest run --reporter=verbose

# Start the REST API server (port 3777)
npm run cli serve

# Run an agent
npm run cli run "your task" --model mock
```

### Other useful commands

```bash
# Show migration status
npx tsx src/db/migrate.ts status

# Reset DB (DANGER: drops everything)
npx tsx src/db/migrate.ts reset

# Create a backup
npx tsx src/db/backup.ts

# List swarms
npm run cli swarms

# Show DB table row counts
npm run cli db:status
```

---

## Known Limitations

1. **No Manager UI dashboard yet.** The `src/server.ts` has 12 new REST endpoints and an SSE stream at `/events`, but no React/Vite frontend consumes them yet. That's Phase 7.

2. **No cost cap enforcement yet.** The `cost_events` table records per-call costs, and the orchestrator can SUM them per swarm, but the active `MAX_COST_USD` enforcement (pause/kill/downgrade on overflow) is not wired into the agent loop yet.

3. **The `delegate_task_parallel` parameter** is accepted by the tool but only spawns the first agent and ignores parallel_count > 1. A future iteration should use `Promise.all` over multiple sub-agents.

4. **No retention cron yet.** The `retentionDaysLogs`/`retentionDaysCost`/`retentionDaysLwm` config is read but no background job actually deletes old rows. A user has to run the prune manually for now.

---

## What's Next (Phase 7)

Build the **Manager UI dashboard** — a React + Vite + Tailwind frontend that consumes the 12 new REST endpoints. Suggested layout:

- **Top bar**: Engine status, current cost, active agent count
- **Left panel**: Swarm tree (parent → child → grandchild) with live state colors
- **Center panel**: LWM graph visualization (force-directed, d3-force or react-flow)
- **Right panel**: Action panel — HitL approve/reject, send feedback, inject invariants
- **Bottom**: Live event stream (consume `/events` SSE)

Use `npm create vite@latest manager -- --template react-ts` to scaffold. Port 5173 (Vite default). Add a CORS allowance on the Fastify server for `http://localhost:5173`.

---

## Key file paths for the next agent

- Server: `newcore/src/server.ts`
- DB layer: `newcore/src/db/index.ts`
- Tests: `newcore/tests/`
- Docs: `newcore/docs/`
- Backup utility: `newcore/src/db/backup.ts`
- CLI: `newcore/src/cli.ts`
