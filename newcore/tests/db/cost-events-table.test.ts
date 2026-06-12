// ═══════════════════════════════════════════════════════════════
// OpenCentravity — cost_events table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, cost, swarms } from '../../src/db/index.js';

async function makeAgent(swarmId?: string) {
  return (await agents.insert({
    id: uuidv4(),
    task: 'cost-test',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  }, { swarmId: swarmId ?? null })).id;
}

describe('cost_events table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('record', () => {
    it('records an event and returns an id', async () => {
      const id = await cost.record({
        agentId: await makeAgent(),
        swarmId: null,
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      });
      expect(id).toBeTruthy();
    });

    it('preserves zero values', async () => {
      const agentId = await makeAgent();
      const id = await cost.record({
        agentId, swarmId: null, provider: 'p', model: 'm',
        inputTokens: 0, outputTokens: 0, costUsd: 0,
      });
      expect(id).toBeTruthy();
      const s = await cost.summarize({ agentId });
      expect(s.callCount).toBe(1);
      expect(s.totalCostUsd).toBe(0);
    });
  });

  describe('summarize', () => {
    it('aggregates totals and breaks down by provider and model', async () => {
      const agentId = await makeAgent();
      await cost.record({ agentId, swarmId: null, provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
      await cost.record({ agentId, swarmId: null, provider: 'openai', model: 'gpt-4o', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
      await cost.record({ agentId, swarmId: null, provider: 'anthropic', model: 'claude-3-5-sonnet', inputTokens: 300, outputTokens: 150, costUsd: 0.05 });
      await cost.record({ agentId, swarmId: null, provider: 'anthropic', model: 'claude-3-haiku', inputTokens: 50, outputTokens: 25, costUsd: 0.001 });

      const s = await cost.summarize({ agentId });
      expect(s.callCount).toBe(4);
      expect(s.totalInputTokens).toBe(650);
      expect(s.totalOutputTokens).toBe(325);
      expect(s.totalCostUsd).toBeCloseTo(0.081, 5);

      // byProvider
      expect(s.byProvider['openai']).toBeDefined();
      expect(s.byProvider['openai'].calls).toBe(2);
      expect(s.byProvider['openai'].costUsd).toBeCloseTo(0.03, 5);
      expect(s.byProvider['anthropic'].calls).toBe(2);
      expect(s.byProvider['anthropic'].costUsd).toBeCloseTo(0.051, 5);

      // byModel
      expect(s.byModel['gpt-4o'].calls).toBe(2);
      expect(s.byModel['gpt-4o'].costUsd).toBeCloseTo(0.03, 5);
      expect(s.byModel['claude-3-5-sonnet'].calls).toBe(1);
      expect(s.byModel['claude-3-haiku'].calls).toBe(1);
    });

    it('returns empty summary for an agent with no events', async () => {
      const s = await cost.summarize({ agentId: uuidv4() });
      expect(s.callCount).toBe(0);
      expect(s.totalCostUsd).toBe(0);
      expect(s.byProvider).toEqual({});
      expect(s.byModel).toEqual({});
    });

    it('scopes to swarmId', async () => {
      const swarm = uuidv4();
      const root = await makeAgent();
      await swarms.insert({
        id: swarm,
        rootTask: 'parent task',
        rootAgentId: root,
        pattern: 'pipeline',
        status: 'active',
        maxCostUsd: 10.0,
        sharedGoalsJson: null,
      });
      const a = await makeAgent(swarm);
      const b = await makeAgent(); // not in swarm
      await cost.record({ agentId: a, swarmId: swarm, provider: 'p', model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.1 });
      await cost.record({ agentId: b, swarmId: null, provider: 'p', model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 99 });
      const s = await cost.summarize({ swarmId: swarm });
      expect(s.callCount).toBe(1);
      expect(s.totalCostUsd).toBeCloseTo(0.1, 5);
    });

    it('handles unicode provider/model names', async () => {
      const agentId = await makeAgent();
      await cost.record({ agentId, swarmId: null, provider: '🚀', model: 'モデル-A', inputTokens: 1, outputTokens: 1, costUsd: 0.0001 });
      const s = await cost.summarize({ agentId });
      expect(s.byProvider['🚀']).toBeDefined();
      expect(s.byModel['モデル-A']).toBeDefined();
    });
  });

  describe('deleteOlderThan', () => {
    it('deletes events older than the cutoff', async () => {
      const agentId = await makeAgent();
      await cost.record({ agentId, swarmId: null, provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.001 });
      await new Promise(r => setTimeout(r, 10));
      const cutoff = Date.now();
      await new Promise(r => setTimeout(r, 10));
      await cost.record({ agentId, swarmId: null, provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.001 });

      const deleted = await cost.deleteOlderThan(cutoff);
      expect(deleted).toBe(1);
      const s = await cost.summarize({ agentId });
      expect(s.callCount).toBe(1);
    });

    it('returns 0 when nothing matches', async () => {
      const agentId = await makeAgent();
      await cost.record({ agentId, swarmId: null, provider: 'p', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0 });
      const deleted = await cost.deleteOlderThan(Date.now() - 10_000);
      expect(deleted).toBe(0);
    });
  });
});
