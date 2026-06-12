// ═══════════════════════════════════════════════════════════════
// OpenCentravity — File Lock Acquisition Tool
//
// Wraps the DB-backed file_locks table so an agent can claim an
// exclusive write lock on a file path inside its workspace.
// Returns the lock id on success, or an error string if another
// agent already holds the lock.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import * as locksTable from '../db/tables/locks.js';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

export class AcquireLockTool implements Tool {
  name = 'acquire_lock';
  description = "Acquire an exclusive lock on a file path. Returns the lock id or an error if another agent holds it.";

  parameters = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path (absolute, or relative to the workspace) of the file to lock',
      },
      reason: {
        type: 'string',
        enum: ['write', 'read-modify-write'],
        description: "Why the lock is needed — defaults to 'write'",
      },
      ttl_seconds: {
        type: 'number',
        description: 'Time-to-live in seconds. Defaults to 300 (5 minutes). Auto-released after expiry.',
      },
    },
    required: ['file_path'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const reason = (input.reason as 'write' | 'read-modify-write' | undefined) ?? 'write';
    const ttlSeconds = (input.ttl_seconds as number | undefined) ?? DEFAULT_TTL_SECONDS;
    const ttlMs = ttlSeconds * 1000;

    if (!filePath || typeof filePath !== 'string') {
      return { success: false, output: '', error: 'file_path is required' };
    }

    try {
      const lockId = await locksTable.acquire({
        workspaceDir: context.workspaceDir,
        filePath,
        agentId: context.agentId,
        ttlMs,
        reason,
      });

      if (lockId === null) {
        return {
          success: false,
          output: '',
          error: `File is currently locked by another agent: ${filePath}`,
          metadata: { filePath, locked: true },
        };
      }

      return {
        success: true,
        output: `Lock acquired on ${filePath} (id=${lockId}, ttl=${ttlSeconds}s)`,
        metadata: { lockId, filePath, ttlSeconds, reason },
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
