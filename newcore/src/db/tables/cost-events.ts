// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Table Module: cost_events
//
// Every LLM call records one row here. The orchestrator sums
// these to enforce per-swarm budget caps and to expose the
// cost breakdown endpoints.
// ═══════════════════════════════════════════════════════════════

import { getDb } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export interface CostEventRow {
  id: string;
  agentId: string;
  swarmId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: number;
}

export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  callCount: number;
  byProvider: Record<string, { calls: number; costUsd: number }>;
  byModel: Record<string, { calls: number; costUsd: number }>;
}

/**
 * Records a cost event. Called by the gateway's cost recorder
 * after every LLM call. Idempotency is the caller's job
 * (we don't have a request id here yet).
 */
export async function record(event: {
  agentId: string;
  swarmId?: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.execute({
    sql: `
      INSERT INTO cost_events
        (id, agent_id, swarm_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      event.agentId,
      event.swarmId ?? null,
      event.provider,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.costUsd,
      Date.now(),
    ],
  });
  return id;
}

/**
 * Returns a cost summary for the given scope (agent or swarm).
 * Includes per-provider and per-model breakdowns for the UI.
 */
export async function summarize(scope: { agentId?: string; swarmId?: string }): Promise<CostSummary> {
  const db = await getDb();
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (scope.agentId) {
    conditions.push('agent_id = ?');
    args.push(scope.agentId);
  }
  if (scope.swarmId) {
    conditions.push('swarm_id = ?');
    args.push(scope.swarmId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Aggregate everything in one round-trip.
  const result = await db.execute({
    sql: `
      SELECT provider, model,
             COUNT(*) as calls,
             SUM(input_tokens) as in_tok,
             SUM(output_tokens) as out_tok,
             SUM(cost_usd) as cost
      FROM cost_events
      ${where}
      GROUP BY provider, model
    `,
    args,
  });

  const summary: CostSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    callCount: 0,
    byProvider: {},
    byModel: {},
  };

  for (const r of result.rows) {
    const calls = Number(r.calls);
    const inTok = Number(r.in_tok);
    const outTok = Number(r.out_tok);
    const cost = Number(r.cost);
    const provider = r.provider as string;
    const model = r.model as string;

    summary.totalInputTokens += inTok;
    summary.totalOutputTokens += outTok;
    summary.totalCostUsd += cost;
    summary.callCount += calls;

    summary.byProvider[provider] = summary.byProvider[provider] ?? { calls: 0, costUsd: 0 };
    summary.byProvider[provider].calls += calls;
    summary.byProvider[provider].costUsd += cost;

    summary.byModel[model] = summary.byModel[model] ?? { calls: 0, costUsd: 0 };
    summary.byModel[model].calls += calls;
    summary.byModel[model].costUsd += cost;
  }

  return summary;
}

/**
 * Deletes cost events older than the given timestamp. Used by
 * the retention job. Returns rows deleted.
 */
export async function deleteOlderThan(olderThanMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: 'DELETE FROM cost_events WHERE created_at < ?',
    args: [olderThanMs],
  });
  return Number(result.rowsAffected ?? 0);
}
