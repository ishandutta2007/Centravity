// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Inter-Agent Messaging Tool
//
// Sends a message from the calling agent to a peer agent on the
// same swarm's whiteboard (inter_agent_messages table). Useful
// for explicit coordination: handoffs, requests for verification,
// sharing intermediate results, etc.
// ═══════════════════════════════════════════════════════════════

import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import * as whiteboardTable from '../db/tables/whiteboard.js';

export class MessageAgentTool implements Tool {
  name = 'message_agent';
  description = "Send a message to another agent. Use to coordinate with peer agents in the same swarm.";

  parameters = {
    type: 'object',
    properties: {
      target_agent_id: {
        type: 'string',
        description: 'The id of the agent that should receive this message',
      },
      content: {
        type: 'string',
        description: 'The textual content of the message',
      },
      message_type: {
        type: 'string',
        enum: ['info', 'request', 'response'],
        description: "Optional message kind — defaults to 'info'",
      },
    },
    required: ['target_agent_id', 'content'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const targetAgentId = input.target_agent_id as string;
    const content = input.content as string;
    const messageType = (input.message_type as 'info' | 'request' | 'response' | undefined) ?? 'info';

    if (!targetAgentId || typeof targetAgentId !== 'string') {
      return { success: false, output: '', error: 'target_agent_id is required' };
    }
    if (!content || typeof content !== 'string') {
      return { success: false, output: '', error: 'content is required' };
    }

    // The whiteboard messages belong to a swarm. Pull the swarmId
    // off the context (added in v0.2.0) — fall back to a synthetic
    // id derived from the agent so a single-agent run still works.
    const swarmId = (context as any).swarmId as string | undefined
      ?? `swarm-${context.agentId}`;

    try {
      const messageId = await whiteboardTable.postMessage({
        swarmId,
        fromAgentId: context.agentId,
        toAgentId: targetAgentId,
        content,
        messageType,
      });

      return {
        success: true,
        output: `Message sent to ${targetAgentId} (id=${messageId})`,
        metadata: { messageId, targetAgentId, messageType },
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
