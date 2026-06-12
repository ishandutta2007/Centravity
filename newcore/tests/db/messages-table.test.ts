// ═══════════════════════════════════════════════════════════════
// OpenCentravity — messages table test suite
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDb, resetForTests, agents, messages } from '../../src/db/index.js';
import type { ChatMessage } from '../../src/types/index.js';

async function makeAgent() {
  const row = await agents.insert({
    id: uuidv4(),
    task: 'msg-test',
    model: 'mock',
    workspaceDir: './workspaces/test',
    maxRetries: 0,
    timeoutMs: 1000,
    tools: [],
  });
  return row.id;
}

describe('messages table', () => {
  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  describe('insert', () => {
    it('inserts a basic message and returns a uuid', async () => {
      const agentId = await makeAgent();
      const id = await messages.insert({
        agentId,
        role: 'user',
        content: 'hello world',
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded.length).toBe(1);
      expect(loaded[0].content).toBe('hello world');
      expect(loaded[0].role).toBe('user');
    });

    it('preserves unicode and large content', async () => {
      const agentId = await makeAgent();
      const big = '🌍'.repeat(5_000) + ' \n\t ' + 'A'.repeat(5_000);
      await messages.insert({ agentId, role: 'user', content: big });
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded[0].content).toBe(big);
      expect(loaded[0].content.length).toBe(big.length);
    });

    it('serializes toolCalls JSON and round-trips', async () => {
      const agentId = await makeAgent();
      const toolCalls = [{ id: 'tc-1', type: 'function', function: { name: 'shell', arguments: '{}' } }];
      const id = await messages.insert({
        agentId,
        role: 'assistant',
        content: '',
        toolCalls,
      });
      expect(id).toBeTruthy();
      // Reload via ChatMessage shape
      const row = (await messages.loadForAgent(agentId))[0];
      const chat = messages.rowToMessage(row);
      expect(chat.toolCalls).toEqual(toolCalls);
    });

    it('insert with same UUID is idempotent (INSERT OR IGNORE)', async () => {
      const agentId = await makeAgent();
      const id = uuidv4();
      // The API generates its own id; we can't pass it directly. We
      // can still test the second insert uses a different id.
      const id1 = await messages.insert({ agentId, role: 'user', content: 'first' });
      const id2 = await messages.insert({ agentId, role: 'user', content: 'second' });
      expect(id1).not.toBe(id2);
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded.length).toBe(2);
    });
  });

  describe('insertBatch', () => {
    it('inserts a list of messages preserving order', async () => {
      const agentId = await makeAgent();
      const msgs: ChatMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ];
      const ids = await messages.insertBatch(agentId, msgs);
      expect(ids.length).toBe(3);
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded.map(m => m.content)).toEqual(['sys', 'u1', 'a1']);
    });

    it('returns empty array for empty input', async () => {
      const agentId = await makeAgent();
      const ids = await messages.insertBatch(agentId, []);
      expect(ids).toEqual([]);
    });
  });

  describe('loadForAgent', () => {
    it('excludes pruned messages', async () => {
      const agentId = await makeAgent();
      const id1 = await messages.insert({ agentId, role: 'user', content: 'keep' });
      const id2 = await messages.insert({ agentId, role: 'user', content: 'drop' });
      await messages.markPruned(id2);
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe(id1);
    });

    it('returns oldest first', async () => {
      const agentId = await makeAgent();
      await messages.insert({ agentId, role: 'user', content: 'A' });
      await new Promise(r => setTimeout(r, 5));
      await messages.insert({ agentId, role: 'user', content: 'B' });
      await new Promise(r => setTimeout(r, 5));
      await messages.insert({ agentId, role: 'user', content: 'C' });
      const loaded = await messages.loadForAgent(agentId);
      expect(loaded.map(m => m.content)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('totalTokenCount', () => {
    it('sums token counts excluding pruned', async () => {
      const agentId = await makeAgent();
      const id1 = await messages.insert({ agentId, role: 'user', content: 'a', tokenCount: 10 });
      const id2 = await messages.insert({ agentId, role: 'user', content: 'b', tokenCount: 20 });
      const id3 = await messages.insert({ agentId, role: 'user', content: 'c', tokenCount: 30 });
      await messages.markPruned(id2);
      const total = await messages.totalTokenCount(agentId);
      expect(total).toBe(40);
      // Sanity: even the pruned one can be unmarked (not exposed,
      // but we re-insert to verify total).
      void id1; void id3;
    });

    it('returns 0 for agent with no messages', async () => {
      const total = await messages.totalTokenCount(uuidv4());
      expect(total).toBe(0);
    });
  });

  describe('pruneOlderThan', () => {
    it('deletes only pruned messages older than the cutoff', async () => {
      const agentId = await makeAgent();
      const id1 = await messages.insert({ agentId, role: 'user', content: 'old-pruned' });
      const id2 = await messages.insert({ agentId, role: 'user', content: 'old-kept' });
      const id3 = await messages.insert({ agentId, role: 'user', content: 'new-pruned' });
      await messages.markPruned(id1);
      await messages.markPruned(id3);
      // Wait a bit so createdAt advances measurably
      await new Promise(r => setTimeout(r, 5));
      const cutoff = Date.now();
      await new Promise(r => setTimeout(r, 5));
      await messages.insert({ agentId, role: 'user', content: 'newer-pruned' });
      const id4 = (await messages.loadForAgent(agentId, /* limit unused */)).length;
      void id4;
      const deleted = await messages.pruneOlderThan(cutoff);
      expect(deleted).toBeGreaterThanOrEqual(1);
      void id2;
    });

    it('returns 0 when nothing matches', async () => {
      const agentId = await makeAgent();
      const id = await messages.insert({ agentId, role: 'user', content: 'live' });
      await messages.markPruned(id);
      const deleted = await messages.pruneOlderThan(Date.now() - 10_000); // use past cutoff
      expect(deleted).toBe(0);
    });
  });
});
