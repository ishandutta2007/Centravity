// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: file_locks
//
// A DB-backed mutex for file paths inside a workspace. Survives
// restarts; supports timeouts (auto-release if the holder dies).
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface FileLockRow {
  id: string;
  workspaceDir: string;
  filePath: string;
  heldByAgentId: string;
  acquiredAt: number;
  expiresAt: number;
  reason: 'write' | 'read-modify-write' | 'exclusive' | null;
}

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Attempts to acquire a lock on filePath within workspaceDir
 * for the given agent. Returns the lock id on success, or null
 * if another agent already holds it.
 *
 * Expired locks (older than expiresAt) are auto-cleaned before
 * the attempt, so a crashed holder's locks don't permanently
 * block other agents.
 */
export async function acquire(input: {
  workspaceDir: string;
  filePath: string;
  agentId: string;
  ttlMs?: number;
  reason?: FileLockRow['reason'];
}): Promise<string | null> {
  const db = await getDb();
  const now = Date.now();
  const expiresAt = now + (input.ttlMs ?? DEFAULT_LOCK_TTL_MS);

  // 1. Auto-release any expired lock on this path.
  await db.execute({
    sql: 'DELETE FROM file_locks WHERE workspace_dir = ? AND file_path = ? AND expires_at < ?',
    args: [input.workspaceDir, input.filePath, now],
  });

  // 2. Try to insert a new lock. The UNIQUE index on
  //    (workspace_dir, file_path) makes this a single
  //    atomic check — if the insert fails with a constraint
  //    violation, the path is locked.
  const id = uuidv4();
  try {
    await db.execute({
      sql: `
        INSERT INTO file_locks
          (id, workspace_dir, file_path, held_by_agent_id, acquired_at, expires_at, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id, input.workspaceDir, input.filePath, input.agentId,
        now, expiresAt, input.reason ?? null,
      ],
    });
    return id;
  } catch (err) {
    // The UNIQUE constraint failed — the file is locked by someone else.
    // We return null rather than throwing, so callers can decide
    // whether to wait, fail, or retry.
    return null;
  }
}

/**
 * Releases a lock. Only the original holder (or an expired lock)
 * can release — we verify this in the WHERE clause so a buggy
 * caller can't accidentally drop someone else's lock.
 */
export async function release(input: {
  workspaceDir: string;
  filePath: string;
  agentId: string;
}): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM file_locks WHERE workspace_dir = ? AND file_path = ? AND held_by_agent_id = ?',
    args: [input.workspaceDir, input.filePath, input.agentId],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

/**
 * Returns true if the file is currently locked by ANY agent
 * (including non-expired locks held by this agent).
 */
export async function isLocked(workspaceDir: string, filePath: string): Promise<boolean> {
  const db = await getDb();
  // First clean up expired locks
  await db.execute({
    sql: 'DELETE FROM file_locks WHERE workspace_dir = ? AND file_path = ? AND expires_at < ?',
    args: [workspaceDir, filePath, Date.now()],
  });
  const result = await db.execute({
    sql: 'SELECT 1 FROM file_locks WHERE workspace_dir = ? AND file_path = ? LIMIT 1',
    args: [workspaceDir, filePath],
  });
  return result.rows.length > 0;
}

/**
 * Returns all current locks in a workspace. Used by the API
 * endpoint GET /workspaces/:path/locks and the Manager UI.
 */
export async function listForWorkspace(workspaceDir: string): Promise<FileLockRow[]> {
  const db = await getDb();
  // Clean expired first so the listing is current
  await db.execute({
    sql: 'DELETE FROM file_locks WHERE workspace_dir = ? AND expires_at < ?',
    args: [workspaceDir, Date.now()],
  });
  const result = await db.execute({
    sql: 'SELECT * FROM file_locks WHERE workspace_dir = ? ORDER BY acquired_at ASC',
    args: [workspaceDir],
  });
  return result.rows.map(toRow);
}

/**
 * Releases all locks held by an agent. Called when an agent
 * finishes (completed/failed/cancelled) to prevent orphaned
 * locks from blocking future runs.
 */
export async function releaseAllForAgent(agentId: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM file_locks WHERE held_by_agent_id = ?',
    args: [agentId],
  });
  return Number(result.rowsAffected ?? 0);
}

function toRow(r: Record<string, unknown>): FileLockRow {
  return {
    id: r.id as string,
    workspaceDir: r.workspace_dir as string,
    filePath: r.file_path as string,
    heldByAgentId: r.held_by_agent_id as string,
    acquiredAt: r.acquired_at as number,
    expiresAt: r.expires_at as number,
    reason: (r.reason as FileLockRow['reason']) ?? null,
  };
}
