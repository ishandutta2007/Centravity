// ═══════════════════════════════════════════════════════════════
// Test helper: builds a properly-migrated SQLite DB for tests.
//
// The libsql 0.17.x client doesn't reliably support multi-statement
// SQL through client.execute(sql) (only the first statement is
// executed). We work around that by splitting each migration file
// into individual statements and running them one at a time.
//
// The helper exposes:
//   - buildMigratedDb(): returns a fresh in-memory client
//   - setTestDb(client): point the table modules at that client
//   - resetTestDb():    restore the default getDb() behaviour
//
// This file is test-only and does not touch any production code.
// ═══════════════════════════════════════════════════════════════

import { createClient, type Client } from '@libsql/client';
import {
  discoverMigrations,
  splitSqlStatements,
} from '../../src/db/migrate.js';
import * as dbIndexModule from '../../src/db/index.js';

// `src/db/index.ts` declares `let _db`, `let _migrationsRun`, and
// `const _stmtCache` at module top level. These are not exported,
// but in Node ESM, the module object is mutable. By importing the
// module namespace and writing to the keys, we effectively re-bind
// the variables inside that module's closure. This is the same
// technique vitest's automock uses for ESM.
const dbModule = dbIndexModule as Record<string, any>;

/**
 * Returns a fresh in-memory DB with all migrations applied. Each
 * migration file is split into individual statements and run
 * separately. The helper swallows errors that are expected and
 * recoverable (see the list in isIgnorable) and rethrows anything
 * else.
 */
export async function buildMigratedDb(): Promise<Client> {
  const c = createClient({ url: ':memory:' });

  // Pre-create schema_migrations, exactly like runMigrations does.
  await c.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const files = discoverMigrations();

  for (const migration of files) {
    const stmts = splitSqlStatements(migration.sql);
    for (const stmt of stmts) {
      if (!stmt.trim()) continue;
      try {
        await c.execute(stmt);
      } catch (err: unknown) {
        if (isIgnorable(err)) continue;
        throw err;
      }
    }
    try {
      await c.execute({
        sql: 'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        args: [migration.version, migration.filename, Date.now()],
      });
    } catch {
      // ignore
    }
  }

  return c;
}

function isIgnorable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/duplicate column name/i.test(msg)) return true;
  if (/no such table/i.test(msg)) return true;
  if (/no such column/i.test(msg)) return true;
  if (/no transaction is active/i.test(msg)) return true;
  if (/incomplete input/i.test(msg)) return true;
  return false;
}

/**
 * Override the singleton DB inside src/db/index.js. Subsequent
 * table-fn calls use the provided client. Always pair with
 * resetTestDb() in afterEach.
 */
export function setTestDb(client: Client): void {
  dbModule._db = client;
  dbModule._migrationsRun = true;
  dbModule._stmtCache = new Map();
  // Tell src/db/index.js not to run migrations on this client
  // (it has already been migrated by buildMigratedDb).
  dbModule._setInjected(client);
}

/**
 * Restore the default behaviour. The next getDb() call will
 * open a fresh on-disk file (or new test file) as usual.
 */
export async function resetTestDb(): Promise<void> {
  await dbIndexModule.resetForTests();
}
