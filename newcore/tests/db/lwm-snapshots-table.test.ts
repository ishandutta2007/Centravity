// ═══════════════════════════════════════════════════════════════
// OpenCentravity — lwm_snapshots table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, lwm } from '../../src/db/index.js';
import type { LwmSnapshotData, MemoryNode, MemoryEdge, TelemetryState } from '../../src/types/index.js';

async function makeAgent() {
  return (await agents.insert({
    id: uuidv4(),
    task: 'lwm-test',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  })).id;
}

function makeData(tick: number, focus: string): LwmSnapshotData {
  const nodes: MemoryNode[] = [
    { id: 'goal:1', type: 'goal', content: 'main', activation: 0.9, goalBias: 0.8, decayRate: 0.01 },
    { id: 'transient:1', type: 'transient', content: 'noise', activation: 0.5, goalBias: 0.0, decayRate: 0.1 },
  ];
  const edges: MemoryEdge[] = [
    { source: 'goal:1', target: 'transient:1', weight: 0.5 },
  ];
  const telemetry: TelemetryState = {
    activeFocus: focus,
    activeGoals: ['goal:1'],
    cognitiveLoad: 0.42,
    swarmAttention: [{ nodeId: 'goal:1', activation: 0.9 }],
  };
  return { tick, telemetry, nodes, edges };
}

describe('lwm_snapshots table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('save + loadForAgent', () => {
    it('persists a snapshot and round-trips nodes + edges JSON', async () => {
      const agentId = await makeAgent();
      const data = makeData(1, 'goal:1');
      const id = await lwm.save(agentId, data);
      expect(id).toBeTruthy();

      const rows = await lwm.loadForAgent(agentId);
      expect(rows.length).toBe(1);
      expect(rows[0].agentId).toBe(agentId);
      expect(rows[0].activeFocus).toBe('goal:1');
      expect(rows[0].cognitiveLoad).toBeCloseTo(0.42, 5);
      expect(JSON.parse(rows[0].nodesJson)).toEqual(data.nodes);
      expect(JSON.parse(rows[0].edgesJson)).toEqual(data.edges);
    });

    it('orders snapshots by tick ASC and respects the limit', async () => {
      const agentId = await makeAgent();
      for (let i = 1; i <= 5; i++) {
        await lwm.save(agentId, makeData(i, `focus-${i}`));
      }
      const all = await lwm.loadForAgent(agentId);
      expect(all.length).toBe(5);
      expect(all.map(r => r.tick)).toEqual([1, 2, 3, 4, 5]);

      const limited = await lwm.loadForAgent(agentId, 3);
      expect(limited.length).toBe(3);
      expect(limited.map(r => r.tick)).toEqual([1, 2, 3]);
    });

    it('returns empty array for an agent with no snapshots', async () => {
      const rows = await lwm.loadForAgent(uuidv4());
      expect(rows).toEqual([]);
    });

    it('handles a large node/edge graph', async () => {
      const agentId = await makeAgent();
      const nodes: MemoryNode[] = Array.from({ length: 200 }, (_, i) => ({
        id: `n${i}`, type: 'transient', content: `n-${i}-${'X'.repeat(200)}`,
        activation: 0.5, goalBias: 0.0, decayRate: 0.1,
      }));
      const edges: MemoryEdge[] = Array.from({ length: 200 }, (_, i) => ({
        source: `n${i}`, target: `n${(i + 1) % 200}`, weight: 0.5,
      }));
      const telemetry: TelemetryState = {
        activeFocus: 'n0', activeGoals: [], cognitiveLoad: 1, swarmAttention: [],
      };
      await lwm.save(agentId, { tick: 1, telemetry, nodes, edges });
      const rows = await lwm.loadForAgent(agentId);
      expect(rows.length).toBe(1);
      const parsed = JSON.parse(rows[0].nodesJson);
      expect(parsed.length).toBe(200);
    });
  });

  describe('latestForAgent', () => {
    it('returns the highest-tick snapshot', async () => {
      const agentId = await makeAgent();
      await lwm.save(agentId, makeData(1, 'a'));
      await lwm.save(agentId, makeData(2, 'b'));
      await lwm.save(agentId, makeData(3, 'c'));
      const latest = await lwm.latestForAgent(agentId);
      expect(latest!.tick).toBe(3);
      expect(latest!.activeFocus).toBe('c');
    });

    it('returns null when there are no snapshots', async () => {
      expect(await lwm.latestForAgent(uuidv4())).toBeNull();
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes only snapshots whose created_at is older than the cutoff', async () => {
      const agentId = await makeAgent();
      await lwm.save(agentId, makeData(1, 'old'));
      await new Promise(r => setTimeout(r, 10)); // wait for time to advance
      const cutoff = Date.now();
      await new Promise(r => setTimeout(r, 10)); // wait for time to advance
      await lwm.save(agentId, makeData(2, 'new'));

      const deleted = await lwm.deleteOlderThan(cutoff);
      expect(deleted).toBe(1);
      const remaining = await lwm.loadForAgent(agentId);
      expect(remaining.length).toBe(1);
      expect(remaining[0].activeFocus).toBe('new');
    });

    it('returns 0 when nothing is older than the cutoff', async () => {
      const agentId = await makeAgent();
      await lwm.save(agentId, makeData(1, 'a'));
      const deleted = await lwm.deleteOlderThan(Date.now() - 10_000); // use past cutoff
      expect(deleted).toBe(0);
    });
  });
});
