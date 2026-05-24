// ═══════════════════════════════════════════════════════════════
// OpenGravity — Multi-Agent Delegation Tool
// Spawns a sub-agent to handle specialized tasks and waits for result.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
// We would ideally inject the orchestrator, but for architecture simplicity
// we will instantiate a new Agent or make an API call to localhost.
import { AgentOrchestrator } from '../orchestrator/index.js';

// Global orchestrator instance for local sub-agents
let localOrchestrator: AgentOrchestrator | null = null;

export class DelegateTaskTool implements Tool {
  name = 'delegate_task';
  description = `MULTI-AGENT PROTOCOL: Spawn a specialized sub-agent to solve a complex sub-task.
  Use this when a task is too big for one agent or requires specialized verification.
  The sub-agent will run in the exact same workspace and have access to all your files.
  Wait for it to finish and it will return a summary of its actions.`;

  parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Detailed instruction for the sub-agent' },
      specialty: { type: 'string', enum: ['coder', 'verifier', 'researcher'], description: 'The role of the sub-agent' },
    },
    required: ['task'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const task = input.task as string;
    
    // Lazy init orchestrator if needed
    if (!localOrchestrator) {
      localOrchestrator = new AgentOrchestrator();
    }

    try {
      const subAgent = localOrchestrator.createAgent(
        `[Sub-Agent delegated by ${context.agentId}] ${task}`,
        { workspaceDir: context.workspaceDir }
      );
      
      context.auditLog.log({
        agentId: context.agentId,
        action: 'multi_agent:delegate',
        target: subAgent.id,
        result: 'success',
        details: `Spawned sub-agent for: ${task}`,
        durationMs: 0
      });

      // Run sub-agent synchronously (waits for it to finish)
      const status = await subAgent.run();

      if (status.state === 'completed') {
        return { 
          success: true, 
          output: `Sub-agent ${subAgent.id} successfully completed the task. Check the workspace files for the results.` 
        };
      } else {
        return { 
          success: false, 
          output: '', 
          error: `Sub-agent ${subAgent.id} failed: ${status.error}` 
        };
      }
    } catch (err: any) {
      return { success: false, output: '', error: `Delegation failed: ${err.message}` };
    }
  }
}
