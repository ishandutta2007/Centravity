// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: agents
//
// Every read and write to the `agents` table goes through here.
// Keeping all agent SQL in one file means we can change the
// schema once and the rest of the codebase is unaffected.
// ═══════════════════════════════════════════════════════════════

import { getDb, withTransaction, prepare } from '../index.js';
import type { AgentConfig, AgentState, AgentStatus } from '../../types/index.js';
import { v4 as uuidv4 } from 'uuid';

// ── Types ───────────────────────────────────────────────────────

/**
 * The full row shape of the agents table. Mirrors the v0.2.0
 * schema (see migrations/0003_agents_v2.sql).
 */
export interface AgentRow {
  id: string;
  task: string;
  model: string;
  state: AgentState;
  workspaceDir: string;
  currentStep: number;
  startedAt: number;
  updatedAt: number;
  parentId: string | null;
  swarmId: string | null;
  role: string;
  taskHash: string | null;
  stateBeforePause: string | null;
  configJson: string;
  costJson: string | null;
  completedAt: number | null;
  error: string | null;
  artifactsCount: number;
  toolCallsCount: number;
}

/** Shape stored in config_json (the full AgentConfig minus id). */
export interface AgentConfigBlob {
  maxRetries: number;
  timeoutMs: number;
  tools: string[];
  policyOverrides?: Record<string, boolean>;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * SHA-256 hash of a task string. Used to detect duplicate tasks
 * and to enable task-level caching later. Implemented with the
 * built-in `crypto` module so we have zero new dependencies.
 */
export async function hashTask(task: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(task).digest('hex');
}

/**
 * Builds a complete AgentConfigBlob from a (possibly partial)
 * AgentConfig. Defaults match the orchestrator's defaults in
 * v0.1.0 so behavior is unchanged for callers that pass partial
 * configs.
 */
export function buildConfigBlob(config: Partial<AgentConfig> | undefined): AgentConfigBlob {
  return {
    maxRetries: config?.maxRetries ?? 2,
    timeoutMs: config?.timeoutMs ?? 120_000,
    tools: config?.tools ?? [],
    policyOverrides: config?.policyOverrides,
  };
}

// ── Row ↔ Type conversions ──────────────────────────────────────

/** Converts a raw DB row to our strongly-typed AgentRow. */
export function rowToAgent(row: Record<string, unknown>): AgentRow {
  return {
    id: row.id as string,
    task: row.task as string,
    model: row.model as string,
    state: row.state as AgentState,
    workspaceDir: row.workspaceDir as string,
    currentStep: row.currentStep as number,
    startedAt: row.startedAt as number,
    updatedAt: row.updatedAt as number,
    parentId: (row.parent_id as string | null) ?? null,
    swarmId: (row.swarm_id as string | null) ?? null,
    role: (row.role as string) ?? 'coder',
    taskHash: (row.task_hash as string | null) ?? null,
    stateBeforePause: (row.state_before_pause as string | null) ?? null,
    configJson: (row.config_json as string) ?? '{}',
    costJson: (row.cost_json as string | null) ?? null,
    completedAt: (row.completed_at as number | null) ?? null,
    error: (row.error as string | null) ?? null,
    artifactsCount: (row.artifacts_count as number) ?? 0,
    toolCallsCount: (row.tool_calls_count as number) ?? 0,
  };
}

/** Converts a DB row to the public AgentStatus shape used by the API. */
export function rowToStatus(row: AgentRow): AgentStatus {
  return {
    id: row.id,
    state: row.state,
    task: row.task,
    model: row.model,
    currentStep: row.currentStep,
    totalSteps: 0, // filled in by agent.ts from the plan
    artifacts: [], // filled in by agent.ts
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    error: row.error ?? undefined,
  };
}

// ── Reads ───────────────────────────────────────────────────────

/**
 * Fetches one agent by id, or returns null if not found.
 */
export async function findById(id: string): Promise<AgentRow | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM agents WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

/**
 * Lists agents, newest first. Optional filters:
 *   - swarmId: only agents in this swarm
 *   - parentId: only children of this agent
 *   - state: only agents in this state
 *   - role: only agents with this role
 *   - limit: max rows to return (default 100)
 */
export async function findMany(filter: {
  swarmId?: string;
  parentId?: string;
  state?: AgentState;
  role?: string;
  limit?: number;
} = {}): Promise<AgentRow[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filter.swarmId !== undefined) {
    conditions.push('swarm_id = ?');
    args.push(filter.swarmId);
  }
  if (filter.parentId !== undefined) {
    conditions.push('parent_id = ?');
    args.push(filter.parentId);
  }
  if (filter.state !== undefined) {
    conditions.push('state = ?');
    args.push(filter.state);
  }
  if (filter.role !== undefined) {
    conditions.push('role = ?');
    args.push(filter.role);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;

  const result = await db.execute({
    sql: `SELECT * FROM agents ${where} ORDER BY startedAt DESC LIMIT ?`,
    args: [...args, limit],
  });
  return result.rows.map(rowToAgent);
}

/**
 * Returns the full lineage tree under a given root agent. Uses
 * a recursive CTE so it works in one round-trip regardless of
 * tree depth.
 */
export async function getDescendantTree(rootId: string): Promise<AgentRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM agents WHERE id = ?
        UNION ALL
        SELECT a.id FROM agents a
        INNER JOIN descendants d ON a.parent_id = d.id
      )
      SELECT a.* FROM agents a
      INNER JOIN descendants d ON a.id = d.id
      ORDER BY a.startedAt ASC
    `,
    args: [rootId],
  });
  return result.rows.map(rowToAgent);
}

// ── Writes ──────────────────────────────────────────────────────

/**
 * Inserts a new agent row. Returns the created row. Uses an
 * UPSERT so re-running this with the same id is safe (idempotent).
 */
export async function insert(config: AgentConfig, extras: {
  role?: string;
  parentId?: string | null;
  swarmId?: string | null;
} = {}): Promise<AgentRow> {
  const db = await getDb();
  const taskHash = await hashTask(config.task);
  const now = Date.now();
  const role = extras.role ?? 'coder';
  const configBlob = buildConfigBlob(config);

  await db.execute({
    sql: `
      INSERT INTO agents (
        id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt,
        parent_id, swarm_id, role, task_hash, config_json
      ) VALUES (?, ?, ?, 'idle', ?, 0, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task = excluded.task,
        model = excluded.model,
        workspaceDir = excluded.workspaceDir,
        role = excluded.role,
        config_json = excluded.config_json,
        updatedAt = excluded.updatedAt
    `,
    args: [
      config.id, config.task, config.model, config.workspaceDir,
      now, now,
      extras.parentId ?? null,
      extras.swarmId ?? null,
      role,
      taskHash,
      JSON.stringify(configBlob),
    ],
  });

  const created = await findById(config.id);
  if (!created) {
    // Should be impossible since we just inserted it.
    throw new Error(`Agent insert succeeded but findById returned null for ${config.id}`);
  }
  return created;
}

/**
 * Updates the mutable fields of an agent. State, currentStep,
 * error, and counters can all be updated in one call.
 */
export async function update(id: string, fields: {
  state?: AgentState;
  currentStep?: number;
  stateBeforePause?: string | null;
  completedAt?: number | null;
  error?: string | null;
  artifactsCount?: number;
  toolCallsCount?: number;
  costJson?: string | null;
}): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  if (fields.state !== undefined) {
    sets.push('state = ?');
    args.push(fields.state);
  }
  if (fields.currentStep !== undefined) {
    sets.push('currentStep = ?');
    args.push(fields.currentStep);
  }
  if (fields.stateBeforePause !== undefined) {
    sets.push('state_before_pause = ?');
    args.push(fields.stateBeforePause);
  }
  if (fields.completedAt !== undefined) {
    sets.push('completed_at = ?');
    args.push(fields.completedAt);
  }
  if (fields.error !== undefined) {
    sets.push('error = ?');
    args.push(fields.error);
  }
  if (fields.artifactsCount !== undefined) {
    sets.push('artifacts_count = ?');
    args.push(fields.artifactsCount);
  }
  if (fields.toolCallsCount !== undefined) {
    sets.push('tool_calls_count = ?');
    args.push(fields.toolCallsCount);
  }
  if (fields.costJson !== undefined) {
    sets.push('cost_json = ?');
    args.push(fields.costJson);
  }

  if (sets.length === 0) return; // no-op

  // Always bump updatedAt
  sets.push('updatedAt = ?');
  args.push(Date.now());

  await db.execute({
    sql: `UPDATE agents SET ${sets.join(', ')} WHERE id = ?`,
    args: [...args, id],
  });
}

/**
 * Bulk insert of N agents in one transaction. Used by the future
 * fan-out orchestration patterns. Returns the inserted rows.
 */
export async function insertBatch(configs: AgentConfig[]): Promise<AgentRow[]> {
  return withTransaction(async () => {
    const rows: AgentRow[] = [];
    for (const c of configs) {
      rows.push(await insert(c));
    }
    return rows;
  });
}
