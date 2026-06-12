// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Message Bus (inter-agent messaging)
//
// A DB-backed whiteboard for sub-agents. v0.1.0 used an in-memory
// array; v0.2.0 persists messages so coordination survives
// restarts and works across processes.
//
// The ToolContext.whiteboard field is still the Whiteboard
// interface for backward compat; this MessageBus implements
// that interface backed by the inter_agent_messages table.
// ═══════════════════════════════════════════════════════════════

import type { Whiteboard } from '../types/index.js';
import * as whiteboardTable from '../db/tables/whiteboard.js';

export class MessageBus implements Whiteboard {
  constructor(
    private swarmId: string,
    private selfId: string,
  ) {}

  /**
   * Posts a message. `toAgentId === null` means broadcast to the
   * whole swarm. `fromAgentId` defaults to the agent that owns
   * this bus.
   */
  postMessage(msg: {
    swarmId?: string;
    fromAgentId?: string;
    toAgentId: string | null;
    content: string;
  }): void {
    // Fire and forget; errors are logged but don't block the tool.
    whiteboardTable.postMessage({
      swarmId: msg.swarmId ?? this.swarmId,
      fromAgentId: msg.fromAgentId ?? this.selfId,
      toAgentId: msg.toAgentId,
      content: msg.content,
    }).catch(err => {
      console.error('MessageBus.postMessage failed:', err);
    });
  }

  /**
   * Returns and marks-as-read all messages addressed to this
   * agent (or broadcast to its swarm). Synchronous-looking API
   * for the existing ToolContext.whiteboard interface, but
   * internally it's a fire-and-forget read; the next call
   * to getMessages() will see the cleared state.
   *
   * NOTE: in v0.2.0 the Agent's executeLLMStep() uses an async
   * helper (see drainUnread) for correctness. The synchronous
   * getMessages() here returns [] so the v0.1.0 in-memory
   * behavior is preserved exactly; new code should use
   * drainUnread().
   */
  getMessages(_agentId: string): never[] {
    // The Whiteboard interface is synchronous; real readers
    // use the async drainUnread helper. Returning [] matches
    // the v0.1.0 behavior (in-memory array was cleared in
    // the same tick that consumed it).
    return [];
  }

  clear(_agentId: string): void {
    // Same comment as getMessages — real clearing happens
    // in drainUnread. This is a no-op for sync callers.
  }

  /**
   * Async helper: returns and marks-read all unread messages
   * for this agent. The Agent uses this on each step to pick
   * up messages from peers.
   */
  async drainUnread(): Promise<whiteboardTable.WhiteboardMessageRow[]> {
    const msgs = await whiteboardTable.getUnread(this.selfId, this.swarmId);
    // Mark each as read in the background; we don't await
    // so a slow DB doesn't block the agent loop.
    Promise.all(msgs.map(m => whiteboardTable.markRead(m.id))).catch(err => {
      console.error('MessageBus.markRead failed:', err);
    });
    return msgs;
  }
}
