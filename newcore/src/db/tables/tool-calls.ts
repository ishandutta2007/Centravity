// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: tool_calls (normalized)
//
// In v0.1.0, tool calls were stored as a JSON blob inside
// messages.toolCalls. In v0.2.0 they live in their own table,
// one row per call, with searchable fields. The message still
// holds a small reference (toolCallId) for ordering, but the
// full record is here.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface ToolCallRow {
  id: string;
  messageId: string;
  toolCallId: string | null;
  toolName: string;
  argumentsJson: string;
  resultJson: string | null;
  success: number | null;          // 0/1/null
  durationMs: number | null;
  createdAt: number;
}

/**
 * Records a tool call. Returns the generated id. Called by the
 * tool registry after every execution.
 */
export async function record(call: {
  messageId: string;
  toolCallId?: string;
  toolName: string;
  arguments: unknown;
  result?: unknown;
  success?: boolean;
  durationMs?: number;
}): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT INTO tool_calls
        (id, message_id, tool_call_id, tool_name, arguments_json, result_json, success, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      call.messageId,
      call.toolCallId ?? null,
      call.toolName,
      JSON.stringify(call.arguments ?? {}),
      call.result !== undefined ? JSON.stringify(call.result) : null,
      call.success === undefined ? null : (call.success ? 1 : 0),
      call.durationMs ?? null,
      Date.now(),
    ],
  });
  return id;
}

/**
 * Loads all tool calls for a given agent, newest first. Used
 * by the cost analyzer and the manager UI.
 */
export async function loadForAgent(agentId: string, limit = 200): Promise<ToolCallRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT tc.* FROM tool_calls tc
      INNER JOIN messages m ON tc.message_id = m.id
      WHERE m.agentId = ?
      ORDER BY tc.created_at DESC
      LIMIT ?
    `,
    args: [agentId, limit],
  });
  return result.rows.map(toRow);
}

/**
 * Returns aggregate statistics per tool name: how many times it
 * was called, how many succeeded, total duration. The Manager UI
 * uses this to draw the "tool health" panel.
 */
export async function aggregateStats(filter: { agentId?: string; sinceMs?: number } = {}): Promise<
  Array<{ toolName: string; calls: number; successes: number; failures: number; totalMs: number }>
> {
  const db = await getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (filter.agentId) {
    conditions.push('m.agentId = ?');
    args.push(filter.agentId);
  }
  if (filter.sinceMs !== undefined) {
    conditions.push('tc.created_at >= ?');
    args.push(filter.sinceMs);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.execute({
    sql: `
      SELECT tc.tool_name as toolName,
             COUNT(*) as calls,
             SUM(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) as successes,
             SUM(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) as failures,
             COALESCE(SUM(tc.duration_ms), 0) as totalMs
      FROM tool_calls tc
      INNER JOIN messages m ON tc.message_id = m.id
      ${where}
      GROUP BY tc.tool_name
      ORDER BY calls DESC
    `,
    args,
  });
  return result.rows.map(r => ({
    toolName: r.toolName as string,
    calls: Number(r.calls),
    successes: Number(r.successes),
    failures: Number(r.failures),
    totalMs: Number(r.totalMs),
  }));
}

function toRow(row: Record<string, unknown>): ToolCallRow {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    toolCallId: (row.tool_call_id as string | null) ?? null,
    toolName: row.tool_name as string,
    argumentsJson: row.arguments_json as string,
    resultJson: (row.result_json as string | null) ?? null,
    success: (row.success as number | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    createdAt: row.created_at as number,
  };
}
