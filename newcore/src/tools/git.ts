// ═══════════════════════════════════════════════════════════════
// OpenGravity — Git Tool
// Git operations: status, diff, commit, log.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class GitTool implements Tool {
  name = 'git_operation';
  description = 'Perform git operations: status, diff, log, add, commit. Useful for tracking and versioning changes.';
  parameters = {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['status', 'diff', 'log', 'add', 'commit', 'init'], description: 'Git operation to perform' },
      args: { type: 'string', description: 'Additional arguments (e.g., file path for add, message for commit)' },
    },
    required: ['operation'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const op = input.operation as string;
    const args = input.args as string || '';

    const cmdMap: Record<string, string> = {
      status: 'git status --short',
      diff: `git diff ${args}`.trim(),
      log: `git log --oneline -20 ${args}`.trim(),
      add: `git add ${args || '.'}`.trim(),
      commit: `git commit -m "${args || 'Auto-commit by OpenGravity agent'}"`,
      init: 'git init',
    };

    const cmd = cmdMap[op];
    if (!cmd) return { success: false, output: '', error: `Unknown git operation: ${op}` };

    try {
      const output = execSync(cmd, {
        cwd: context.workspaceDir,
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim() || `git ${op} completed successfully.` };
    } catch (err: any) {
      return { success: false, output: err.stdout?.toString() ?? '', error: err.stderr?.toString() ?? err.message };
    }
  }
}
