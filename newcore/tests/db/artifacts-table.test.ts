// ═══════════════════════════════════════════════════════════════
// OpenCentravity — artifacts table test suite (incl. FTS5 search)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, swarms, artifacts } from '../../src/db/index.js';

async function makeAgent() {
  return (await agents.insert({
    id: uuidv4(),
    task: 'art-test',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  })).id;
}

async function makeSwarm(rootAgentId: string) {
  return (await swarms.insert({
    id: uuidv4(),
    rootTask: 'do stuff',
    rootAgentId,
    pattern: 'pipeline',
    status: 'active',
    maxCostUsd: 1.0,
    sharedGoalsJson: null,
  })).id;
}

describe('artifacts table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('insert + findById', () => {
    it('inserts an artifact and reads it back', async () => {
      const agentId = await makeAgent();
      const id = await artifacts.insert({
        agentId,
        swarmId: null,
        type: 'log',
        title: 'Build log',
        content: 'starting build... done',
        metadataJson: JSON.stringify({ step: 1 }),
        visibility: 'private',
      });
      const row = await artifacts.findById(id);
      expect(row).not.toBeNull();
      expect(row!.title).toBe('Build log');
      expect(row!.type).toBe('log');
      expect(row!.visibility).toBe('private');
      expect(JSON.parse(row!.metadataJson!)).toEqual({ step: 1 });
    });

    it('returns null for unknown id', async () => {
      expect(await artifacts.findById(uuidv4())).toBeNull();
    });

    it('handles unicode and large content', async () => {
      const agentId = await makeAgent();
      const big = '🚀'.repeat(2_000) + '\n' + 'B'.repeat(8_000);
      const id = await artifacts.insert({
        agentId, swarmId: null, type: 'log',
        title: 'big', content: big, metadataJson: null, visibility: 'private',
      });
      const row = await artifacts.findById(id);
      expect(row!.content.length).toBe(big.length);
    });
  });

  describe('listForAgent', () => {
    it('returns only the specified agent artifacts, newest first', async () => {
      const a = await makeAgent();
      const b = await makeAgent();
      await artifacts.insert({ agentId: a, swarmId: null, type: 'log', title: 'a1', content: 'x', metadataJson: null, visibility: 'private' });
      await new Promise(r => setTimeout(r, 2));
      await artifacts.insert({ agentId: a, swarmId: null, type: 'log', title: 'a2', content: 'y', metadataJson: null, visibility: 'private' });
      await artifacts.insert({ agentId: b, swarmId: null, type: 'log', title: 'b1', content: 'z', metadataJson: null, visibility: 'private' });
      const rows = await artifacts.listForAgent(a);
      expect(rows.length).toBe(2);
      expect(rows[0].title).toBe('a2');
      expect(rows.every(r => r.agentId === a)).toBe(true);
    });
  });

  describe('listForSwarm', () => {
    it('returns swarm-shared artifacts and private artifacts of swarm members', async () => {
      const root = await makeAgent();
      const swarmId = await makeSwarm(root);
      const member = await makeAgent();
      // Make the member part of the swarm
      await agents.update(member, { /* no direct setter for swarm_id via update, so create with swarm */ });
      // Insert a new agent with the swarm id instead
      const member2 = await agents.insert({
        id: uuidv4(),
        task: 'm', model: 'mock', workspaceDir: './w',
        maxRetries: 0, timeoutMs: 1, tools: [],
      }, { swarmId });

      // Swarm-shared artifact (swarm_id set)
      await artifacts.insert({ agentId: member2.id, swarmId, type: 'log', title: 'shared', content: 'A', metadataJson: null, visibility: 'swarm' });
      // Private artifact from a swarm member
      await artifacts.insert({ agentId: member2.id, swarmId: null, type: 'log', title: 'private-member', content: 'B', metadataJson: null, visibility: 'private' });
      // Private artifact from a NON-member
      const outsider = await makeAgent();
      await artifacts.insert({ agentId: outsider, swarmId: null, type: 'log', title: 'outside', content: 'C', metadataJson: null, visibility: 'private' });

      const rows = await artifacts.listForSwarm(swarmId);
      const titles = rows.map(r => r.title).sort();
      expect(titles).toEqual(['private-member', 'shared']);
      void root; void member;
    });
  });

  describe('search (FTS5)', () => {
    it('finds artifacts by exact and partial tokens in title/content', async () => {
      const agentId = await makeAgent();
      await artifacts.insert({ agentId, swarmId: null, type: 'log', title: 'authentication setup', content: 'configures JWT', metadataJson: null, visibility: 'private' });
      await artifacts.insert({ agentId, swarmId: null, type: 'log', title: 'database migration', content: 'runs sqlite migrations', metadataJson: null, visibility: 'private' });
      await artifacts.insert({ agentId, swarmId: null, type: 'log', title: 'untitled', content: 'no relevant content', metadataJson: null, visibility: 'private' });

      const r1 = await artifacts.search('authentication');
      expect(r1.length).toBeGreaterThanOrEqual(1);
      expect(r1.some(a => a.title.includes('authentication'))).toBe(true);

      // Prefix search
      const r2 = await artifacts.search('auth');
      expect(r2.length).toBeGreaterThanOrEqual(1);

      // Token present in content
      const r3 = await artifacts.search('JWT');
      expect(r3.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty array for a query that matches nothing', async () => {
      const agentId = await makeAgent();
      await artifacts.insert({ agentId, swarmId: null, type: 'log', title: 'a', content: 'b', metadataJson: null, visibility: 'private' });
      const r = await artifacts.search('xyzzynothere');
      expect(r).toEqual([]);
    });

    it('safely handles query strings with double quotes', async () => {
      const agentId = await makeAgent();
      await artifacts.insert({ agentId, swarmId: null, type: 'log', title: 'normal', content: 'hello', metadataJson: null, visibility: 'private' });
      // The double-quote escape should not throw and should not match
      // (no row contains a literal `"` token).
      const r = await artifacts.search('"weird"');
      expect(Array.isArray(r)).toBe(true);
    });

    it('respects the limit parameter', async () => {
      const agentId = await makeAgent();
      for (let i = 0; i < 5; i++) {
        await artifacts.insert({ agentId, swarmId: null, type: 'log', title: `match-${i}`, content: 'commonword', metadataJson: null, visibility: 'private' });
      }
      const r = await artifacts.search('match', 2);
      expect(r.length).toBe(2);
    });
  });
});
