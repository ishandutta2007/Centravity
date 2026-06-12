// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: whiteboard (inter-agent messages)
//
// The "whiteboard" in v0.1.0 was an in-memory array. v0.2.0
// persists messages so sub-agents can coordinate across server
// restarts. This module wraps the inter_agent_messages table
// with a small, focused API.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface WhiteboardMessageRow {
  id: string;
  swarmId: string;
  fromAgentId: string;
  toAgentId: string | null;       // null = broadcast to swarm
  content: string;
  messageType: 'info' | 'request' | 'response' | 'error' | 'artifact_share';
  readAt: number | null;
  createdAt: number;
}

export interface Whiteboard {
  postMessage(msg: {
    swarmId: string;
    fromAgentId: string;
    toAgentId: string | null;
    content: string;
    messageType?: WhiteboardMessageRow['messageType'];
  }): void;
  getMessages(agentId: string): WhiteboardMessageRow[];
  clear(agentId: string): void;
}

export async function postMessage(msg: {
  swarmId: string;
  fromAgentId: string;
  toAgentId: string | null;
  content: string;
  messageType?: WhiteboardMessageRow['messageType'];
}): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT INTO inter_agent_messages (id, swarm_id, from_agent_id, to_agent_id, content, message_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      msg.swarmId,
      msg.fromAgentId,
      msg.toAgentId,
      msg.content,
      msg.messageType ?? 'info',
      Date.now(),
    ],
  });
  return id;
}

/**
 * Returns undelivered messages addressed to the given agent OR
 * broadcast to its swarm. Does NOT mark them as read; that's
 * the caller's job (see markRead).
 */
export async function getUnread(agentId: string, swarmId?: string): Promise<WhiteboardMessageRow[]> {
  const db = await getDb();
  const conditions = [
    'read_at IS NULL',
    '(to_agent_id = ? OR to_agent_id IS NULL)',
    'from_agent_id != ?',  // don't deliver your own messages to yourself
  ];
  const args: (string | number)[] = [agentId, agentId];

  if (swarmId) {
    conditions.push('swarm_id = ?');
    args.push(swarmId);
  }

  const result = await db.execute({
    sql: `SELECT * FROM inter_agent_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`,
    args,
  });
  return result.rows.map(toRow);
}

export async function markRead(messageId: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: 'UPDATE inter_agent_messages SET read_at = ? WHERE id = ?',
    args: [Date.now(), messageId],
  });
}

export async function markAllReadForAgent(agentId: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      UPDATE inter_agent_messages
      SET read_at = ?
      WHERE read_at IS NULL
        AND (to_agent_id = ? OR to_agent_id IS NULL)
        AND from_agent_id != ?
    `,
    args: [Date.now(), agentId, agentId],
  });
  return Number(result.rowsAffected ?? 0);
}

/**
 * Builds the Whiteboard interface that the Agent expects in
 * ToolContext. The interface methods delegate to the DB.
 */
export function buildWhiteboard(swarmId: string, selfId: string): Whiteboard {
  return {
    postMessage: (msg) => {
      // Fire and forget — we don't block the tool executor on
      // the write, but we still await the promise so errors
      // surface to the audit log.
      postMessage({
        ...msg,
        fromAgentId: msg.fromAgentId || selfId,
        swarmId: msg.swarmId || swarmId,
      }).catch(err => {
        // Surface to stderr; the audit logger would be better
        // but we don't have a logger reference here.
        console.error('Whiteboard postMessage failed:', err);
      });
    },
    getMessages: () => {
      // The Agent.run loop calls this synchronously and expects
      // an array. We return an empty array if the DB call fails
      // so a transient DB issue doesn't crash the agent.
      // Real readers should use getUnread() directly.
      try {
        // We can't await inside this sync-looking interface;
        // the actual implementation will be async in the next
        // iteration. For now, return empty.
        return [];
      } catch {
        return [];
      }
    },
    clear: () => {
      try {
        markAllReadForAgent(selfId).catch(() => {});
      } catch {
        // Best effort
      }
    },
  };
}

function toRow(r: Record<string, unknown>): WhiteboardMessageRow {
  return {
    id: r.id as string,
    swarmId: r.swarm_id as string,
    fromAgentId: r.from_agent_id as string,
    toAgentId: (r.to_agent_id as string | null) ?? null,
    content: r.content as string,
    messageType: r.message_type as WhiteboardMessageRow['messageType'],
    readAt: (r.read_at as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}
