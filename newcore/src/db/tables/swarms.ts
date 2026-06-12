// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: swarms
//
// A swarm is a team of agents working on a shared root task.
// One row per swarm; agents reference it via agents.swarm_id.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface SwarmRow {
  id: string;
  rootTask: string;
  rootAgentId: string;
  pattern: 'pipeline' | 'fanout' | 'generator-critic' | 'tournament';
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  maxCostUsd: number;
  sharedGoalsJson: string | null;
  createdAt: number;
  completedAt: number | null;
}

export async function insert(swarm: Omit<SwarmRow, 'createdAt' | 'completedAt'>): Promise<SwarmRow> {
  const db = await getDb();
  const now = Date.now();
  const row: SwarmRow = { ...swarm, createdAt: now, completedAt: null };
  await db.execute({
    sql: `
      INSERT INTO swarms (id, root_task, root_agent_id, pattern, status, max_cost_usd, shared_goals_json, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      row.id, row.rootTask, row.rootAgentId, row.pattern, row.status,
      row.maxCostUsd, row.sharedGoalsJson, row.createdAt, row.completedAt,
    ],
  });
  return row;
}

export async function findById(id: string): Promise<SwarmRow | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM swarms WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return toRow(result.rows[0]);
}

export async function listActive(): Promise<SwarmRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT * FROM swarms WHERE status = 'active' ORDER BY created_at DESC",
  });
  return result.rows.map(toRow);
}

export async function listAll(limit = 100): Promise<SwarmRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM swarms ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  });
  return result.rows.map(toRow);
}

export async function updateStatus(id: string, status: SwarmRow['status']): Promise<void> {
  const db = await getDb();
  const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
    ? Date.now()
    : null;
  await db.execute({
    sql: 'UPDATE swarms SET status = ?, completed_at = ? WHERE id = ?',
    args: [status, completedAt, id],
  });
}

export async function setSharedGoals(id: string, goalsJson: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: 'UPDATE swarms SET shared_goals_json = ? WHERE id = ?',
    args: [goalsJson, id],
  });
}

/**
 * Sums the cost of all cost_events belonging to agents in this swarm.
 * Used for budget enforcement and the cost endpoint.
 */
export async function totalCost(swarmId: string): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT COALESCE(SUM(ce.cost_usd), 0) as total
      FROM cost_events ce
      INNER JOIN agents a ON ce.agent_id = a.id
      WHERE a.swarm_id = ? OR ce.swarm_id = ?
    `,
    args: [swarmId, swarmId],
  });
  return (result.rows[0].total as number) ?? 0;
}

function toRow(r: Record<string, unknown>): SwarmRow {
  return {
    id: r.id as string,
    rootTask: r.root_task as string,
    rootAgentId: r.root_agent_id as string,
    pattern: r.pattern as SwarmRow['pattern'],
    status: r.status as SwarmRow['status'],
    maxCostUsd: (r.max_cost_usd as number) ?? 0,
    sharedGoalsJson: (r.shared_goals_json as string | null) ?? null,
    createdAt: r.created_at as number,
    completedAt: (r.completed_at as number | null) ?? null,
  };
}
