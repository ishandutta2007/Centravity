// ═══════════════════════════════════════════════════════════════
// OpenGravity — Filesystem Tools
// Read, write, list, and watch files with policy enforcement.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, relative, dirname, join } from 'path';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class FileSystemTool implements Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  private mode: 'read' | 'write';

  constructor(name: string, mode: 'read' | 'write') {
    this.mode = mode;
    if (mode === 'read') {
      this.name = name;
      this.description = 'Read the contents of a file at the given path. Returns the file content as text.';
      this.parameters = {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path to the file to read' },
          startLine: { type: 'number', description: 'Optional start line (1-indexed)' },
          endLine: { type: 'number', description: 'Optional end line (1-indexed, inclusive)' },
        },
        required: ['path'],
      };
    } else {
      this.name = name;
      this.description = 'Write content to a file. Creates the file and parent directories if they don\'t exist.';
      this.parameters = {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'Content to write to the file' },
          append: { type: 'boolean', description: 'If true, append to existing file instead of overwriting' },
        },
        required: ['path', 'content'],
      };
    }
  }

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = input.path as string;
    const fullPath = resolve(context.workspaceDir, rawPath);

    // Policy check
    const action = this.mode === 'read' ? 'file_read' as const : 'file_write' as const;
    const decision = context.policyEngine.check({
      type: action, target: fullPath, agentId: context.agentId, workspaceDir: context.workspaceDir,
    });
    if (!decision.allowed) {
      return { success: false, output: '', error: `Policy blocked: ${decision.reason}` };
    }

    try {
      if (this.mode === 'read') {
        if (!existsSync(fullPath)) {
          return { success: false, output: '', error: `File not found: ${rawPath}` };
        }
        let content = readFileSync(fullPath, 'utf-8');
        const startLine = input.startLine as number | undefined;
        const endLine = input.endLine as number | undefined;
        if (startLine || endLine) {
          const lines = content.split('\n');
          const start = (startLine ?? 1) - 1;
          const end = endLine ?? lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { success: true, output: content };
      } else {
        const dir = dirname(fullPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const content = input.content as string;
        const append = input.append as boolean | undefined;
        if (append) {
          const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
          writeFileSync(fullPath, existing + content, 'utf-8');
        } else {
          writeFileSync(fullPath, content, 'utf-8');
        }
        const relPath = relative(context.workspaceDir, fullPath);
        return { success: true, output: `File written: ${relPath} (${content.length} bytes)` };
      }
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class ListDirectoryTool implements Tool {
  name = 'list_directory';
  description = 'List files and directories at the given path. Shows file sizes and types.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
      recursive: { type: 'boolean', description: 'If true, list recursively' },
      maxDepth: { type: 'number', description: 'Max depth for recursive listing (default: 3)' },
    },
    required: ['path'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const rawPath = (input.path as string) || '.';
    const fullPath = resolve(context.workspaceDir, rawPath);
    const recursive = input.recursive as boolean || false;
    const maxDepth = input.maxDepth as number || 3;

    if (!existsSync(fullPath)) {
      return { success: false, output: '', error: `Directory not found: ${rawPath}` };
    }

    try {
      const entries = this.listDir(fullPath, context.workspaceDir, recursive, 0, maxDepth);
      return { success: true, output: entries.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private listDir(dir: string, root: string, recursive: boolean, depth: number, maxDepth: number): string[] {
    const entries: string[] = [];
    const items = readdirSync(dir);
    const indent = '  '.repeat(depth);

    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules') continue;
      const full = join(dir, item);
      try {
        const stat = statSync(full);
        const rel = relative(root, full);
        if (stat.isDirectory()) {
          entries.push(`${indent}📁 ${rel}/`);
          if (recursive && depth < maxDepth) {
            entries.push(...this.listDir(full, root, recursive, depth + 1, maxDepth));
          }
        } else {
          const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
          entries.push(`${indent}📄 ${rel} (${size})`);
        }
      } catch { /* skip unreadable */ }
    }
    return entries;
  }
}
