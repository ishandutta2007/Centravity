import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { createClient } from '@libsql/client';
import { existsSync, rmSync } from 'fs';

describe('End-to-end smoke test', () => {
  it('CLI run completes and persists state', async () => {
    // Clean any previous run
    const dbPath = './data/opencentravity_smoke.db';
    try { rmSync(dbPath, { force: true }); } catch {}
    try { rmSync(dbPath + '-wal', { force: true }); } catch {}
    try { rmSync(dbPath + '-shm', { force: true }); } catch {}

    // Run the CLI
    let output = '';
    let exitCode = 0;
    try {
      output = execSync('npx tsx src/cli.ts run "Write a simple hello world Python script and run it" --model mock --retries 0', {
        encoding: 'utf-8',
        timeout: 60000,
        stdio: 'pipe',
        env: { ...process.env, OPENCENTRAVITY_DB_NAME: 'opencentravity_smoke.db' },
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      output = err.stdout?.toString() + err.stderr?.toString();
    }

    // Assert the CLI exits with code 0
    expect(exitCode).toBe(0);

    // Open the DB and verify
    expect(existsSync(dbPath)).toBe(true);

    const db = createClient({ url: `file:${dbPath}` });

    // Verify the agents table has at least 1 row
    const agentsResult = await db.execute({ sql: "SELECT COUNT(*) as c FROM agents" });
    const agentsCount = Number(agentsResult.rows[0].c);
    expect(agentsCount).toBeGreaterThanOrEqual(1);

    // Verify the artifacts table has at least 1 row
    const artifactsResult = await db.execute({ sql: "SELECT COUNT(*) as c FROM artifacts" });
    const artifactsCount = Number(artifactsResult.rows[0].c);
    expect(artifactsCount).toBeGreaterThanOrEqual(1);

    // Clean up created agent files (if any)
    try {
      const artifactsRows = await db.execute({ sql: "SELECT path FROM artifacts" });
      for (const row of artifactsRows.rows) {
        const filePath = (row as any).path as string;
        if (filePath && existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
      }
    } catch {}

    await db.close();

    // Clean DB files at the end
    try { rmSync(dbPath, { force: true }); } catch {}
    try { rmSync(dbPath + '-wal', { force: true }); } catch {}
    try { rmSync(dbPath + '-shm', { force: true }); } catch {}
  }, 30000);
});
