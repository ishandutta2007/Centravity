// ═══════════════════════════════════════════════════════════════
// OpenGravity — Linter Tool
// Runs ESLint or language-specific linters on files.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class LinterTool implements Tool {
  name = 'lint_code';
  description = 'Run a linter on the specified file or directory. Auto-detects language and uses appropriate linter (ESLint for JS/TS, pylint/ruff for Python).';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to lint' },
      fix: { type: 'boolean', description: 'If true, auto-fix issues where possible' },
    },
    required: ['path'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = input.path as string;
    const fullPath = resolve(context.workspaceDir, rawPath);
    const fix = input.fix as boolean || false;

    if (!existsSync(fullPath)) {
      return { success: false, output: '', error: `Path not found: ${rawPath}` };
    }

    const ext = extname(fullPath).toLowerCase();
    let cmd: string;

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext) || ext === '') {
      // Try npx eslint
      cmd = `npx eslint ${fix ? '--fix' : ''} "${fullPath}" --format compact 2>&1`;
    } else if (['.py'].includes(ext)) {
      // Try ruff first, then pylint
      cmd = `python -m ruff check ${fix ? '--fix' : ''} "${fullPath}" 2>&1 || python -m pylint "${fullPath}" 2>&1`;
    } else {
      return { success: true, output: `No linter configured for ${ext} files.` };
    }

    try {
      const output = execSync(cmd, {
        cwd: context.workspaceDir, encoding: 'utf-8', timeout: 30_000,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      });
      return { success: true, output: output.trim() || 'No lint issues found ✓' };
    } catch (err: any) {
      // Linters exit non-zero when they find issues — that's normal
      const output = err.stdout?.toString() ?? '';
      return { success: true, output: output || 'Lint check completed with issues.' };
    }
  }
}
