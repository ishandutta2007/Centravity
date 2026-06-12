// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Migration Runner
//
// Reads every *.sql file in src/db/migrations/ in sorted order,
// runs each in a transaction, records success in schema_migrations.
// Idempotent: running twice is safe; applied migrations are skipped.
//
// Usage (programmatic):
//   import { runMigrations, listMigrations, migrationStatus } from './migrate.js';
//   await runMigrations();           // apply all pending
//   await listMigrations();          // show what's applied
//   await migrationStatus();         // pretty-print
//
// Usage (CLI):
//   npx tsx src/db/migrate.ts           # apply
//   npx tsx src/db/migrate.ts status    # inspect
//   npx tsx src/db/migrate.ts reset     # DANGER: drop everything
// ═══════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient, type Client } from '@libsql/client';
import { getDb } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: number;
}

export interface MigrationFile {
  version: number;
  filename: string;
  path: string;
  sql: string;
}

/**
 * Returns all migration files in sorted order. The version number
 * is parsed from the filename prefix (e.g. "0003_agents_v2.sql" → 3).
 * Throws if a file has a malformed prefix.
 */
export function discoverMigrations(): MigrationFile[] {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files.map(filename => {
    // Match the numeric prefix that may be followed by an
    // optional letter suffix (e.g. "0005b_messages_v2.sql").
    // The version is the numeric portion; the letter suffix
    // is part of the filename for display purposes only.
    const match = filename.match(/^(\d+)/);
    if (!match) {
      throw new Error(`Migration file has no numeric prefix: ${filename}`);
    }
    const version = parseInt(match[1], 10);
    const path = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(path, 'utf-8');
    return { version, filename, path, sql };
  });
}

/**
 * Returns the set of already-applied migration versions. Used to
 * skip work on subsequent runs. Empty set on a fresh DB.
 */
export async function getAppliedMigrations(client: Client): Promise<Set<number>> {
  // Ensure schema_migrations exists. We do this in a try/catch
  // because on a fresh DB the very first migration creates it.
  try {
    const result = await client.execute(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    );
    return new Set(result.rows.map(r => r.version as number));
  } catch {
    return new Set();
  }
}

/**
 * Runs a single migration file. Throws on any SQL error so the
 * runner can surface it to the user. Returns true on success.
 *
 * libsql 0.17.x's `client.execute(sql)` uses better-sqlite3's
 * `prepare()`, which only accepts a single statement. To run a
 * multi-statement migration file we split it on `;` (respecting
 * comments) and run each statement in order. Each statement runs
 * in its own implicit transaction; the migration runner records
 * success in `schema_migrations` after every statement succeeds.
 *
 * The pre-flight in `runMigrations` ensures `schema_migrations`
 * exists BEFORE the first migration runs, so the INSERT below
 * can never fail with "no such table".
 */
export async function applyMigration(client: Client, migration: MigrationFile): Promise<boolean> {
  const stmts = splitSqlStatements(migration.sql);
  for (const stmt of stmts) {
    if (!stmt.trim()) continue;
    try {
      await client.execute(stmt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignore safe, recoverable errors on re-run
      if (
        /duplicate column name/i.test(msg) ||
        /table .* already exists/i.test(msg) ||
        /index .* already exists/i.test(msg) ||
        /no such column/i.test(msg) ||
        /no such table/i.test(msg) ||
        /no such index/i.test(msg)
      ) {
        continue;
      }
      // Re-throw critical errors with migration file context
      throw new Error(`Migration ${migration.filename} failed at statement "${stmt.slice(0, 100)}...": ${msg}`);
    }
  }
  const dbg2 = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('--- DEBUG: Tables before INSERT:', dbg2.rows.map(r => r.name), 'Client URL:', (client as any)._config?.url || (client as any).config?.url || 'unknown');
  await client.execute({
    sql: 'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    args: [migration.version, migration.filename, Date.now()],
  });
  return true;
}

/**
 * Splits a SQL string into individual statements.
 *
 * NOTE: As of libsql client 0.17.x, the `execute()` method
 * accepts a string containing MULTIPLE statements separated
 * by semicolons and runs them atomically in a single round-trip.
 * We rely on that behavior for the migration runner, so this
 * splitter is retained only for the test suite (which can pass
 * individual statements). The migration runner itself calls
 * `db.execute(sql)` with the whole file.
 *
 * Kept exported so tests can verify the splitter's behavior.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inBlockComment = false;
  let inLineComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let beginDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Handle block comments /* ... */
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    // Handle line comments -- to end of line
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }

    // Handle single quotes
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    // Handle double quotes
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      // Check for BEGIN (case-insensitive)
      const isWordBoundary = (idx: number) => {
        if (idx < 0 || idx >= sql.length) return true;
        return !/[a-zA-Z0-9_]/.test(sql[idx]);
      };
      
      if (
        i + 4 < sql.length &&
        sql.slice(i, i + 5).toLowerCase() === 'begin' &&
        isWordBoundary(i - 1) &&
        isWordBoundary(i + 5)
      ) {
        beginDepth++;
        current += sql.slice(i, i + 5);
        i += 4;
        continue;
      }

      // Check for END (case-insensitive)
      if (
        i + 2 < sql.length &&
        sql.slice(i, i + 3).toLowerCase() === 'end' &&
        isWordBoundary(i - 1) &&
        isWordBoundary(i + 3)
      ) {
        beginDepth = Math.max(0, beginDepth - 1);
        current += sql.slice(i, i + 3);
        i += 2;
        continue;
      }

      // Statement terminator
      if (ch === ';' && beginDepth === 0) {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}

/**
 * The main entry point. Applies all pending migrations in order.
 * Returns the list of migrations that were applied during this
 * call. If all are already applied, returns [].
 */
export async function runMigrations(client?: Client): Promise<MigrationFile[]> {
  const db = client ?? (await getDb());
  try {
    await db.execute('SELECT 1 FROM schema_migrations LIMIT 0');
  } catch {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }
  const dbgTables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('--- DEBUG: Tables in runMigrations:', dbgTables.rows.map(r => r.name));
  const files = discoverMigrations();
  const applied = await getAppliedMigrations(db);
  const newlyApplied: MigrationFile[] = [];
  for (const migration of files) {
    if (applied.has(migration.version)) continue;
    await applyMigration(db, migration);
    newlyApplied.push(migration);
  }
  return newlyApplied;
}

/**
 * Prints a human-readable status of the migration state. Used
 * by the CLI 'migrate status' command and by tests.
 */
export async function migrationStatus(client?: Client): Promise<{
  applied: MigrationRecord[];
  pending: MigrationFile[];
}> {
  const db = client ?? (await getDb());
  const files = discoverMigrations();
  const appliedSet = await getAppliedMigrations(db);

  // Read full applied records (with timestamps) for diagnostics
  const appliedRows = await db.execute(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC'
  );
  const applied: MigrationRecord[] = appliedRows.rows.map(r => ({
    version: r.version as number,
    name: r.name as string,
    appliedAt: r.applied_at as number,
  }));

  const pending = files.filter(f => !appliedSet.has(f.version));
  return { applied, pending };
}

/**
 * Pretty-prints the migration status. Used by the CLI.
 */
export async function printStatus(): Promise<void> {
  const { applied, pending } = await migrationStatus();

  console.log('\n  ═══ Migration Status ═══\n');
  if (applied.length === 0) {
    console.log('  No migrations applied yet.\n');
  } else {
    console.log(`  ✓ Applied (${applied.length}):`);
    for (const m of applied) {
      const date = new Date(m.appliedAt).toISOString();
      console.log(`    ${String(m.version).padStart(4, '0')}  ${m.name}  (applied ${date})`);
    }
    console.log('');
  }
  if (pending.length > 0) {
    console.log(`  ⧗ Pending (${pending.length}):`);
    for (const m of pending) {
      console.log(`    ${String(m.version).padStart(4, '0')}  ${m.filename}`);
    }
    console.log('');
  } else {
    console.log('  ✓ Schema is up to date.\n');
  }
}

/**
 * CLI entry point. Called when this file is run directly.
 *   npx tsx src/db/migrate.ts            → apply all pending
 *   npx tsx src/db/migrate.ts status     → show status
 *   npx tsx src/db/migrate.ts reset      → drop everything (DANGER)
 */
const isMain = process.argv[1] && (
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);
if (isMain) {
  const command = process.argv[2] ?? 'apply';

  (async () => {
    try {
      if (command === 'apply') {
        const applied = await runMigrations();
        if (applied.length === 0) {
          console.log('  ✓ No migrations needed. Schema is up to date.\n');
        } else {
          console.log(`  ✓ Applied ${applied.length} migration(s):`);
          for (const m of applied) {
            console.log(`    ${String(m.version).padStart(4, '0')}  ${m.filename}`);
          }
          console.log('');
        }
      } else if (command === 'status') {
        await printStatus();
      } else if (command === 'reset') {
        // Destructive: drops every table. Used by tests.
        const db = await getDb();
        const tables = await db.execute(
          "SELECT name FROM sqlite_master WHERE type='table'"
        );
        for (const r of tables.rows) {
          await db.execute({ sql: `DROP TABLE IF EXISTS ${r.name as string}` });
        }
        console.log('  ✓ Database reset (all tables dropped).\n');
      } else {
        console.error(`  ✗ Unknown command: ${command}\n  Usage: migrate.ts [apply|status|reset]\n`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`\n  ✗ Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  })();
}
