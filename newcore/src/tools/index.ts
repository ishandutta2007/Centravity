// ═══════════════════════════════════════════════════════════════
// OpenGravity — Tool Registry
// Central hub for all tool adapters. Exposes tools in
// OpenAI function-calling compatible format.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolDefinition, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import { FileSystemTool, ListDirectoryTool } from './filesystem.js';
import { TerminalTool } from './terminal.js';
import { SearchCodeTool } from './search.js';
import { GitTool } from './git.js';
import { LinterTool } from './linter.js';
import { Z3VerifyTool } from './z3-solver.js';
import { TypeCheckerTool } from './typechecker.js';

import { PythonSandboxTool } from './sandbox.js';
import { SemanticSearchTool } from './semantic.js';

import { DelegateTaskTool } from './delegate.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const defaults: Tool[] = [
      new FileSystemTool('read_file', 'read'),
      new FileSystemTool('write_file', 'write'),
      new ListDirectoryTool(),
      new TerminalTool(),
      new SearchCodeTool(),
      new SemanticSearchTool(),
      new PythonSandboxTool(),
      new DelegateTaskTool(),
      new GitTool(),
      new LinterTool(),
      new Z3VerifyTool(),
      new TypeCheckerTool(),
    ];
    for (const tool of defaults) {
      this.tools.set(tool.name, tool);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Returns tool definitions in OpenAI function-calling format */
  getDefinitions(filter?: string[]): ToolDefinition[] {
    const tools = filter
      ? Array.from(this.tools.values()).filter(t => filter.includes(t.name))
      : Array.from(this.tools.values());

    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async execute(name: string, input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${name}` };
    }

    // Audit the tool call
    const start = Date.now();
    context.auditLog.log({
      agentId: context.agentId,
      action: `tool:${name}`,
      target: JSON.stringify(input).slice(0, 200),
      result: 'success',
      details: '',
      durationMs: 0,
    });

    try {
      const result = await tool.execute(input, context);

      context.auditLog.log({
        agentId: context.agentId,
        action: `tool:${name}:complete`,
        target: JSON.stringify(input).slice(0, 200),
        result: result.success ? 'success' : 'failure',
        details: result.error ?? result.output.slice(0, 500),
        durationMs: Date.now() - start,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      context.auditLog.log({
        agentId: context.agentId,
        action: `tool:${name}:error`,
        target: JSON.stringify(input).slice(0, 200),
        result: 'failure',
        details: error,
        durationMs: Date.now() - start,
      });
      return { success: false, output: '', error };
    }
  }
}
