// ═══════════════════════════════════════════════════════════════
// OpenCentravity — swarms table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, swarms, cost } from '../../src/db/index.js';

async function makeRootAgent() {
  return (await agents.insert({
    id: uuidv4(),
    task: 'root',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  })).id;
}

describe('swarms table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('insert + findById', () => {
    it('inserts a swarm and reads it back', async () => {
      const root = await makeRootAgent();
      const row = await swarms.insert({
        id: uuidv4(),
        rootTask: 'build a thing',
        rootAgentId: root,
        pattern: 'fanout',
        status: 'active',
        maxCostUsd: 5.0,
        sharedGoalsJson: JSON.stringify(['a', 'b']),
      });
      expect(row.id).toBeTruthy();
      expect(row.createdAt).toBeGreaterThan(0);
      expect(row.completedAt).toBeNull();

      const fetched = await swarms.findById(row.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.pattern).toBe('fanout');
      expect(fetched!.rootTask).toBe('build a thing');
      expect(fetched!.maxCostUsd).toBe(5.0);
    });

    it('findById returns null for unknown id', async () => {
      expect(await swarms.findById(uuidv4())).toBeNull();
    });

    it('handles unicode in rootTask', async () => {
      const root = await makeRootAgent();
      const id = uuidv4();
      await swarms.insert({
        id,
        rootTask: '🚀 项目开发 日本語',
        rootAgentId: root,
        pattern: 'pipeline',
        status: 'active',
        maxCostUsd: 0,
        sharedGoalsJson: null,
      });
      const row = await swarms.findById(id);
      expect(row!.rootTask).toContain('🚀');
      expect(row!.rootTask).toContain('日本語');
    });
  });

  describe('listActive / listAll', () => {
    it('listActive returns only active swarms', async () => {
      const root = await makeRootAgent();
      const a = await swarms.insert({ id: uuidv4(), rootTask: 't', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      const b = await swarms.insert({ id: uuidv4(), rootTask: 't', rootAgentId: root, pattern: 'pipeline', status: 'completed', maxCostUsd: 0, sharedGoalsJson: null });

      const active = await swarms.listActive();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(a.id);
      expect(active[0].id).not.toBe(b.id);
    });

    it('listAll returns all swarms newest first', async () => {
      const root = await makeRootAgent();
      await swarms.insert({ id: uuidv4(), rootTask: 'a', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      await new Promise(r => setTimeout(r, 2));
      await swarms.insert({ id: uuidv4(), rootTask: 'b', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      const all = await swarms.listAll();
      expect(all.length).toBe(2);
      expect(all[0].rootTask).toBe('b');
    });
  });

  describe('updateStatus', () => {
    it('sets completedAt when transitioning to completed', async () => {
      const root = await makeRootAgent();
      const row = await swarms.insert({ id: uuidv4(), rootTask: 't', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      await swarms.updateStatus(row.id, 'completed');
      const fetched = await swarms.findById(row.id);
      expect(fetched!.status).toBe('completed');
      expect(fetched!.completedAt).not.toBeNull();
    });

    it('does not set completedAt for staying active', async () => {
      const root = await makeRootAgent();
      const row = await swarms.insert({ id: uuidv4(), rootTask: 't', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      await swarms.updateStatus(row.id, 'active');
      const fetched = await swarms.findById(row.id);
      expect(fetched!.completedAt).toBeNull();
    });
  });

  describe('setSharedGoals', () => {
    it('persists shared goals JSON', async () => {
      const root = await makeRootAgent();
      const row = await swarms.insert({ id: uuidv4(), rootTask: 't', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null });
      await swarms.setSharedGoals(row.id, JSON.stringify({ goals: ['g1', 'g2'] }));
      const fetched = await swarms.findById(row.id);
      expect(JSON.parse(fetched!.sharedGoalsJson!)).toEqual({ goals: ['g1', 'g2'] });
    });
  });

  describe('totalCost', () => {
    it('sums cost_events cost for the swarm', async () => {
      const root = await makeRootAgent();
      const member = (await agents.insert({
        id: uuidv4(), task: 'm', model: 'mock', workspaceDir: './w',
        maxRetries: 0, timeoutMs: 1, tools: [],
      }, { swarmId: (await swarms.insert({
        id: uuidv4(), rootTask: 'r', rootAgentId: root, pattern: 'pipeline',
        status: 'active', maxCostUsd: 0, sharedGoalsJson: null,
      })).id })).id;

      await cost.record({ agentId: member, swarmId: undefined, provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
      await cost.record({ agentId: member, swarmId: undefined, provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, costUsd: 0.02 });
      // We need to set swarmId on the cost event too; retrieve it
      const swarmId = (await agents.findById(member))!.swarmId!;
      await cost.record({ agentId: member, swarmId, provider: 'anthropic', model: 'claude-3-5', inputTokens: 100, outputTokens: 50, costUsd: 0.05 });

      const total = await swarms.totalCost(swarmId);
      expect(total).toBeCloseTo(0.08, 5);
    });

    it('returns 0 for a swarm with no cost events', async () => {
      const root = await makeRootAgent();
      const id = (await swarms.insert({ id: uuidv4(), rootTask: 'r', rootAgentId: root, pattern: 'pipeline', status: 'active', maxCostUsd: 0, sharedGoalsJson: null })).id;
      expect(await swarms.totalCost(id)).toBe(0);
    });
  });
});
