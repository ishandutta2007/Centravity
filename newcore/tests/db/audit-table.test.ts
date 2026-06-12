// ═══════════════════════════════════════════════════════════════
// OpenCentravity — audit_v2 table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, audit } from '../../src/db/index.js';

describe('audit_v2 table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('insert + query', () => {
    it('inserts and reads back a basic entry', async () => {
      const id = await audit.insert({
        timestamp: Date.now(),
        agentId: 'A',
        action: 'file_write',
        target: '/foo.txt',
        result: 'success',
        details: 'wrote 42 bytes',
        durationMs: 12,
      });
      expect(id).toBeTruthy();
      const rows = await audit.query({ agentId: 'A' });
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('file_write');
      expect(rows[0].result).toBe('success');
      expect(rows[0].durationMs).toBe(12);
    });

    it('preserves unicode in details and target', async () => {
      await audit.insert({
        timestamp: Date.now(),
        agentId: 'A',
        action: 'log',
        target: '/ファイル.txt',
        result: 'success',
        details: '日本語 🚀',
        durationMs: 0,
      });
      const rows = await audit.query({ agentId: 'A' });
      expect(rows[0].target).toContain('ファイル');
      expect(rows[0].details).toContain('🚀');
    });

    it('accepts null agentId (engine-level events)', async () => {
      const id = await audit.insert({
        timestamp: Date.now(),
        agentId: null,
        action: 'system',
        target: 'startup',
        result: 'success',
        details: '',
        durationMs: 0,
      });
      expect(id).toBeTruthy();
      const rows = await audit.query({ action: 'system' });
      expect(rows.length).toBe(1);
      expect(rows[0].agentId).toBeNull();
    });

    it('filters by result', async () => {
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'x', target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'x', target: 't', result: 'failure', details: '', durationMs: 0 });
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'x', target: 't', result: 'blocked', details: '', durationMs: 0 });
      const succ = await audit.query({ result: 'success' });
      const fail = await audit.query({ result: 'failure' });
      const block = await audit.query({ result: 'blocked' });
      expect(succ.length).toBe(1);
      expect(fail.length).toBe(1);
      expect(block.length).toBe(1);
    });

    it('filters by action with LIKE', async () => {
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'file_write', target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'file_read',  target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'shell_exec', target: 't', result: 'success', details: '', durationMs: 0 });
      const writes = await audit.query({ action: 'file_write' });
      // LIKE %file_write% also matches "file_write" itself
      expect(writes.length).toBe(1);
      expect(writes[0].action).toBe('file_write');
    });

    it('filters by sinceMs', async () => {
      await audit.insert({ timestamp: 1000, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      const rows = await audit.query({ sinceMs: 2000 });
      expect(rows.length).toBe(0);
    });

    it('respects the limit', async () => {
      for (let i = 0; i < 10; i++) {
        await audit.insert({ timestamp: 1000 + i, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      }
      const rows = await audit.query({ limit: 3 });
      expect(rows.length).toBe(3);
    });
  });

  describe('getStats', () => {
    it('counts by result', async () => {
      await audit.insert({ timestamp: 1, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: 1, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: 1, agentId: 'A', action: 'a', target: 't', result: 'failure', details: '', durationMs: 0 });
      await audit.insert({ timestamp: 1, agentId: 'A', action: 'a', target: 't', result: 'blocked', details: '', durationMs: 0 });

      const stats = await audit.getStats({ agentId: 'A' });
      expect(stats.total).toBe(4);
      expect(stats.success).toBe(2);
      expect(stats.failure).toBe(1);
      expect(stats.blocked).toBe(1);
    });

    it('returns all zeros when there are no events', async () => {
      const stats = await audit.getStats({ agentId: 'nobody' });
      expect(stats).toEqual({ total: 0, success: 0, failure: 0, blocked: 0 });
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes events older than the cutoff', async () => {
      await audit.insert({ timestamp: 100, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      await audit.insert({ timestamp: 200, agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      const deleted = await audit.deleteOlderThan(150);
      expect(deleted).toBe(1);
      const rows = await audit.query({});
      expect(rows.length).toBe(1);
      expect(rows[0].timestamp).toBe(200);
    });

    it('returns 0 when nothing is old enough', async () => {
      await audit.insert({ timestamp: Date.now(), agentId: 'A', action: 'a', target: 't', result: 'success', details: '', durationMs: 0 });
      const deleted = await audit.deleteOlderThan(Date.now() - 10_000);
      expect(deleted).toBe(0);
    });
  });
});
