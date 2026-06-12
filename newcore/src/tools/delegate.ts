// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Multi-Agent Delegation Tool (v0.2.0)
//
// Spawns a sub-agent to handle a specialized task. v0.2.0:
//
//   - Writes parent_id and swarm_id so the lineage is queryable
//   - Creates a swarm row if the parent doesn't have one
//   - Optional `role` parameter (coder | verifier | researcher | ...)
//   - Optional `parallel_count` for fan-out
//   - Returns a structured report (success, summary, files, cost)
//
// The tool's PUBLIC parameters (task, specialty) are unchanged
// for backward compat; new parameters are optional and additive.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import { AgentOrchestrator } from '../orchestrator/index.js';
import * as swarmsTable from '../db/tables/swarms.js';
import { v4 as uuidv4 } from 'uuid';

// We share ONE orchestrator instance across the whole process
// for sub-agents. This matches v0.1.0 behavior (single global
// orchestrator) but routes through the typed DB layer.
let localOrchestrator: AgentOrchestrator | null = null;

export class DelegateTaskTool implements Tool {
  name = 'delegate_task';
  description = `MULTI-AGENT PROTOCOL: Spawn a specialized sub-agent to solve a complex sub-task.
  Use this when a task is too big for one agent or requires specialized verification.
  The sub-agent will run in the exact same workspace and have access to all your files.
  Wait for it to finish and it will return a summary of its actions.

  v0.2.0 additions:
    - 'role' (optional): 'coder'|'verifier'|'researcher'|'planner'|'tester' — defaults to 'coder'
    - 'parallel_count' (optional): spawn N identical agents in parallel; returns array of results
    - 'swarm_id' (optional): join an existing swarm instead of creating a new one`;

  parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Detailed instruction for the sub-agent' },
      specialty: { type: 'string', enum: ['coder', 'verifier', 'researcher'], description: 'The role of the sub-agent' },
      role: { type: 'string', enum: ['coder', 'verifier', 'researcher', 'planner', 'tester'], description: '(v0.2.0) Same as specialty, with more options' },
      parallel_count: { type: 'number', description: '(v0.2.0) Spawn N identical agents in parallel. Default 1.' },
      swarm_id: { type: 'string', description: '(v0.2.0) Join an existing swarm by id' },
    },
    required: ['task'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const task = input.task as string;
    const role = (input.role as string) ?? (input.specialty as string) ?? 'coder';
    const parallelCount = Math.max(1, Math.min(8, (input.parallel_count as number) ?? 1));
    const explicitSwarmId = input.swarm_id as string | undefined;

    // Lazy init orchestrator
    if (!localOrchestrator) {
      localOrchestrator = new AgentOrchestrator();
    }

    // 1. Resolve the swarm. If the caller already has a swarm
    //    and the explicitSwarmId is unset, reuse it. If neither,
    //    create a new swarm row.
    const parentSwarmId = explicitSwarmId ?? (context as any).swarmId ?? null;
    let swarmId = parentSwarmId;
    if (!swarmId) {
      const newSwarm = await swarmsTable.insert({
        id: `swarm-${uuidv4()}`,
        rootTask: task,
        rootAgentId: context.agentId,
        pattern: parallelCount > 1 ? 'fanout' : 'pipeline',
        status: 'active',
        maxCostUsd: 0,
        sharedGoalsJson: null,
      });
      swarmId = newSwarm.id;
    }

    try {
      // 2. Spawn the sub-agent(s). For parallel_count > 1, we
      //    use Promise.all to run them concurrently.
      const spawnOne = async () => {
        const subAgent = localOrchestrator!.createAgent(
          `[Sub-Agent delegated by ${context.agentId}] ${task}`,
          {
            workspaceDir: context.workspaceDir,
            parentId: context.agentId,
            swarmId: swarmId ?? undefined,
            role,
          }
        );

        context.auditLog.log({
          agentId: context.agentId,
          action: 'multi_agent:delegate',
          target: subAgent.id,
          result: 'success',
          details: `Spawned sub-agent (role=${role}) for: ${task.slice(0, 200)}`,
          durationMs: 0
        });

        return subAgent.run();
      };

      if (parallelCount === 1) {
        const status = await spawnOne();
        if (status.state === 'completed') {
          return {
            success: true,
            output: `Sub-agent completed.\nTask: ${task}\nArtifacts: ${status.artifacts.length}\nSteps: ${status.currentStep}/${status.totalSteps}\nRole: ${role}\nSwarm: ${swarmId}`,
            metadata: { subAgentId: status.id, role, swarmId, status },
          };
        } else {
          return {
            success: false,
            output: '',
            error: `Sub-agent failed: ${status.error ?? status.state}`,
          };
        }
      } else {
        // Parallel fan-out
        const results = await Promise.all(Array.from({ length: parallelCount }, () => spawnOne()));
        const successes = results.filter(r => r.state === 'completed').length;
        const summary = results.map((r, i) =>
          `  [${i + 1}/${parallelCount}] ${r.state} (${r.currentStep}/${r.totalSteps} steps, ${r.artifacts.length} artifacts)`
        ).join('\n');
        return {
          success: successes > 0,
          output: `Parallel delegation: ${successes}/${parallelCount} succeeded\n${summary}`,
          metadata: { swarmId, role, parallelCount, statuses: results },
        };
      }
    } catch (err: any) {
      return { success: false, output: '', error: `Delegation failed: ${err.message ?? err}` };
    }
  }
}
