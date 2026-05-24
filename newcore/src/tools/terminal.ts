// ═══════════════════════════════════════════════════════════════
// OpenGravity — Terminal Tool
// Safe command execution with timeout, output capture, and policy.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import { getConfig } from '../config/index.js';

export class TerminalTool implements Tool {
  name = 'run_command';
  description = 'Execute a shell command in the workspace directory. Returns stdout and stderr. Use for running tests, builds, installs, etc.';
  parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (relative to workspace, defaults to workspace root)' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: ['command'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string;
    const config = getConfig();

    // Policy check
    const decision = context.policyEngine.check({
      type: 'command_exec', target: command, agentId: context.agentId, workspaceDir: context.workspaceDir,
    });
    if (!decision.allowed) {
      return { success: false, output: '', error: `Policy blocked: ${decision.reason}` };
    }

    const cwd = input.cwd
      ? `${context.workspaceDir}/${input.cwd}`
      : context.workspaceDir;
    const timeout = (input.timeoutMs as number) || config.maxCommandTimeoutMs;

    try {
      const output = execSync(command, {
        cwd,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      });
      return { success: true, output: output.trim() };
    } catch (err: any) {
      const stdout = err.stdout?.toString() ?? '';
      const stderr = err.stderr?.toString() ?? '';
      const exitCode = err.status ?? -1;
      return {
        success: false,
        output: stdout,
        error: `Exit code ${exitCode}: ${stderr || err.message}`,
      };
    }
  }
}
