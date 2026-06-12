// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: artifacts
//
// Artifacts in v0.1.0 were JSON files in artifacts/<agentId>/.
// In v0.2.0 we keep the files (they're useful for the artifact
// viewer) but also index them here for FTS5 search and to
// support "shared with swarm" visibility.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export type ArtifactType =
  | 'execution_plan'
  | 'diff'
  | 'log'
  | 'test_result'
  | 'verification'
  | 'z3_proof'
  | 'error_trace';

export interface ArtifactRow {
  id: string;
  agentId: string;
  swarmId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  metadataJson: string | null;
  visibility: 'private' | 'swarm' | 'public';
  createdAt: number;
}

export async function insert(artifact: Omit<ArtifactRow, 'id' | 'createdAt'>): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  const now = Date.now();
  await db.execute({
    sql: `
      INSERT INTO artifacts (id, agent_id, swarm_id, type, title, content, metadata_json, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      artifact.agentId,
      artifact.swarmId,
      artifact.type,
      artifact.title,
      artifact.content,
      artifact.metadataJson,
      artifact.visibility,
      now,
    ],
  });
  return id;
}

export async function findById(id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM artifacts WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return toRow(result.rows[0]);
}

export async function listForAgent(agentId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM artifacts WHERE agent_id = ? ORDER BY created_at DESC',
    args: [agentId],
  });
  return result.rows.map(toRow);
}

export async function listForSwarm(swarmId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM artifacts WHERE swarm_id = ? OR (agent_id IN (SELECT id FROM agents WHERE swarm_id = ?)) ORDER BY created_at DESC',
    args: [swarmId, swarmId],
  });
  return result.rows.map(toRow);
}

/**
 * Full-text search over artifacts. Uses the FTS5 virtual table
 * defined in migration 0006. Returns the matching rows ordered
 * by relevance (BM25).
 */
export async function search(query: string, limit = 20): Promise<ArtifactRow[]> {
  const db = await getDb();
  // The FTS5 query syntax is rich; we wrap the user input in
  // double quotes to disable operator parsing and avoid injection.
  // Then we add a prefix "*" for partial matches.
  const safeQuery = `"${query.replace(/"/g, '""')}"*`;
  const result = await db.execute({
    sql: `
      SELECT a.* FROM artifacts a
      INNER JOIN artifacts_fts fts ON a.rowid = fts.rowid
      WHERE artifacts_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
    args: [safeQuery, limit],
  });
  return result.rows.map(toRow);
}

function toRow(r: Record<string, unknown>): ArtifactRow {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    swarmId: (r.swarm_id as string | null) ?? null,
    type: r.type as ArtifactType,
    title: r.title as string,
    content: r.content as string,
    metadataJson: (r.metadata_json as string | null) ?? null,
    visibility: r.visibility as 'private' | 'swarm' | 'public',
    createdAt: r.created_at as number,
  };
}
