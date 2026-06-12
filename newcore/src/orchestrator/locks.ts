// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Lock Manager
//
// A DB-backed mutex for file paths inside a workspace. Survives
// server restarts; supports timeouts (auto-release if the
// holder dies).
//
// In v0.1.0 file locks were an in-memory Set<string> on the
// orchestrator. Two agents in two processes would not see each
// other's locks. v0.2.0 moves them to the DB so the lock is
// truly cross-process and cross-restart.
//
// The ToolContext.fileLocks field is still a Set<string> for
// backward compat; this manager provides acquire/release via
// the file_locks table and the filesystem tool will use it
// in a follow-up refactor.
// ═══════════════════════════════════════════════════════════════

import * as locksTable from '../db/tables/locks.js';

export interface LockHandle {
  workspaceDir: string;
  filePath: string;
  agentId: string;
  acquiredAt: number;
  expiresAt: number;
}

export class LockManager {
  /** Try to acquire a lock. Returns the handle on success, null on conflict. */
  async acquire(input: {
    workspaceDir: string;
    filePath: string;
    agentId: string;
    ttlMs?: number;
    reason?: 'write' | 'read-modify-write' | 'exclusive';
  }): Promise<LockHandle | null> {
    const lockId = await locksTable.acquire(input);
    if (!lockId) return null;
    const now = Date.now();
    return {
      workspaceDir: input.workspaceDir,
      filePath: input.filePath,
      agentId: input.agentId,
      acquiredAt: now,
      expiresAt: now + (input.ttlMs ?? 5 * 60 * 1000),
    };
  }

  /** Release a lock held by the given agent. */
  async release(input: { workspaceDir: string; filePath: string; agentId: string }): Promise<boolean> {
    return locksTable.release(input);
  }

  /** Returns true if the file is currently locked by anyone. */
  async isLocked(workspaceDir: string, filePath: string): Promise<boolean> {
    return locksTable.isLocked(workspaceDir, filePath);
  }

  /** List all current locks in a workspace. */
  async listForWorkspace(workspaceDir: string) {
    return locksTable.listForWorkspace(workspaceDir);
  }

  /**
   * Higher-level helper: run `fn` while holding the lock.
   * Releases the lock on success OR failure.
   */
  async withLock<T>(input: {
    workspaceDir: string;
    filePath: string;
    agentId: string;
    fn: () => Promise<T>;
    ttlMs?: number;
  }): Promise<T | { error: string; locked: true }> {
    const handle = await this.acquire(input);
    if (!handle) return { error: `File locked: ${input.filePath}`, locked: true };
    try {
      return await input.fn();
    } finally {
      await this.release({
        workspaceDir: input.workspaceDir,
        filePath: input.filePath,
        agentId: input.agentId,
      });
    }
  }
}
