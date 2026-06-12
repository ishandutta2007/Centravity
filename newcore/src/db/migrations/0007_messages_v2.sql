-- ═══════════════════════════════════════════════════════════════
-- OpenCentravity — Migration 0005b: messages v2 (column adds)
--
-- Adds two columns to the existing messages table for v0.2.0:
--   - is_pruned: soft-delete flag so we can keep history but
--     mark rows as "don't include in context anymore"
--   - token_count: cached token count for context-window math
--
-- The v1 columns (toolCalls, toolCallId) are KEPT for backward
-- compat with code that hasn't been migrated yet. New code reads
-- from tool_calls and ignores these columns.
--
-- Idempotency: handled by the migration runner; duplicate-column
-- errors on re-run are caught and ignored.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE messages ADD COLUMN is_pruned  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN token_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_pruned  ON messages(agentId, is_pruned);
CREATE INDEX IF NOT EXISTS idx_messages_tokens  ON messages(agentId, token_count);
