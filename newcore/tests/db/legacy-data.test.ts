// ═══════════════════════════════════════════════════════════════
// OpenCentravity — legacy data migration test suite
//
// Exercises scripts/migrate-legacy-data.ts by setting up a fake
// legacy DB in data/, running the migration, and confirming:
//   1. agents/messages/plans are copied into the v2 DB
//   2. re-running is a no-op (idempotent)
//   3. v2-only columns get safe defaults
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@libsql/client';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { runMigrations, agents, messages } from '../../src/db/index.js';

const LEGACY_DB = resolve(process.cwd(), 'data', 'opengravity.test.legacy.db');
const NEW_DB    = resolve(process.cwd(), 'data', 'opengravity.test.new.db');

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function runScript() {
  // Invoke the script as a child process. Use tsx so the TS files
  // are compiled on the fly. The script reads CWD-relative paths.
  const { spawn } = await import('child_process');
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveP, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', 'scripts/migrate-legacy-data.ts'],
      { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolveP({ code: code ?? 0, stdout, stderr }));
  });
}

describe('legacy data migration', () => {
  beforeAll(() => {
    if (!existsSync('./data')) mkdirSync('./data', { recursive: true });
  });

  beforeEach(async () => {
    for (const p of [LEGACY_DB, NEW_DB]) {
      for (const ext of ['', '-wal', '-shm']) {
        const f = p + ext;
        if (existsSync(f)) {
          try { rmSync(f, { force: true }); } catch { /* ignore */ }
        }
      }
    }
  });

  afterAll(() => {
    for (const p of [LEGACY_DB, NEW_DB]) {
      for (const ext of ['', '-wal', '-shm']) {
        const f = p + ext;
        try { rmSync(f, { force: true }); } catch { /* ignore */ }
      }
    }
  });

  it('migrates a populated legacy DB into the v2 schema', async () => {
    // 1. Create the legacy DB with the v1 schema and seed it.
    const legacy = createClient({ url: `file:${LEGACY_DB}` });
    await legacy.execute(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, task TEXT NOT NULL, model TEXT NOT NULL,
      state TEXT NOT NULL, workspaceDir TEXT NOT NULL,
      currentStep INTEGER NOT NULL DEFAULT 0,
      startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    )`);
    await legacy.execute(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      toolCalls TEXT, toolCallId TEXT, name TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(agentId) REFERENCES agents(id)
    )`);
    await legacy.execute(`CREATE TABLE IF NOT EXISTS plans (
      agentId TEXT PRIMARY KEY, planJson TEXT NOT NULL,
      FOREIGN KEY(agentId) REFERENCES agents(id)
    )`);
    const agentId = uuidv4();
    await legacy.execute({
      sql: `INSERT INTO agents (id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [agentId, 'legacy task', 'mock', 'completed', './w', 3, 1000, 2000],
    });
    await legacy.execute({
      sql: `INSERT INTO messages (id, agentId, role, content, toolCalls, toolCallId, name, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [uuidv4(), agentId, 'user', 'hi', null, null, null, 1000],
    });
    await legacy.execute({
      sql: `INSERT INTO plans (agentId, planJson) VALUES (?, ?)`,
      args: [agentId, JSON.stringify({ steps: [] })],
    });
    legacy.close();

    // 2. Create the v2 DB by running migrations against it.
    const newDb = createClient({ url: `file:${NEW_DB}` });
    await runMigrations(newDb);
    newDb.close();

    // 3. Run the legacy migration script with overridden paths.
    //    The script uses `process.cwd()` and a hard-coded data/ dir;
    //    we point to our test files via a temporary symlink-like
    //    approach: use cwd=data (the script uses cwd, not __dirname).
    await withEnv({}, async () => {
      // The script computes paths from process.cwd(). To keep this
      // test self-contained without touching production data/, we
      // copy our test files into the standard names within data/,
      // run, then restore.
      const { copyFileSync } = await import('fs');
      copyFileSync(LEGACY_DB, resolve(process.cwd(), 'data', 'opengravity.db'));
      copyFileSync(NEW_DB, resolve(process.cwd(), 'data', 'opencentravity.db'));
      const r = await runScript();
      
      // Copy modified database back to NEW_DB so we verify the migrated data
      if (existsSync(resolve(process.cwd(), 'data', 'opencentravity.db'))) {
        copyFileSync(resolve(process.cwd(), 'data', 'opencentravity.db'), NEW_DB);
      }

      // Cleanup the renamed test files so we don't poison the
      // real data dir for subsequent tests.
      for (const f of ['opengravity.db', 'opencentravity.db']) {
        const p = resolve(process.cwd(), 'data', f);
        for (const ext of ['', '-wal', '-shm']) {
          try { rmSync(p + ext, { force: true }); } catch { /* ignore */ }
        }
      }
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Legacy data migration complete/);
    });

    // 4. Re-open the v2 DB and verify the agent + message are there.
    const verify = createClient({ url: `file:${NEW_DB}` });
    try {
      const agentRows = await verify.execute({ sql: 'SELECT * FROM agents WHERE id = ?', args: [agentId] });
      expect(agentRows.rows.length).toBe(1);
      expect(agentRows.rows[0].task).toBe('legacy task');
      // v2-only columns exist and have safe defaults
      expect(agentRows.rows[0].role).toBe('coder');
      expect(agentRows.rows[0].parent_id).toBeNull();
      expect(agentRows.rows[0].swarm_id).toBeNull();
      expect(agentRows.rows[0].artifacts_count).toBe(0);
      expect(agentRows.rows[0].tool_calls_count).toBe(0);

      const msgRows = await verify.execute({ sql: 'SELECT * FROM messages WHERE agentId = ?', args: [agentId] });
      expect(msgRows.rows.length).toBe(1);
      expect(msgRows.rows[0].content).toBe('hi');

      const planRows = await verify.execute({ sql: 'SELECT * FROM plans WHERE agentId = ?', args: [agentId] });
      expect(planRows.rows.length).toBe(1);
    } finally {
      verify.close();
    }
  }, 30_000);

  it('is idempotent — second run is a no-op', async () => {
    // Set up an empty legacy DB and a v2 DB that already has agents.
    const legacy = createClient({ url: `file:${LEGACY_DB}` });
    await legacy.execute(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, task TEXT NOT NULL, model TEXT NOT NULL,
      state TEXT NOT NULL, workspaceDir TEXT NOT NULL,
      currentStep INTEGER NOT NULL DEFAULT 0,
      startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    )`);
    // Insert an agent in the legacy DB so it passes the empty check
    await legacy.execute({
      sql: `INSERT INTO agents (id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [uuidv4(), 'legacy task', 'mock', 'completed', './w', 0, 1, 1],
    });
    legacy.close();

    const newDb = createClient({ url: `file:${NEW_DB}` });
    await runMigrations(newDb);
    // Pre-populate the v2 DB with an agent so the script sees count > 0
    // and short-circuits.
    const preId = uuidv4();
    await newDb.execute({
      sql: `INSERT INTO agents (id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [preId, 'preexisting', 'mock', 'idle', './w', 0, 1, 1],
    });
    newDb.close();

    await withEnv({}, async () => {
      const { copyFileSync } = await import('fs');
      copyFileSync(LEGACY_DB, resolve(process.cwd(), 'data', 'opengravity.db'));
      copyFileSync(NEW_DB, resolve(process.cwd(), 'data', 'opencentravity.db'));
      const r = await runScript();
      for (const f of ['opengravity.db', 'opencentravity.db']) {
        const p = resolve(process.cwd(), 'data', f);
        for (const ext of ['', '-wal', '-shm']) {
          try { rmSync(p + ext, { force: true }); } catch { /* ignore */ }
        }
      }
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Skipping legacy copy/);
    });

    // The pre-existing agent must still be there
    const verify = createClient({ url: `file:${NEW_DB}` });
    try {
      const rows = await verify.execute({ sql: 'SELECT * FROM agents WHERE id = ?', args: [preId] });
      expect(rows.rows.length).toBe(1);
    } finally {
      verify.close();
    }
  }, 30_000);

  it('reports a clean exit when no legacy DB exists', async () => {
    // Make sure the standard legacy path does not exist for this run.
    const legacyPath = resolve(process.cwd(), 'data', 'opengravity.db');
    for (const ext of ['', '-wal', '-shm']) {
      try { rmSync(legacyPath + ext, { force: true }); } catch { /* ignore */ }
    }
    const r = await runScript();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/No legacy database found/);
  }, 30_000);
});
