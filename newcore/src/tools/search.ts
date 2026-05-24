// ═══════════════════════════════════════════════════════════════
// OpenGravity — Code Search Tool
// Fast text and pattern search using ripgrep-style matching.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class SearchCodeTool implements Tool {
  name = 'search_code';
  description = 'Search for text patterns across files in the workspace. Supports regex. Returns matching lines with file paths and line numbers.';
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (text or regex pattern)' },
      path: { type: 'string', description: 'Directory to search in (relative to workspace, default: root)' },
      filePattern: { type: 'string', description: 'Glob pattern for files to include (e.g., "*.ts", "*.py")' },
      isRegex: { type: 'boolean', description: 'Treat query as regex (default: false)' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
    },
    required: ['query'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const query = input.query as string;
    const searchPath = input.path ? join(context.workspaceDir, input.path as string) : context.workspaceDir;
    const filePattern = input.filePattern as string | undefined;
    const isRegex = input.isRegex as boolean || false;
    const maxResults = input.maxResults as number || 50;

    // Try ripgrep first (much faster)
    try {
      return this.searchWithRipgrep(query, searchPath, context.workspaceDir, filePattern, isRegex, maxResults);
    } catch {
      // Fallback to built-in search
      return this.searchBuiltin(query, searchPath, context.workspaceDir, filePattern, isRegex, maxResults);
    }
  }

  private searchWithRipgrep(query: string, searchPath: string, root: string, filePattern: string | undefined, isRegex: boolean, maxResults: number): ToolResult {
    const args = ['rg', '--json', '-n', '-m', String(maxResults)];
    if (!isRegex) args.push('-F'); // Fixed string (literal)
    if (filePattern) args.push('-g', filePattern);
    args.push('--', query, searchPath);

    const output = execSync(args.join(' '), { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, timeout: 10_000 });
    const lines = output.trim().split('\n').filter(Boolean);
    const results: string[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          const file = relative(root, parsed.data.path.text);
          const lineNum = parsed.data.line_number;
          const text = parsed.data.lines.text.trim();
          results.push(`${file}:${lineNum}: ${text}`);
        }
      } catch { /* skip malformed */ }
    }

    return { success: true, output: results.length ? results.join('\n') : 'No matches found.' };
  }

  private searchBuiltin(query: string, searchPath: string, root: string, filePattern: string | undefined, isRegex: boolean, maxResults: number): ToolResult {
    const results: string[] = [];
    const regex = isRegex ? new RegExp(query, 'gi') : null;

    const searchDir = (dir: string) => {
      if (results.length >= maxResults) return;
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            searchDir(full);
          } else if (stat.isFile() && stat.size < 1024 * 1024) {
            if (filePattern && !this.matchGlob(entry, filePattern)) continue;
            const content = readFileSync(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
              const match = regex ? regex.test(lines[i]) : lines[i].includes(query);
              if (match) {
                const rel = relative(root, full);
                results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              }
            }
          }
        } catch { /* skip unreadable */ }
      }
    };

    searchDir(searchPath);
    return { success: true, output: results.length ? results.join('\n') : 'No matches found.' };
  }

  private matchGlob(filename: string, pattern: string): boolean {
    const ext = pattern.replace('*', '');
    return filename.endsWith(ext);
  }
}
