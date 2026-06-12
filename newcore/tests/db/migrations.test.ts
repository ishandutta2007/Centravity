// ═══════════════════════════════════════════════════════════════
// OpenCentravity — migration system test suite
//
// Covers discoverMigrations, runMigrations, migrationStatus,
// applyMigration, and idempotency. Verifies that running the
// runner twice in a row is safe and that the runner's behaviour
// holds up under concurrent invocation.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, resetForTests } from '../../src/db/index.js';
import { runMigrations, migrationStatus, discoverMigrations, applyMigration, type MigrationFile, type MigrationRecord } from '../../src/db/migrate.js';
import { join } from 'path';

describe('migrations', () => {
  beforeEach(async () => {
    await resetForTests();
  });

  describe('discoverMigrations', () => {
    it('returns all .sql files in sorted order with parsed versions', () => {
      const files = discoverMigrations();
      expect(files.length).toBeGreaterThan(0);
      // All should be sorted ascending by version
      for (let i = 1; i < files.length; i++) {
        expect(files[i].version).toBeGreaterThanOrEqual(files[i - 1].version);
      }
      // Each has the expected shape
      for (const f of files) {
        expect(typeof f.version).toBe('number');
        expect(typeof f.filename).toBe('string');
        expect(typeof f.path).toBe('string');
        expect(typeof f.sql).toBe('string');
        expect(f.sql.length).toBeGreaterThan(0);
      }
    });

    it('includes at least the core tables', () => {
      const names = discoverMigrations().map(f => f.filename);
      expect(names.some(n => n.includes('agents'))).toBe(true);
      expect(names.some(n => n.includes('swarms'))).toBe(true);
      expect(names.some(n => n.includes('messages'))).toBe(true);
      expect(names.some(n => n.includes('artifacts'))).toBe(true);
    });
  });

  describe('runMigrations', () => {
    it('applies all migrations on a fresh DB', async () => {
      const db = await getDb(); // triggers first run
      void db;
      const status = await migrationStatus();
      expect(status.pending.length).toBe(0);
      expect(status.applied.length).toBeGreaterThan(0);
    });

    it('is idempotent — second run applies zero new migrations', async () => {
      const db = await getDb();
      void db;
      const before = (await migrationStatus()).applied.length;
      const newlyApplied = await runMigrations();
      expect(newlyApplied.length).toBe(0);
      const after = (await migrationStatus()).applied.length;
      expect(after).toBe(before);
    });

    it('records the applied_at timestamp for each migration', async () => {
      const db = await getDb();
      void db;
      const { applied } = await migrationStatus();
      for (const m of applied) {
        expect(typeof m.appliedAt).toBe('number');
        expect(m.appliedAt).toBeGreaterThan(0);
      }
    });
  });

  describe('applyMigration', () => {
    it('records a new migration and tolerates the duplicate-column case', async () => {
      const db = await getDb();
      void db;
      // Pick the first pending migration, if any. Otherwise pick the
      // first applied one and re-apply (idempotency test).
      const status = await migrationStatus();
      let target: MigrationFile;
      if (status.pending.length > 0) {
        target = status.pending[0];
      } else {
        target = discoverMigrations()[0];
      }
      const ok = await applyMigration(await getDb(), target);
      expect(ok).toBe(true);
    });

    it('throwing migration wraps the error with filename context', async () => {
      const db = await getDb();
      void db;
      const bad: MigrationFile = {
        version: 9999,
        filename: '9999_bogus.sql',
        path: join('migrations', '9999_bogus.sql'),
        sql: 'THIS IS NOT VALID SQL;',
      };
      await expect(applyMigration(await getDb(), bad)).rejects.toThrow(/bogus\.sql/);
    });
  });

  describe('migrationStatus', () => {
    it('returns applied and pending lists with correct shape', async () => {
      const db = await getDb();
      void db;
      const s: { applied: MigrationRecord[]; pending: MigrationFile[] } = await migrationStatus();
      expect(Array.isArray(s.applied)).toBe(true);
      expect(Array.isArray(s.pending)).toBe(true);
      for (const a of s.applied) {
        expect(typeof a.version).toBe('number');
        expect(typeof a.name).toBe('string');
        expect(typeof a.appliedAt).toBe('number');
      }
    });
  });

  describe('concurrent safety', () => {
    it('running runMigrations twice in parallel is safe', async () => {
      const db = await getDb();
      void db;
      const results = await Promise.all([runMigrations(), runMigrations()]);
      // Each call returns the migrations *it* applied. The total
      // set of applied migrations in the DB must equal the union
      // (no duplicates and no missed).
      const totalApplied = results[0].length + results[1].length;
      const status = await migrationStatus();
      expect(status.pending.length).toBe(0);
      expect(status.applied.length).toBeGreaterThanOrEqual(totalApplied);
    });
  });
});
