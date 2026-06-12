// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: lwm_snapshots
//
// Periodically persists the full state of an agent's Liquid
// Working Memory. The Manager UI uses these snapshots to
// replay and debug agent behavior.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';
import type { MemoryNode, MemoryEdge, TelemetryState } from '../../types/index.js';

export interface LwmSnapshotRow {
  id: string;
  agentId: string;
  tick: number;
  activeFocus: string | null;
  cognitiveLoad: number;
  nodesJson: string;
  edgesJson: string;
  createdAt: number;
}

export interface LwmSnapshotData {
  tick: number;
  telemetry: TelemetryState;
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

/**
 * Persists one snapshot of an agent's LWM. We store the full
 * node + edge maps as JSON so replay is lossless.
 */
export async function save(agentId: string, data: LwmSnapshotData): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT INTO lwm_snapshots
        (id, agent_id, tick, active_focus, cognitive_load, nodes_json, edges_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      agentId,
      data.tick,
      data.telemetry.activeFocus,
      data.telemetry.cognitiveLoad,
      JSON.stringify(data.nodes),
      JSON.stringify(data.edges),
      Date.now(),
    ],
  });
  return id;
}

/**
 * Loads all snapshots for an agent, oldest first. Used by the
 * replay command and the /memory/snapshots API endpoint.
 */
export async function loadForAgent(agentId: string, limit = 100): Promise<LwmSnapshotRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM lwm_snapshots WHERE agent_id = ? ORDER BY tick ASC LIMIT ?',
    args: [agentId, limit],
  });
  return result.rows.map(toRow);
}

/**
 * Returns the most recent snapshot. Useful for "show me what
 * the agent is focused on right now" without scanning history.
 */
export async function latestForAgent(agentId: string): Promise<LwmSnapshotRow | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM lwm_snapshots WHERE agent_id = ? ORDER BY tick DESC LIMIT 1',
    args: [agentId],
  });
  if (result.rows.length === 0) return null;
  return toRow(result.rows[0]);
}

export async function deleteOlderThan(olderThanMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM lwm_snapshots WHERE created_at < ?',
    args: [olderThanMs],
  });
  return Number(result.rowsAffected ?? 0);
}

function toRow(r: Record<string, unknown>): LwmSnapshotRow {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    tick: r.tick as number,
    activeFocus: (r.active_focus as string | null) ?? null,
    cognitiveLoad: (r.cognitive_load as number) ?? 0,
    nodesJson: r.nodes_json as string,
    edgesJson: r.edges_json as string,
    createdAt: r.created_at as number,
  };
}
