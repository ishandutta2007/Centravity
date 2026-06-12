// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: audit_v2
//
// DB-backed audit log. v0.1.0 used a JSONL file; v0.2.0 makes
// the DB the source of truth. The JSONL file is still written
// by the AuditLogger class for backward compat with log parsers.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface AuditRow {
  id: string;
  timestamp: number;
  agentId: string | null;
  action: string;
  target: string;
  result: 'success' | 'failure' | 'blocked';
  details: string;
  durationMs: number;
}

export async function insert(entry: Omit<AuditRow, 'id'>): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT INTO audit_v2 (id, timestamp, agent_id, action, target, result, details, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      entry.timestamp,
      entry.agentId,
      entry.action,
      entry.target,
      entry.result,
      entry.details,
      entry.durationMs,
    ],
  });
  return id;
}

export async function query(filter: {
  agentId?: string;
  action?: string;
  result?: 'success' | 'failure' | 'blocked';
  sinceMs?: number;
  limit?: number;
} = {}): Promise<AuditRow[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (filter.agentId) {
    conditions.push('agent_id = ?');
    args.push(filter.agentId);
  }
  if (filter.action) {
    conditions.push('action LIKE ?');
    args.push(`%${filter.action}%`);
  }
  if (filter.result) {
    conditions.push('result = ?');
    args.push(filter.result);
  }
  if (filter.sinceMs !== undefined) {
    conditions.push('timestamp >= ?');
    args.push(filter.sinceMs);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;

  const result = await db.execute({
    sql: `SELECT * FROM audit_v2 ${where} ORDER BY timestamp DESC LIMIT ?`,
    args: [...args, limit],
  });
  return result.rows.map(toRow);
}

/**
 * Returns counts of audit events grouped by result. The Manager
 * UI shows this as a "success vs failure" pie/bar chart.
 */
export async function getStats(filter: { agentId?: string; sinceMs?: number } = {}): Promise<{
  total: number;
  success: number;
  failure: number;
  blocked: number;
}> {
  const db = await getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (filter.agentId) {
    conditions.push('agent_id = ?');
    args.push(filter.agentId);
  }
  if (filter.sinceMs !== undefined) {
    conditions.push('timestamp >= ?');
    args.push(filter.sinceMs);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.execute({
    sql: `SELECT result, COUNT(*) as c FROM audit_v2 ${where} GROUP BY result`,
    args,
  });

  const stats = { total: 0, success: 0, failure: 0, blocked: 0 };
  for (const r of result.rows) {
    const count = Number(r.c);
    const result2 = r.result as 'success' | 'failure' | 'blocked';
    stats.total += count;
    stats[result2] += count;
  }
  return stats;
}

export async function deleteOlderThan(olderThanMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM audit_v2 WHERE timestamp < ?',
    args: [olderThanMs],
  });
  return Number(result.rowsAffected ?? 0);
}

function toRow(r: Record<string, unknown>): AuditRow {
  return {
    id: r.id as string,
    timestamp: r.timestamp as number,
    agentId: (r.agent_id as string | null) ?? null,
    action: r.action as string,
    target: r.target as string,
    result: r.result as 'success' | 'failure' | 'blocked',
    details: (r.details as string) ?? '',
    durationMs: (r.duration_ms as number) ?? 0,
  };
}
