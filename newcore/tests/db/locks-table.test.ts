// ═══════════════════════════════════════════════════════════════
// OpenCentravity — file_locks table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, locks, agents } from '../../src/db/index.js';

const WS = '/workspaces/test';

describe('file_locks table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
    // Insert mock agents to satisfy foreign key constraints
    await agents.insert({ id: 'A', task: 'test-lock', model: 'mock', workspaceDir: WS });
    await agents.insert({ id: 'B', task: 'test-lock', model: 'mock', workspaceDir: WS });
    await agents.insert({ id: 'C', task: 'test-lock', model: 'mock', workspaceDir: WS });
  });

  describe('acquire', () => {
    it('grants a lock when none exists and returns its id', async () => {
      const id = await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      expect(id).toBeTruthy();
      expect(await locks.isLocked(WS, 'a.txt')).toBe(true);
    });

    it('denies a lock when held by a different agent and returns null', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      const second = await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'B' });
      expect(second).toBeNull();
    });

    it('is idempotent for the SAME agent re-acquiring the same path (replace via auto-cleanup)', async () => {
      const id1 = await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A', ttlMs: -1 });
      // Acquire again with default TTL. The auto-cleanup of the first expired lock will allow this to succeed.
      const id2 = await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      // The TTL of -1 puts expiresAt in the past, so auto-cleanup removes the old lock
      // and the new insert succeeds.
      expect(id2).toBeTruthy();
      expect(id2).not.toBe(id1);
    });
  });

  describe('release', () => {
    it('releases a lock held by the same agent', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      const ok = await locks.release({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      expect(ok).toBe(true);
      expect(await locks.isLocked(WS, 'a.txt')).toBe(false);
    });

    it('cannot release a lock held by a different agent', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      const ok = await locks.release({ workspaceDir: WS, filePath: 'a.txt', agentId: 'B' });
      expect(ok).toBe(false);
      // Lock is still there
      expect(await locks.isLocked(WS, 'a.txt')).toBe(true);
    });

    it('release on a non-locked file returns false', async () => {
      const ok = await locks.release({ workspaceDir: WS, filePath: 'nope.txt', agentId: 'A' });
      expect(ok).toBe(false);
    });
  });

  describe('auto-expiry / auto-cleanup', () => {
    it('expired locks are cleaned up on next acquire / isLocked / listForWorkspace', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A', ttlMs: 5 });
      // Wait for expiry
      await new Promise(r => setTimeout(r, 20));
      // isLocked should auto-clean
      expect(await locks.isLocked(WS, 'a.txt')).toBe(false);
    });

    it('expired lock does not block new acquire', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A', ttlMs: 5 });
      await new Promise(r => setTimeout(r, 20));
      const id = await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'B' });
      expect(id).toBeTruthy();
    });
  });

  describe('listForWorkspace', () => {
    it('returns all live locks in a workspace', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A', reason: 'write' });
      await locks.acquire({ workspaceDir: WS, filePath: 'b.txt', agentId: 'B', reason: 'read-modify-write' });
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'C', ttlMs: 5, reason: 'exclusive' });

      await new Promise(r => setTimeout(r, 15));
      const list = await locks.listForWorkspace(WS);
      // a.txt/C is expired and cleaned
      expect(list.length).toBe(2);
      const reasons = list.map(l => l.reason).sort();
      expect(reasons).toEqual(['read-modify-write', 'write']);
    });

    it('returns empty array for an unknown workspace', async () => {
      const list = await locks.listForWorkspace('/no/such/dir');
      expect(list).toEqual([]);
    });
  });

  describe('releaseAllForAgent', () => {
    it('releases every lock held by the given agent', async () => {
      await locks.acquire({ workspaceDir: WS, filePath: 'a.txt', agentId: 'A' });
      await locks.acquire({ workspaceDir: WS, filePath: 'b.txt', agentId: 'A' });
      await locks.acquire({ workspaceDir: WS, filePath: 'c.txt', agentId: 'B' });
      const released = await locks.releaseAllForAgent('A');
      expect(released).toBe(2);
      expect(await locks.isLocked(WS, 'a.txt')).toBe(false);
      expect(await locks.isLocked(WS, 'b.txt')).toBe(false);
      expect(await locks.isLocked(WS, 'c.txt')).toBe(true);
    });

    it('returns 0 when the agent holds nothing', async () => {
      const released = await locks.releaseAllForAgent('nobody');
      expect(released).toBe(0);
    });
  });
});
