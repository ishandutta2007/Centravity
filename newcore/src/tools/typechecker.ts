// ═══════════════════════════════════════════════════════════════
// OpenGravity — TypeChecker Tool
// Runs TypeScript compiler or mypy for type verification.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class TypeCheckerTool implements Tool {
  name = 'type_check';
  description = 'Run type checking on the workspace. Uses tsc --noEmit for TypeScript or mypy for Python.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory to type-check (default: workspace root)' },
      language: { type: 'string', enum: ['typescript', 'python', 'auto'], description: 'Language to type-check (default: auto-detect)' },
    },
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = (input.path as string) || '.';
    const fullPath = resolve(context.workspaceDir, rawPath);
    let language = input.language as string || 'auto';

    if (language === 'auto') {
      const ext = extname(fullPath).toLowerCase();
      if (['.ts', '.tsx'].includes(ext) || existsSync(resolve(context.workspaceDir, 'tsconfig.json'))) {
        language = 'typescript';
      } else if (['.py'].includes(ext)) {
        language = 'python';
      }
    }

    let cmd: string;
    if (language === 'typescript') {
      cmd = 'npx tsc --noEmit --pretty 2>&1';
    } else if (language === 'python') {
      cmd = `python -m mypy "${fullPath}" 2>&1`;
    } else {
      return { success: true, output: 'No type checker available for this language.' };
    }

    try {
      const output = execSync(cmd, {
        cwd: context.workspaceDir, encoding: 'utf-8', timeout: 60_000,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      });
      return { success: true, output: output.trim() || 'No type errors found ✓' };
    } catch (err: any) {
      const output = err.stdout?.toString() ?? err.message;
      return { success: false, output, error: 'Type errors found' };
    }
  }
}
