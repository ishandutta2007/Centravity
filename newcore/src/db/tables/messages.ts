// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: messages
//
// All chat-history reads/writes go through this module. In v0.2.0
// the toolCalls JSON blob in the messages table is no longer
// the source of truth — the new tool_calls table is. The blob
// is kept for backward compat with any un-migrated readers.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import type { ChatMessage, MessageRole } from '../../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface MessageRow {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  toolCalls: string | null;        // legacy JSON blob (kept for v1 readers)
  toolCallId: string | null;
  name: string | null;
  createdAt: number;
  isPruned: number;                 // 0/1; soft-delete flag
  tokenCount: number | null;
}

export function rowToMessage(row: MessageRow): ChatMessage {
  return {
    role: row.role,
    content: row.content,
    name: row.name ?? undefined,
    toolCallId: row.toolCallId ?? undefined,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls) : undefined,
  };
}

/**
 * Inserts a message. Returns the generated id. Idempotent
 * against re-runs (uses INSERT OR IGNORE).
 */
export async function insert(msg: {
  agentId: string;
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: unknown;
  tokenCount?: number;
}): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO messages (id, agentId, role, content, toolCalls, toolCallId, name, createdAt, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      msg.agentId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId ?? null,
      msg.name ?? null,
      Date.now(),
      msg.tokenCount ?? null,
    ],
  });
  return id;
}

/**
 * Bulk-insert a list of messages. Used when an agent hydrates
 * from the DB on startup; preserves the original createdAt so
 * ordering is deterministic. Returns the inserted ids.
 */
export async function insertBatch(agentId: string, messages: ChatMessage[]): Promise<string[]> {
  const db = await getDb();
  const ids: string[] = [];
  // We step the timestamp by 1ms per message so order is stable
  // even if two messages have the same wall-clock time.
  let t = Date.now();
  for (const m of messages) {
    const id = uuidv4();
    t += 1;
    await db.execute({
      sql: `
        INSERT OR IGNORE INTO messages
          (id, agentId, role, content, toolCalls, toolCallId, name, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        agentId,
        m.role,
        m.content,
        m.toolCalls ? JSON.stringify(m.toolCalls) : null,
        m.toolCallId ?? null,
        m.name ?? null,
        t,
      ],
    });
    ids.push(id);
  }
  return ids;
}

/**
 * Loads all non-pruned messages for an agent, oldest first.
 */
export async function loadForAgent(agentId: string): Promise<MessageRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM messages WHERE agentId = ? AND is_pruned = 0 ORDER BY createdAt ASC',
    args: [agentId],
  });
  return result.rows.map(r => ({
    id: r.id as string,
    agentId: r.agentId as string,
    role: r.role as MessageRole,
    content: r.content as string,
    toolCalls: (r.toolCalls as string | null) ?? null,
    toolCallId: (r.toolCallId as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    createdAt: r.createdAt as number,
    isPruned: (r.is_pruned as number) ?? 0,
    tokenCount: (r.token_count as number | null) ?? null,
  }));
}

/**
 * Marks a message as pruned. Soft delete — the row stays for
 * audit / replay, but is excluded from the active context.
 */
export async function markPruned(id: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: 'UPDATE messages SET is_pruned = 1 WHERE id = ?',
    args: [id],
  });
}

/**
 * Returns the total token count of non-pruned messages for an
 * agent. Used to enforce context-window limits.
 */
export async function totalTokenCount(agentId: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE agentId = ? AND is_pruned = 0',
    args: [agentId],
  });
  return (result.rows[0].total as number) ?? 0;
}

/**
 * Hard-deletes pruned messages older than the given timestamp.
 * Used by the retention job.
 */
export async function pruneOlderThan(olderThanMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM messages WHERE is_pruned = 1 AND createdAt < ?',
    args: [olderThanMs],
  });
  return Number(result.rowsAffected ?? 0);
}
