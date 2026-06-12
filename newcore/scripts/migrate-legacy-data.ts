// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Legacy Data Migration
//
// In v0.1.0 the database file was named data/opengravity.db and
// had 3 tables (agents, messages, plans). In v0.2.0 the engine
// uses data/opencentravity.db with a v2 schema (additional
// columns on agents, plus 10 new tables).
//
// This script copies all data from the legacy file into the v2
// file, mapping old column names to new ones. It's idempotent —
// if you've already run it, running it again is a no-op.
//
// Usage:
//   npx tsx scripts/migrate-legacy-data.ts
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@libsql/client';
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

const LEGACY_DB = resolve(process.cwd(), 'data', 'opengravity.db');
const NEW_DB = resolve(process.cwd(), 'data', 'opencentravity.db');

async function main() {
  console.log('\n  ═══ Legacy Data Migration ═══\n');

  if (!existsSync(LEGACY_DB)) {
    console.log('  No legacy database found at', LEGACY_DB);
    console.log('  (This is normal on a fresh install.)\n');
    return;
  }

  if (!existsSync(NEW_DB)) {
    console.log('  No v2 database found at', NEW_DB);
    console.log('  Run `npx tsx src/db/migrate.ts apply` first.\n');
    process.exit(1);
  }

  const legacy = createClient({ url: `file:${LEGACY_DB}` });
  const fresh = createClient({ url: `file:${NEW_DB}` });

  // Check if legacy has data
  const legacyAgents = await legacy.execute({ sql: 'SELECT COUNT(*) as c FROM agents' });
  const count = legacyAgents.rows[0].c as number;
  if (count === 0) {
    console.log('  Legacy database is empty. Nothing to migrate.\n');
    return;
  }

  // Check if fresh DB already has agents (idempotency)
  const freshAgents = await fresh.execute({ sql: 'SELECT COUNT(*) as c FROM agents' });
  if ((freshAgents.rows[0].c as number) > 0) {
    console.log('  Fresh database already has', freshAgents.rows[0].c, 'agents.');
    console.log('  Skipping legacy copy (idempotent).\n');
    return;
  }

  console.log(`  Legacy database has ${count} agents. Copying...\n`);

  // 1. Copy agents, adding safe defaults for v2 columns
  await fresh.execute('BEGIN');
  try {
    const agents = await legacy.execute({ sql: 'SELECT * FROM agents' });
    let copied = 0;
    for (const row of agents.rows) {
      await fresh.execute({
        sql: `
          INSERT INTO agents (
            id, task, model, state, workspaceDir, currentStep,
            startedAt, updatedAt, parent_id, swarm_id, role,
            task_hash, state_before_pause, config_json, cost_json,
            completed_at, error, artifacts_count, tool_calls_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          row.id, row.task, row.model, row.state, row.workspaceDir,
          row.currentStep, row.startedAt, row.updatedAt,
          null,        // parent_id
          null,        // swarm_id
          'coder',     // role (v1 had no role concept; default to 'coder')
          null,        // task_hash
          null,        // state_before_pause
          JSON.stringify({ maxRetries: 2, timeoutMs: 120_000, tools: [] }),  // config_json
          null,        // cost_json
          null,        // completed_at
          null,        // error
          0,           // artifacts_count
          0,           // tool_calls_count
        ],
      });
      copied++;
    }
    console.log(`  ✓ Copied ${copied} agents`);

    // 2. Copy messages
    const messages = await legacy.execute({ sql: 'SELECT * FROM messages' });
    let mCopied = 0;
    for (const row of messages.rows) {
      await fresh.execute({
        sql: `
          INSERT INTO messages (
            id, agentId, role, content, toolCalls, toolCallId, name,
            createdAt, is_pruned, token_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          row.id, row.agentId, row.role, row.content, row.toolCalls,
          row.toolCallId, row.name, row.createdAt, 0, null,
        ],
      });
      mCopied++;
    }
    console.log(`  ✓ Copied ${mCopied} messages`);

    // 3. Copy plans
    const plans = await legacy.execute({ sql: 'SELECT * FROM plans' });
    let pCopied = 0;
    for (const row of plans.rows) {
      await fresh.execute({
        sql: 'INSERT INTO plans (agentId, planJson) VALUES (?, ?)',
        args: [row.agentId, row.planJson],
      });
      pCopied++;
    }
    console.log(`  ✓ Copied ${pCopied} plans`);

    await fresh.execute('COMMIT');
    console.log('\n  ✓ Legacy data migration complete.\n');
  } catch (err) {
    await fresh.execute('ROLLBACK').catch(() => {});
    console.error('  ✗ Migration failed:', err);
    process.exit(1);
  } finally {
    legacy.close();
    fresh.close();
  }
}

main().catch(err => {
  console.error('  ✗ Unexpected error:', err);
  process.exit(1);
});
