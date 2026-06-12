// ═══════════════════════════════════════════════════════════════
// OpenCentravity — whiteboard (inter_agent_messages) test suite
//
// The inter_agent_messages table enforces FKs against swarms and
// agents, so each test must first create a real swarm and a real
// agent before posting a message.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, swarms, whiteboard } from '../../src/db/index.js';

async function makeSwarmWithAgents() {
  const root = (await agents.insert({
    id: uuidv4(),
    task: 'wb-root',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  })).id;
  const swarm = await swarms.insert({
    id: uuidv4(),
    rootTask: 'wb',
    rootAgentId: root,
    pattern: 'pipeline',
    status: 'active',
    maxCostUsd: 0,
    sharedGoalsJson: null,
  });
  const from = (await agents.insert({
    id: uuidv4(), task: 'wb-from', model: 'mock', workspaceDir: './w',
    maxRetries: 0, timeoutMs: 1, tools: [],
  }, { swarmId: swarm.id })).id;
  const to = (await agents.insert({
    id: uuidv4(), task: 'wb-to', model: 'mock', workspaceDir: './w',
    maxRetries: 0, timeoutMs: 1, tools: [],
  }, { swarmId: swarm.id })).id;
  const otherTo = (await agents.insert({
    id: uuidv4(), task: 'wb-other', model: 'mock', workspaceDir: './w',
    maxRetries: 0, timeoutMs: 1, tools: [],
  }, { swarmId: swarm.id })).id;
  return { swarmId: swarm.id, from, to, otherTo };
}

describe('whiteboard (inter_agent_messages)', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('postMessage + getUnread', () => {
    it('posts a directed message and delivers to recipient', async () => {
      const { swarmId, from, to } = await makeSwarmWithAgents();
      await whiteboard.postMessage({
        swarmId, fromAgentId: from, toAgentId: to,
        content: 'ping', messageType: 'info',
      });
      const unread = await whiteboard.getUnread(to, swarmId);
      expect(unread.length).toBe(1);
      expect(unread[0].content).toBe('ping');
      expect(unread[0].toAgentId).toBe(to);
    });

    it('broadcasts a message with toAgentId=null to all swarm members', async () => {
      const { swarmId, from, to, otherTo } = await makeSwarmWithAgents();
      await whiteboard.postMessage({
        swarmId, fromAgentId: from, toAgentId: null,
        content: 'broadcast!', messageType: 'info',
      });
      const ua = await whiteboard.getUnread(to, swarmId);
      const ub = await whiteboard.getUnread(otherTo, swarmId);
      expect(ua.length).toBe(1);
      expect(ub.length).toBe(1);
      expect(ua[0].content).toBe('broadcast!');
    });

    it('does not deliver the message to the sender', async () => {
      const { swarmId, from } = await makeSwarmWithAgents();
      await whiteboard.postMessage({
        swarmId, fromAgentId: from, toAgentId: null, content: 'note to self',
      });
      const mine = await whiteboard.getUnread(from, swarmId);
      expect(mine.length).toBe(0);
    });

    it('does not deliver across swarms', async () => {
      const a = await makeSwarmWithAgents();
      const b = await makeSwarmWithAgents();
      await whiteboard.postMessage({
        swarmId: a.swarmId, fromAgentId: a.from, toAgentId: a.to, content: 'a',
      });
      const inB = await whiteboard.getUnread(b.to, b.swarmId);
      expect(inB.length).toBe(0);
    });

    it('preserves unicode content', async () => {
      const { swarmId, from, to } = await makeSwarmWithAgents();
      const content = '🌍 こんにちは 🚀';
      await whiteboard.postMessage({ swarmId, fromAgentId: from, toAgentId: to, content });
      const u = await whiteboard.getUnread(to, swarmId);
      expect(u[0].content).toBe(content);
    });
  });

  describe('markRead', () => {
    it('marks a single message read and removes it from unread', async () => {
      const { swarmId, from, to } = await makeSwarmWithAgents();
      const id = await whiteboard.postMessage({ swarmId, fromAgentId: from, toAgentId: to, content: 'r' });
      await whiteboard.markRead(id);
      const unread = await whiteboard.getUnread(to, swarmId);
      expect(unread.length).toBe(0);
    });
  });

  describe('markAllReadForAgent', () => {
    it('marks all messages addressed to the agent as read', async () => {
      const { swarmId, from, to } = await makeSwarmWithAgents();
      await whiteboard.postMessage({ swarmId, fromAgentId: from, toAgentId: to, content: 'd1' });
      await whiteboard.postMessage({ swarmId, fromAgentId: from, toAgentId: to, content: 'd2' });
      await whiteboard.postMessage({ swarmId, fromAgentId: from, toAgentId: null, content: 'b1' });
      const affected = await whiteboard.markAllReadForAgent(to);
      expect(affected).toBe(3);
      const unread = await whiteboard.getUnread(to, swarmId);
      expect(unread.length).toBe(0);
    });

    it('returns 0 when there is nothing to mark', async () => {
      const affected = await whiteboard.markAllReadForAgent(uuidv4());
      expect(affected).toBe(0);
    });
  });

  describe('buildWhiteboard', () => {
    it('returns an object with the expected surface', () => {
      const wb = whiteboard.buildWhiteboard('swarm-1', 'agent-1');
      expect(typeof wb.postMessage).toBe('function');
      expect(typeof wb.getMessages).toBe('function');
      expect(typeof wb.clear).toBe('function');
      expect(wb.getMessages('x')).toEqual([]);
    });
  });
});
