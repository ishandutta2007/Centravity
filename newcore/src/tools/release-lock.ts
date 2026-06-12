// ═══════════════════════════════════════════════════════════════
// OpenCentravity — File Lock Release Tool
//
// Releases a previously acquired file lock. The DB enforces
// "only the original holder can release" so a buggy caller
// cannot drop another agent's lock.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import * as locksTable from '../db/tables/locks.js';

export class ReleaseLockTool implements Tool {
  name = 'release_lock';
  description = "Release a lock you previously acquired on a file path.";

  parameters = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path of the file whose lock should be released',
      },
      lock_id: {
        type: 'string',
        description: 'Optional lock id (returned from acquire_lock). Currently informational only — release is keyed on (workspace, file, agent).',
      },
    },
    required: ['file_path'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const lockId = input.lock_id as string | undefined;

    if (!filePath || typeof filePath !== 'string') {
      return { success: false, output: '', error: 'file_path is required' };
    }

    try {
      const released = await locksTable.release({
        workspaceDir: context.workspaceDir,
        filePath,
        agentId: context.agentId,
      });

      if (!released) {
        return {
          success: false,
          output: '',
          error: `No active lock held by ${context.agentId} on ${filePath}`,
          metadata: { filePath, lockId, released: false },
        };
      }

      return {
        success: true,
        output: `Lock released on ${filePath}`,
        metadata: { filePath, lockId, released: true },
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
