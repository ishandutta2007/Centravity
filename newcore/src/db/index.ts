// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Database Layer (v0.2.0 Multi-Agent Foundation)
//
// This module is the single source of truth for every DB connection
// in the engine. It exposes:
//
//   1. getDb()                       — lazy-initialized LibSQL client
//   2. withTransaction(fn)           — atomic write helper
//   3. table-specific modules        — see ./tables/*.ts
//
// The first call to getDb() also runs any pending migrations, so
// the rest of the codebase never has to think about schema.
//
// Public API kept stable: getDb() returns the same LibSQL Client
// as v0.1.0, so existing call sites (agent.ts hydrate/persist,
// the audit logger, etc.) work unchanged.
// ═══════════════════════════════════════════════════════════════

import { createClient, type Client, type InValue } from '@libsql/client';
import { join, resolve, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { runMigrations } from './migrate.js';
import { getConfig } from '../config/index.js';

// Use a global registry to track externally-injected DBs. The
// migration runner skips migration work for any client in this
// registry. The test helper sets the entry before calling table
// functions, and resetForTests() clears it.
const _externallyInjected = new WeakSet<Client>();
export function _setInjected(client: Client): void {
  _externallyInjected.add(client);
  _db = client;
}
export function _isInjected(client: Client): boolean {
  return _externallyInjected.has(client);
}

let _db: Client | null = null;
let _migrationsRun = false;
let _migrationsPromise: Promise<any> | null = null;

// ── Prepared Statement Cache ────────────────────────────────────
// A map of SQL → prepared statement. Reusing a prepared statement
// is 2-3x faster than parsing the SQL every time, and the LWM
// snapshot writer / cost recorder / audit logger all hit the DB
// on every tick — so the speedup is real.
const _stmtCache = new Map<string, ReturnType<Client['prepare']>>();

/**
 * Returns the active LibSQL client. The first call triggers a
 * migration run; subsequent calls just return the cached client.
 */
export async function getDb(): Promise<Client> {
  // If we have a cached client, return it (awaiting migrations if they are in progress).
  if (_db) {
    if (_externallyInjected.has(_db)) {
      _migrationsRun = true;
      return _db;
    }
    if (!_migrationsRun && _migrationsPromise) {
      await _migrationsPromise;
    }
    return _db;
  }

  // No cached client; fall through to create one below.
  const config = getConfig();

  // Test runs get a unique DB file per process to avoid
  // cross-test pollution. Production uses data/opencentravity.db.
  const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
  const dbName = process.env.OPENCENTRAVITY_DB_NAME || (isTest
    ? `opencentravity_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
    : 'opencentravity.db');
  const dbPath = join(process.cwd(), 'data', dbName).replace(/\\/g, '/');
  console.log('--- DEBUG: getDb opening path:', dbPath);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Force-rebuild schema on the production DB if the schema is
  // empty. This handles the "I deleted data/opencentravity.db
  // by accident" recovery case. We detect "no tables" and
  // clear the migrations-applied flag so the runner starts fresh.
  if (!isTest && existsSync(dbPath)) {
    try {
      const r = await createClient({ url: `file:${dbPath}` }).execute(
        "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'"
      );
      if ((r.rows[0].c as number) === 0) {
        _migrationsRun = false;
      }
    } catch {
      // best effort
    }
  }

  const client = createClient({ url: `file:${dbPath}` });
  _db = client;

  if (_externallyInjected.has(client)) {
    _migrationsRun = true;
    return client;
  }

  _migrationsPromise = (async () => {
    await applyPragmas(client);
    await runMigrations(client);
    _migrationsRun = true;
  })();

  try {
    await _migrationsPromise;
  } catch (err) {
    _db = null;
    _migrationsPromise = null;
    throw err;
  }

  return _db;
}

/**
 * Applies the connection-level PRAGMAs that make SQLite behave
 * like a proper server-grade DB:
 *   - journal_mode=WAL  : concurrent readers + one writer
 *   - foreign_keys=ON   : enforce referential integrity
 *   - busy_timeout=5000 : wait 5s on lock instead of erroring
 *   - synchronous=NORMAL: faster writes, still crash-safe in WAL
 */
export async function applyPragmas(client: Client): Promise<void> {
  try { await client.execute('PRAGMA journal_mode = WAL'); } catch {}
  try { await client.execute('PRAGMA foreign_keys = ON'); } catch {}
  try { await client.execute('PRAGMA busy_timeout = 5000'); } catch {}
  try { await client.execute('PRAGMA synchronous = NORMAL'); } catch {}
}

/**
 * Runs a function inside a SQLite transaction. Commits on resolve,
 * rolls back on throw. Returns whatever fn returns.
 *
 * This is the standard "withTransaction" pattern. Every multi-row
 * write in the codebase should go through this — it makes partial
 * failures impossible.
 */
export async function withTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute('BEGIN');
  try {
    const result = await fn(db);
    await db.execute('COMMIT');
    return result;
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {
      // If ROLLBACK itself errors (rare; usually means the
      // connection is dead), the transaction is already aborted
      // server-side. We swallow this so the original error wins.
    });
    throw err;
  }
}

/**
 * Returns a prepared statement for the given SQL, caching it.
 * Use this in hot paths (audit logger, LWM snapshots, cost
 * recorder) where the same statement runs many times.
 */
export async function prepare(sql: string): Promise<ReturnType<Client['prepare']>> {
  if (_stmtCache.has(sql)) return _stmtCache.get(sql)!;
  const db = await getDb();
  const stmt = db.prepare(sql);
  _stmtCache.set(sql, stmt);
  return stmt;
}

/**
 * Convenience helper: exec a single SQL statement with no args.
 * Used by PRAGMAs and one-off maintenance commands.
 */
export async function exec(sql: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql);
}

/**
 * Resets the DB connection. Used by tests to force a fresh
 * connection (and re-run migrations from scratch) between
 * test cases. Production code should never call this.
 */
const _pendingPromises = new Set<Promise<any>>();

export function trackPromise<T>(p: Promise<T>): Promise<T> {
  _pendingPromises.add(p);
  p.then(() => _pendingPromises.delete(p), () => _pendingPromises.delete(p));
  return p;
}

export async function awaitPendingWrites(): Promise<void> {
  while (_pendingPromises.size > 0) {
    await Promise.all(Array.from(_pendingPromises));
  }
}

export async function resetForTests(): Promise<void> {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
  }
  _db = null;
  _migrationsRun = false;
  _migrationsPromise = null;
  _stmtCache.clear();
  _pendingPromises.clear();
}

// ── Re-exports ──────────────────────────────────────────────────
// The table-specific modules live in ./tables/. Re-exporting
// them here gives callers a single import point: `import { agents } from '../db/index.js'`.
export * as agents     from './tables/agents.js';
export * as messages   from './tables/messages.js';
export * as toolCalls  from './tables/tool-calls.js';
export * as artifacts  from './tables/artifacts.js';
export * as swarms     from './tables/swarms.js';
export * as whiteboard from './tables/whiteboard.js';
export * as locks      from './tables/locks.js';
export * as lwm        from './tables/lwm-snapshots.js';
export * as cost       from './tables/cost-events.js';
export * as audit      from './tables/audit.js';

// Migration + backup utilities
export { runMigrations, migrationStatus, discoverMigrations } from './migrate.js';
export type { MigrationFile, MigrationRecord } from './migrate.js';
export { createBackup, listBackups, pruneBackups, BACKUPS_DIR } from './backup.js';
export type { BackupResult } from './backup.js';

// Re-export InValue for callers that need to build args arrays
export type { InValue };
