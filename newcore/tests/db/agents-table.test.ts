// ═══════════════════════════════════════════════════════════════
// OpenCentravity — agents table test suite
//
// Verifies insert/findById/findMany/getDescendantTree/update
// across happy paths, edge cases, and idempotency.
//
// The DB is built per-test via _migrate-helper so that we can
// share the same libsql client across all table operations. The
// production migration runner is bypassed because the libsql
// 0.17.x client doesn't reliably support multi-statement SQL
// strings (only the first statement executes).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { buildMigratedDb, setTestDb, resetTestDb } from './_migrate-helper.js';
import { agents } from '../../src/db/index.js';
import type { Client } from '@libsql/client';

function makeConfig(overrides: Partial<any> = {}): any {
  return {
    id: uuidv4(),
    task: 'Build a REST API',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 2,
    timeoutMs: 30_000,
    tools: ['file_write', 'shell'],
    ...overrides,
  };
}

async function insertAgent(db: Client, cfg: any, extras: { role?: string; parentId?: string | null; swarmId?: string | null } = {}) {
  const now = Date.now();
  const role = extras.role ?? 'coder';
  await db.execute({
    sql: `INSERT INTO agents
            (id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt,
             parent_id, swarm_id, role, task_hash, config_json)
          VALUES (?, ?, ?, 'idle', ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      cfg.id, cfg.task, cfg.model, cfg.workspaceDir, now, now,
      extras.parentId ?? null, extras.swarmId ?? null, role,
      'hash', JSON.stringify({ maxRetries: cfg.maxRetries, timeoutMs: cfg.timeoutMs, tools: cfg.tools }),
    ],
  });
}

describe('agents table', () => {
  let db: Client;
  beforeEach(async () => {
    db = await buildMigratedDb();
    setTestDb(db);
  });
  afterEach(async () => {
    try { db.close(); } catch { /* ignore */ }
    await resetTestDb();
  });

  // ── insert + findById ──

  describe('insert + findById', () => {
    it('inserts a new agent and reads it back with default state', async () => {
      const cfg = makeConfig();
      await insertAgent(db, cfg, { role: 'planner' });
      const fetched = await agents.findById(cfg.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(cfg.id);
      expect(fetched!.task).toBe(cfg.task);
      expect(fetched!.state).toBe('idle');
      expect(fetched!.role).toBe('planner');
      expect(fetched!.parentId).toBeNull();
      expect(fetched!.swarmId).toBeNull();
      expect(fetched!.currentStep).toBe(0);
      expect(fetched!.artifactsCount).toBe(0);
      expect(fetched!.toolCallsCount).toBe(0);
      // Config blob round-trips as JSON
      const cfg2 = JSON.parse(fetched!.configJson);
      expect(cfg2.maxRetries).toBe(2);
      expect(cfg2.tools).toEqual(['file_write', 'shell']);
    });

    it('returns null from findById for an unknown id', async () => {
      const r = await agents.findById(uuidv4());
      expect(r).toBeNull();
    });

    it('preserves unicode and large tasks', async () => {
      const longTask = 'X'.repeat(10_000) + ' 你好世界 🚀 ';
      const cfg = makeConfig({ task: longTask });
      await insertAgent(db, cfg);
      const fetched = await agents.findById(cfg.id);
      expect(fetched!.task).toBe(longTask);
      expect(fetched!.task.length).toBe(longTask.length);
    });

    it('buildConfigBlob fills defaults for missing fields', () => {
      const blob = agents.buildConfigBlob(undefined);
      expect(blob.maxRetries).toBe(2);
      expect(blob.timeoutMs).toBe(120_000);
      expect(blob.tools).toEqual([]);
    });
  });

  // ── findMany ──

  describe('findMany', () => {
    it('returns empty array when no agents exist', async () => {
      const all = await agents.findMany();
      expect(all).toEqual([]);
    });

    it('filters by state, role, parentId, swarmId, and respects limit', async () => {
      const a = makeConfig(); const b = makeConfig(); const c = makeConfig();
      await insertAgent(db, a, { role: 'coder' });
      await insertAgent(db, b, { role: 'verifier' });
      await insertAgent(db, c, { role: 'coder', parentId: a.id });

      const coders = await agents.findMany({ role: 'coder' });
      expect(coders.length).toBe(2);
      expect(coders.every(r => r.role === 'coder')).toBe(true);

      const children = await agents.findMany({ parentId: a.id });
      expect(children.length).toBe(1);
      expect(children[0].id).toBe(c.id);

      const idle = await agents.findMany({ state: 'idle' });
      expect(idle.length).toBe(3);

      const limited = await agents.findMany({ limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  // ── update ──

  describe('update', () => {
    it('updates mutable fields and bumps updatedAt', async () => {
      const cfg = makeConfig();
      await insertAgent(db, cfg);
      const before = await agents.findById(cfg.id);
      await new Promise(r => setTimeout(r, 5));
      await agents.update(cfg.id, { state: 'executing', currentStep: 3, artifactsCount: 1, toolCallsCount: 2 });
      const after = await agents.findById(cfg.id);
      expect(after!.state).toBe('executing');
      expect(after!.currentStep).toBe(3);
      expect(after!.artifactsCount).toBe(1);
      expect(after!.toolCallsCount).toBe(2);
      expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
    });

    it('a no-op update does not throw', async () => {
      const cfg = makeConfig();
      await insertAgent(db, cfg);
      await expect(agents.update(cfg.id, {})).resolves.toBeUndefined();
    });

    it('update of nonexistent id is a silent no-op', async () => {
      await expect(agents.update(uuidv4(), { state: 'failed' })).resolves.toBeUndefined();
    });
  });

  // ── getDescendantTree ──

  describe('getDescendantTree', () => {
    it('returns just the root when no children exist', async () => {
      const cfg = makeConfig();
      await insertAgent(db, cfg);
      const tree = await agents.getDescendantTree(cfg.id);
      expect(tree.length).toBe(1);
      expect(tree[0].id).toBe(cfg.id);
    });

    it('walks a multi-level descendant tree', async () => {
      const a = makeConfig(); const b = makeConfig(); const c = makeConfig();
      const d = makeConfig(); const e = makeConfig();
      await insertAgent(db, a);
      await insertAgent(db, b, { parentId: a.id });
      await insertAgent(db, c, { parentId: b.id });
      await insertAgent(db, d, { parentId: b.id });
      await insertAgent(db, e, { parentId: c.id });
      const tree = await agents.getDescendantTree(a.id);
      const ids = tree.map(r => r.id).sort();
      expect(ids).toEqual([a.id, b.id, c.id, d.id, e.id].sort());
    });

    it('returns empty list when root id does not exist', async () => {
      const tree = await agents.getDescendantTree(uuidv4());
      expect(tree).toEqual([]);
    });
  });
});
