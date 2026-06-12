// ═══════════════════════════════════════════════════════════════
// OpenCentravity — tool_calls table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, messages, toolCalls } from '../../src/db/index.js';

async function makeAgentAndMsg() {
  const agentId = (await agents.insert({
    id: uuidv4(),
    task: 'tc-test',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  })).id;
  const msgId = await messages.insert({ agentId, role: 'assistant', content: '' });
  return { agentId, msgId };
}

describe('tool_calls table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('record', () => {
    it('records a call with all fields and round-trips', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      const id = await toolCalls.record({
        messageId: msgId,
        toolCallId: 'tc-1',
        toolName: 'shell',
        arguments: { cmd: 'ls' },
        result: { stdout: 'file.txt' },
        success: true,
        durationMs: 42,
      });
      expect(id).toBeTruthy();
      const all = await toolCalls.loadForAgent(agentId);
      expect(all.length).toBe(1);
      const row = all[0];
      expect(row.toolName).toBe('shell');
      expect(row.success).toBe(1);
      expect(row.durationMs).toBe(42);
      expect(JSON.parse(row.argumentsJson)).toEqual({ cmd: 'ls' });
      expect(JSON.parse(row.resultJson!)).toEqual({ stdout: 'file.txt' });
    });

    it('handles missing optional fields (null defaults)', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      const id = await toolCalls.record({
        messageId: msgId,
        toolName: 'noop',
        arguments: {},
      });
      const all = await toolCalls.loadForAgent(agentId);
      const agent1 = all[0];
      expect(agent1.toolName).toBe('noop');
      expect(agent1.success).toBeNull();
      expect(agent1.resultJson).toBeNull();
      expect(agent1.durationMs).toBeNull();
      void id;
    });

    it('success=false stores 0 (not null)', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      await toolCalls.record({
        messageId: msgId,
        toolName: 'shell',
        arguments: {},
        success: false,
      });
      const stats = await toolCalls.aggregateStats({ agentId });
      expect(stats.find(s => s.toolName === 'shell')?.failures).toBeGreaterThanOrEqual(1);
    });
  });

  describe('loadForAgent', () => {
    it('returns newest first and respects limit', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      for (let i = 0; i < 5; i++) {
        await toolCalls.record({
          messageId: msgId,
          toolName: `t${i}`,
          arguments: { i },
        });
        await new Promise(r => setTimeout(r, 2));
      }
      const all = await toolCalls.loadForAgent(agentId, 3);
      expect(all.length).toBe(3);
      // Newest first
      expect(all[0].toolName).toBe('t4');
      expect(all[2].toolName).toBe('t2');
    });

    it('returns empty array for agent with no calls', async () => {
      const all = await toolCalls.loadForAgent(uuidv4());
      expect(all).toEqual([]);
    });
  });

  describe('aggregateStats', () => {
    it('groups by tool name, counts calls / success / failure / totalMs', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      await toolCalls.record({ messageId: msgId, toolName: 'shell', arguments: {}, success: true, durationMs: 100 });
      await toolCalls.record({ messageId: msgId, toolName: 'shell', arguments: {}, success: true, durationMs: 50 });
      await toolCalls.record({ messageId: msgId, toolName: 'shell', arguments: {}, success: false, durationMs: 200 });
      await toolCalls.record({ messageId: msgId, toolName: 'file_write', arguments: {}, success: true, durationMs: 30 });

      const stats = await toolCalls.aggregateStats({ agentId });
      const shell = stats.find(s => s.toolName === 'shell')!;
      expect(shell.calls).toBe(3);
      expect(shell.successes).toBe(2);
      expect(shell.failures).toBe(1);
      expect(shell.totalMs).toBe(350);

      const fw = stats.find(s => s.toolName === 'file_write')!;
      expect(fw.calls).toBe(1);
      expect(fw.successes).toBe(1);
      expect(fw.totalMs).toBe(30);
    });

    it('filters by sinceMs', async () => {
      const { agentId, msgId } = await makeAgentAndMsg();
      await toolCalls.record({ messageId: msgId, toolName: 'a', arguments: {} });
      const cutoff = Date.now();
      await new Promise(r => setTimeout(r, 5));
      await toolCalls.record({ messageId: msgId, toolName: 'b', arguments: {} });
      const stats = await toolCalls.aggregateStats({ agentId, sinceMs: cutoff + 1 });
      // Only "b" should be counted
      expect(stats.length).toBe(1);
      expect(stats[0].toolName).toBe('b');
    });
  });
});
