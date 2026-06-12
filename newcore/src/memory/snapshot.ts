// ═══════════════════════════════════════════════════════════════
// OpenCentravity — LWM Snapshot Persistence
//
// Periodically persists the full state of an agent's Liquid Working
// Memory (LWM) to the database. The LWM itself is in-RAM (zero
// dependencies, no GPU), but snapshots let us:
//   1. Replay an agent's attention after a crash
//   2. Show the Manager UI "what was the agent focused on at tick N"
//   3. Cap memory growth (old snapshots get pruned by retention)
//
// Config knobs (from src/config):
//   - lwmSnapshotEveryNTicks (default 10): how often to snapshot
//   - lwmMaxSnapshotsPerAgent (default 1000): cap on stored snapshots
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../config/index.js';
import * as lwmTable from '../db/tables/lwm-snapshots.js';
import type { LiquidMemory } from '../memory/liquid.js';

/**
 * Tracks the last snapshot tick for an agent. Held in-memory for
 * the duration of the agent's life. Reset on agent restart.
 */
const lastTick = new Map<string, number>();

/**
 * Returns true if the agent should snapshot now. The decision is
 * made by comparing the current tick counter against the
 * configured interval.
 */
export function shouldSnapshot(agentId: string, currentTickCounter: number): boolean {
  const config = getConfig();
  return currentTickCounter > 0 && currentTickCounter % config.lwmSnapshotEveryNTicks === 0;
}

/**
 * Persists a snapshot of the agent's LWM to the database. Stores
 * the full node and edge maps as JSON so replay is lossless.
 * Errors are swallowed — a snapshot failure must never break
 * the agent's run.
 */
export async function persistSnapshot(
  agentId: string,
  memory: LiquidMemory,
  currentTick: number,
): Promise<void> {
  try {
    const telemetry = memory.getTelemetryState();
    const nodes = memory.getAllNodes();
    const edges = memory.getAllEdges();
    await lwmTable.save(agentId, { tick: currentTick, telemetry, nodes, edges });
    lastTick.set(agentId, currentTick);

    // Cap retention: if the agent has more than the configured
    // max snapshots, delete the oldest ones.
    const config = getConfig();
    if (config.lwmMaxSnapshotsPerAgent > 0) {
      const existing = await lwmTable.loadForAgent(agentId, 10_000);
      if (existing.length > config.lwmMaxSnapshotsPerAgent) {
        const oldest = existing[existing.length - 1];
        if (oldest) {
          const cutoff = oldest.createdAt - 1;
          await lwmTable.deleteOlderThan(cutoff);
        }
      }
    }
  } catch (err) {
    // Non-fatal: a failed snapshot is logged but does not break
    // the agent's run. The next successful snapshot will catch up.
    if (process.env.DEBUG) {
      console.error(`LWM snapshot failed for agent ${agentId}:`, err);
    }
  }
}

/**
 * Returns the tick of the last successful snapshot for an agent.
 * Returns 0 if the agent has never snapshotted.
 */
export function getLastSnapshotTick(agentId: string): number {
  return lastTick.get(agentId) ?? 0;
}

/**
 * Clears the in-memory tracking for an agent. Call this when
 * the agent finishes (completed/failed/cancelled) so memory
 * doesn't leak across runs.
 */
export function clearSnapshotTracking(agentId: string): void {
  lastTick.delete(agentId);
}

/**
 * Prunes LWM snapshots older than the configured retention.
 * Returns the number of snapshots deleted. Call this from a
 * periodic job or on agent completion.
 */
export async function pruneOldSnapshots(olderThanMs: number): Promise<number> {
  return lwmTable.deleteOlderThan(olderThanMs);
}
