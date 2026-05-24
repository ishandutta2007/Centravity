#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// OpenGravity — Command Line Interface
// The primary user-facing surface for the engine.
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import { loadConfig } from './config/index.js';
import { AgentOrchestrator } from './orchestrator/index.js';
import { startServer } from './server.js';

const program = new Command();

program
  .name('opengravity')
  .description('OpenGravity Engine — Universal AI Agent Orchestrator with Formal Verification')
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

    console.log('\n  ⚡ OpenGravity Engine v0.1.0');
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

    console.log(`\n  ⚡ OpenGravity Chat (model: ${model})`);
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

    console.log('\n  ⚡ OpenGravity Engine Status');
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

program.parse();
