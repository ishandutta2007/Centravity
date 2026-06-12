#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Command Line Interface
// The primary user-facing surface for the engine.
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import { loadConfig } from './config/index.js';
import { AgentOrchestrator } from './orchestrator/index.js';
import { startServer } from './server.js';
import { getDb, awaitPendingWrites } from './db/index.js';
import * as swarmsTable from './db/tables/swarms.js';
import * as agentsTable from './db/tables/agents.js';
import * as costTable from './db/tables/cost-events.js';
import { createBackup, listBackups } from './db/backup.js';
import { migrationStatus } from './db/migrate.js';

const program = new Command();

program
  .name('opencentravity')
  .description('OpenCentravity Engine — Universal AI Agent Orchestrator with Formal Verification')
  .version('0.1.0');

// ── Run Agent ──
program
  .command('run')
  .description('Spawn an AI agent to execute a task')
  .argument('<task>', 'Task description for the agent')
  .option('-m, --model <model>', 'LLM model to use (e.g., mock, gemini:gemini-2.5-flash)')
  .option('-w, --workspace <dir>', 'Workspace directory for the agent')
  .option('-r, --retries <n>', 'Max retries on failure', '2')
  .action(async (task: string, opts: Record<string, string>) => {
    const config = loadConfig();
    const engine = new AgentOrchestrator();

    console.log('\n  ⚡ OpenCentravity Engine v0.1.0');
    console.log('  ════════════════════════════════\n');

    const info = await engine.getEngineInfo();
    console.log(`  Model: ${opts.model ?? config.defaultModel}`);
    console.log(`  Providers: ${(info.availableProviders as string[]).join(', ')}`);
    console.log(`  Tools: ${(info.tools as any[]).map((t: any) => t.name).join(', ')}`);
    console.log(`  Z3 Verification: ${info.z3Enabled ? 'enabled ✓' : 'disabled'}`);
    console.log('');

    // Subscribe to events
    engine.on('event', (event: any) => {
      const ts = new Date().toISOString().slice(11, 23);
      switch (event.type) {
        case 'agent:state_changed':
          console.log(`  [${ts}] 🔄 ${event.from} → ${event.to}`);
          break;
        case 'agent:step_started':
          console.log(`  [${ts}] 🚀 Step ${event.step}: ${event.description}`);
          break;
        case 'agent:step_completed':
          const icon = event.result.success ? '✅' : '❌';
          console.log(`  [${ts}] ${icon} Step ${event.step} ${event.result.success ? 'completed' : 'failed'}`);
          if (event.result.output) {
            const preview = event.result.output.split('\n').slice(0, 5).join('\n    ');
            console.log(`    ${preview}`);
          }
          if (event.result.error) console.log(`    ⚠ ${event.result.error}`);
          break;
        case 'agent:artifact_created':
          console.log(`  [${ts}] 📦 Artifact: ${event.artifact.title} (${event.artifact.type})`);
          break;
        case 'agent:error':
          console.log(`  [${ts}] ❌ Error: ${event.error}`);
          break;
        case 'gateway:response':
          console.log(`  [${ts}] 🤖 LLM response (${event.model}, ${event.latencyMs}ms)`);
          break;
      }
    });

    console.log(`  📋 Task: "${task}"\n`);

    const status = await engine.runAgent(task, {
      model: opts.model,
      workspaceDir: opts.workspace,
      maxRetries: parseInt(opts.retries ?? '2'),
    });

    console.log('\n  ════════════════════════════════');
    console.log(`  ${status.state === 'completed' ? '✅ Task completed' : '❌ Task failed'}`);
    console.log(`  Steps: ${status.currentStep}/${status.totalSteps}`);
    console.log(`  Artifacts: ${status.artifacts.length}`);
    console.log(`  Duration: ${status.updatedAt - status.startedAt}ms`);
    console.log('  ════════════════════════════════\n');

    // Print audit summary
    const auditStats = engine.getAudit().getStats();
    console.log(`  Audit: ${auditStats.total} actions (${auditStats.success} ✅, ${auditStats.failure} ❌, ${auditStats.blocked} 🚫)\n`);

    // Await any pending background writes (e.g. audit logs, artifact indexing) before exiting
    await awaitPendingWrites();
  });

// ── Chat ──
program
  .command('chat')
  .description('Interactive chat with an LLM model')
  .option('-m, --model <model>', 'LLM model to use')
  .action(async (opts: Record<string, string>) => {
    const config = loadConfig();
    const engine = new AgentOrchestrator();
    const model = opts.model ?? config.defaultModel;

    console.log(`\n  ⚡ OpenCentravity Chat (model: ${model})`);
    console.log('  Type your message and press Enter. Ctrl+C to exit.\n');

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const history: any[] = [];

    const ask = () => {
      rl.question('  You > ', async (input: string) => {
        if (!input.trim()) { ask(); return; }

        history.push({ role: 'user', content: input });

        try {
          const response = await engine.getGateway().complete({
            model,
            messages: history,
          });
          history.push({ role: 'assistant', content: response.content });
          console.log(`\n  AI > ${response.content}\n`);
          console.log(`  [${response.model} | ${response.usage.totalTokens} tokens | ${response.latencyMs}ms]\n`);
        } catch (err) {
          console.error(`  Error: ${err instanceof Error ? err.message : err}\n`);
        }
        ask();
      });
    };
    ask();
  });

// ── Models ──
program
  .command('models')
  .description('List available LLM models and providers')
  .action(async () => {
    loadConfig();
    const engine = new AgentOrchestrator();
    const providers = await engine.getGateway().getAvailableProviders();
    const models = engine.getGateway().getAvailableModels();

    console.log('\n  ⚡ Available Providers\n');
    for (const p of providers) {
      console.log(`    ✅ ${p}`);
    }

    console.log('\n  📦 Available Models\n');
    for (const m of models) {
      const available = providers.includes(m.provider);
      const icon = available ? '✅' : '⬜';
      console.log(`    ${icon} ${m.id} (${m.provider}) — ${m.name}`);
      console.log(`       Context: ${(m.contextWindow / 1000).toFixed(0)}k | Tools: ${m.supportsTools ? 'yes' : 'no'} | Cost: $${m.costPerInputToken * 1_000_000}/M in, $${m.costPerOutputToken * 1_000_000}/M out`);
    }
    console.log('');
  });

// ── Tools ──
program
  .command('tools')
  .description('List available tools')
  .action(async () => {
    loadConfig();
    const engine = new AgentOrchestrator();
    const tools = engine.getTools().getAll();

    console.log('\n  🔧 Available Tools\n');
    for (const t of tools) {
      console.log(`    • ${t.name}`);
      console.log(`      ${t.description.split('\n')[0]}`);
    }
    console.log(`\n  Total: ${tools.length} tools\n`);
  });

// ── Info ──
program
  .command('info')
  .description('Show engine status and configuration')
  .action(async () => {
    loadConfig();
    const engine = new AgentOrchestrator();
    const info = await engine.getEngineInfo();

    console.log('\n  ⚡ OpenCentravity Engine Status');
    console.log('  ═══════════════════════════════');
    console.log(`  Version: ${info.version}`);
    console.log(`  Default Model: ${info.defaultModel}`);
    console.log(`  Providers: ${(info.availableProviders as string[]).join(', ')}`);
    console.log(`  Models: ${info.modelCount}`);
    console.log(`  Tools: ${info.toolCount}`);
    console.log(`  Z3 Verification: ${info.z3Enabled ? 'enabled ✓' : 'disabled'}`);
    console.log(`  Active Agents: ${(info.agents as any).active}/${(info.agents as any).total}`);
    console.log('  ═══════════════════════════════\n');
  });

// ── Server ──
program
  .command('serve')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'Port to listen on', '3777')
  .action(async (opts: Record<string, string>) => {
    loadConfig({ port: parseInt(opts.port) });
    await startServer();
  });

// ── Helpers ──

/** Formats a byte count as a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Formats a millisecond timestamp as a human-readable age. */
function formatAge(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/** Pads/truncates a string to a fixed width for clean tables. */
function pad(value: string | number, width: number, right = false): string {
  const s = String(value);
  if (s.length >= width) return s.slice(0, width);
  const fill = ' '.repeat(width - s.length);
  return right ? fill + s : s + fill;
}

// ── Swarms ──

const swarmsCmd = program
  .command('swarms')
  .description('List all swarms (newest first)');

swarmsCmd.action(async () => {
  loadConfig();
  const swarms = await swarmsTable.listAll(100);

  console.log('\n  ⚡ Swarms');
  console.log('  ═══════════════════════════════');
  if (swarms.length === 0) {
    console.log('  No swarms found.\n');
    return;
  }

  console.log(`  ${pad('ID', 16)} ${pad('STATUS', 12)} ${pad('ROOT_TASK', 52)} ${pad('CREATED_AT', 24)}`);
  console.log('  ' + '─'.repeat(108));
  for (const s of swarms) {
    const task = s.rootTask.length > 50 ? s.rootTask.slice(0, 47) + '...' : s.rootTask;
    const created = new Date(s.createdAt).toISOString();
    console.log(`  ${pad(s.id, 16)} ${pad(s.status, 12)} ${pad(task, 52)} ${pad(created, 24)}`);
  }
  console.log(`\n  Total: ${swarms.length} swarm(s)\n`);
});

// ── Swarms: inspect ──

swarmsCmd
  .command('inspect')
  .description('Show detailed information about a single swarm and its agents')
  .argument('<id>', 'Swarm ID to inspect')
  .action(async (id: string) => {
    loadConfig();
    const swarm = await swarmsTable.findById(id);
    if (!swarm) {
      console.error(`\n  ✗ Swarm not found: ${id}\n`);
      process.exit(1);
    }

    const agentRows = await agentsTable.findMany({ swarmId: id });
    const costSummary = await costTable.summarize({ swarmId: id });
    const totalCost = costSummary.totalCostUsd;

    console.log('\n  ⚡ Swarm Detail');
    console.log('  ═══════════════════════════════');
    console.log(`  ID:          ${swarm.id}`);
    console.log(`  Status:      ${swarm.status}`);
    console.log(`  Pattern:     ${swarm.pattern}`);
    console.log(`  Root Task:   ${swarm.rootTask}`);
    console.log(`  Root Agent:  ${swarm.rootAgentId}`);
    console.log(`  Agents:      ${agentRows.length}`);
    console.log(`  Total Cost:  $${totalCost.toFixed(6)}`);
    console.log(`  Max Cost:    $${swarm.maxCostUsd.toFixed(2)}`);
    console.log(`  Created:     ${new Date(swarm.createdAt).toISOString()}`);
    if (swarm.completedAt) {
      console.log(`  Completed:   ${new Date(swarm.completedAt).toISOString()}`);
    }
    console.log('  ═══════════════════════════════\n');

    if (agentRows.length === 0) {
      console.log('  No agents in this swarm.\n');
      return;
    }

    console.log(`  Agents (${agentRows.length}):`);
    console.log(`  ${pad('ID', 16)} ${pad('STATE', 14)} ${pad('ROLE', 12)} TASK`);
    console.log('  ' + '─'.repeat(80));
    for (const a of agentRows) {
      const task = a.task.length > 36 ? a.task.slice(0, 33) + '...' : a.task;
      console.log(`  ${pad(a.id, 16)} ${pad(a.state, 14)} ${pad(a.role, 12)} ${task}`);
    }
    console.log('');
  });

// ── Swarms: cancel ──

swarmsCmd
  .command('cancel')
  .description('Mark a swarm as cancelled (updates the status row)')
  .argument('<id>', 'Swarm ID to cancel')
  .action(async (id: string) => {
    loadConfig();
    const swarm = await swarmsTable.findById(id);
    if (!swarm) {
      console.error(`\n  ✗ Swarm not found: ${id}\n`);
      process.exit(1);
    }
    if (swarm.status === 'cancelled') {
      console.log(`\n  ⚠ Swarm ${id} is already cancelled.\n`);
      return;
    }

    await swarmsTable.updateStatus(id, 'cancelled');
    console.log(`\n  ✓ Swarm ${id} marked as cancelled.`);
    console.log(`    Previous status: ${swarm.status}`);
    console.log(`    New status:      cancelled\n`);
  });

// ── Cost ──

program
  .command('cost')
  .description('Show cost summary for an agent (tokens, $ by provider and model)')
  .argument('<agentId>', 'Agent ID to summarize')
  .action(async (agentId: string) => {
    loadConfig();
    const summary = await costTable.summarize({ agentId });

    console.log('\n  ⚡ Cost Summary');
    console.log('  ═══════════════════════════════');
    console.log(`  Agent:         ${agentId}`);
    console.log(`  Total Cost:    $${summary.totalCostUsd.toFixed(6)}`);
    console.log(`  Total Tokens:  ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()} (in: ${summary.totalInputTokens.toLocaleString()}, out: ${summary.totalOutputTokens.toLocaleString()})`);
    console.log(`  LLM Calls:     ${summary.callCount}`);
    console.log('  ═══════════════════════════════\n');

    if (summary.callCount === 0) {
      console.log('  No cost events recorded for this agent.\n');
      return;
    }

    console.log('  By Provider:');
    console.log(`  ${pad('PROVIDER', 20)} ${pad('CALLS', 8, true)} ${pad('COST', 14, true)}`);
    console.log('  ' + '─'.repeat(46));
    for (const [provider, info] of Object.entries(summary.byProvider).sort()) {
      console.log(`  ${pad(provider, 20)} ${pad(info.calls, 8, true)} ${pad('$' + info.costUsd.toFixed(6), 14, true)}`);
    }
    console.log('');

    console.log('  By Model:');
    console.log(`  ${pad('MODEL', 30)} ${pad('CALLS', 8, true)} ${pad('COST', 14, true)}`);
    console.log('  ' + '─'.repeat(56));
    for (const [model, info] of Object.entries(summary.byModel).sort()) {
      console.log(`  ${pad(model, 30)} ${pad(info.calls, 8, true)} ${pad('$' + info.costUsd.toFixed(6), 14, true)}`);
    }
    console.log('');
  });

// ── DB: status ──

program
  .command('db:status')
  .description('Show database table row counts and last migration time')
  .action(async () => {
    loadConfig();
    const db = await getDb();

    console.log('\n  ⚡ Database Status');
    console.log('  ═══════════════════════════════');
    console.log(`  ${pad('TABLE', 26)} ${pad('ROWS', 12, true)}`);
    console.log('  ' + '─'.repeat(40));

    const tablesResult = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tables = tablesResult.rows.map(r => r.name as string);

    let total = 0;
    for (const table of tables) {
      try {
        const r = await db.execute({ sql: `SELECT COUNT(*) as c FROM ${table}` });
        const count = Number((r.rows[0] as any).c);
        total += count;
        console.log(`  ${pad(table, 26)} ${pad(count, 12, true)}`);
      } catch (err) {
        console.log(`  ${pad(table, 26)} ${pad('(error)', 12, true)}`);
      }
    }
    console.log('  ' + '─'.repeat(40));
    console.log(`  ${pad('TOTAL', 26)} ${pad(total, 12, true)}`);

    // Last applied migration
    try {
      const lastResult = await db.execute(
        'SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1'
      );
      if (lastResult.rows.length > 0) {
        const last = lastResult.rows[0] as any;
        console.log('  ═══════════════════════════════');
        console.log(`  Last migration: v${String(last.version).padStart(4, '0')} ${last.name} (${new Date(last.applied_at).toISOString()})`);
      } else {
        console.log('  ═══════════════════════════════');
        console.log('  Last migration: (none applied)');
      }
    } catch (err) {
      console.log(`  Last migration: error (${err instanceof Error ? err.message : String(err)})`);
    }
    console.log('  ═══════════════════════════════\n');
  });

// ── DB: backup ──

program
  .command('db:backup')
  .description('Create a timestamped snapshot of the SQLite database')
  .action(async () => {
    loadConfig();
    try {
      const result = await createBackup('cli');
      console.log('\n  ✓ Backup created');
      console.log('  ═══════════════════════════════');
      console.log(`  Path:  ${result.path}`);
      console.log(`  Size:  ${formatBytes(result.sizeBytes)} (${result.sizeBytes.toLocaleString()} bytes)`);
      console.log('  ═══════════════════════════════\n');
    } catch (err) {
      console.error(`\n  ✗ Backup failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// ── DB: backups ──

program
  .command('db:backups')
  .description('List existing database backups (newest first)')
  .action(async () => {
    loadConfig();
    const backups = listBackups();

    console.log('\n  ⚡ Database Backups');
    console.log('  ═══════════════════════════════');
    if (backups.length === 0) {
      console.log('  No backups found.');
      console.log(`  Run: npm run cli db:backup  to create one.\n`);
      return;
    }

    console.log(`  ${pad('FILENAME', 50)} ${pad('SIZE (KB)', 12, true)} ${pad('AGE', 12, true)}`);
    console.log('  ' + '─'.repeat(78));
    for (const b of backups) {
      const filename = b.path.split(/[\\/]/).pop() ?? b.path;
      const kb = (b.sizeBytes / 1024).toFixed(1);
      const ageMs = Date.now() - b.timestamp;
      const ageMin = Math.floor(ageMs / 60_000);
      const ageHr = Math.floor(ageMin / 60);
      const age = ageHr >= 1 ? `${ageHr}h ago` : `${ageMin}m ago`;
      console.log(`  ${pad(filename, 50)} ${pad(kb, 12, true)} ${pad(age, 12, true)}`);
    }
    console.log(`\n  Total: ${backups.length} backup(s)\n`);
  });

program.parse();
