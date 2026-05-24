// ═══════════════════════════════════════════════════════════════
// OpenGravity — Agent Orchestrator
// Central coordinator: creates, manages, and monitors agents.
// ═══════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { AgentConfig, AgentStatus, EngineEvent } from '../types/index.js';
import { ModelGateway } from '../gateway/index.js';
import { ToolRegistry } from '../tools/index.js';
import { ArtifactStore } from '../artifacts/index.js';
import { AuditLogger } from '../audit/index.js';
import { PolicyEngine } from '../policy/index.js';
import { Agent } from './agent.js';
import { getConfig } from '../config/index.js';

let agentCounter = 0;

export class AgentOrchestrator extends EventEmitter {
  private agents = new Map<string, Agent>();
  private gateway: ModelGateway;
  private tools: ToolRegistry;
  private artifacts: ArtifactStore;
  private audit: AuditLogger;
  private policy: PolicyEngine;

  constructor() {
    super();
    this.gateway = new ModelGateway();
    this.tools = new ToolRegistry();
    this.artifacts = new ArtifactStore();
    this.audit = new AuditLogger();
    this.policy = new PolicyEngine();
  }

  // ── Agent Lifecycle ──

  createAgent(task: string, options?: Partial<AgentConfig>): Agent {
    const config = getConfig();
    const id = options?.id ?? `agent-${++agentCounter}-${Date.now().toString(36)}`;

    // Ensure workspace directory exists
    const workspaceDir = options?.workspaceDir ?? resolve(config.workspaceRoot, id);
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });

    const agentConfig: AgentConfig = {
      id,
      task,
      model: options?.model ?? config.defaultModel,
      workspaceDir,
      maxRetries: options?.maxRetries ?? 2,
      timeoutMs: options?.timeoutMs ?? 120_000,
      tools: options?.tools ?? [],
      policyOverrides: options?.policyOverrides,
    };

    const agent = new Agent(
      agentConfig, this.gateway, this.tools,
      this.artifacts, this.audit, this.policy,
    );

    // Forward agent events
    agent.on('event', (event: EngineEvent) => {
      this.emit('event', event);
    });

    this.agents.set(id, agent);
    this.emit('event', { type: 'agent:created', agentId: id, task } satisfies EngineEvent);
    this.audit.log({ agentId: id, action: 'orchestrator:create_agent', target: task, result: 'success', details: `model=${agentConfig.model}`, durationMs: 0 });

    return agent;
  }

  async runAgent(task: string, options?: Partial<AgentConfig>): Promise<AgentStatus> {
    const agent = this.createAgent(task, options);
    return agent.run();
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentStatus[] {
    return Array.from(this.agents.values()).map(a => a.getStatus());
  }

  // ── Direct Gateway Access ──

  getGateway(): ModelGateway {
    return this.gateway;
  }

  getTools(): ToolRegistry {
    return this.tools;
  }

  getArtifacts(): ArtifactStore {
    return this.artifacts;
  }

  getAudit(): AuditLogger {
    return this.audit;
  }

  // ── Info ──

  async getEngineInfo(): Promise<Record<string, unknown>> {
    const config = getConfig();
    const availableProviders = await this.gateway.getAvailableProviders();
    const models = this.gateway.getAvailableModels();
    const tools = this.tools.getAll().map(t => ({ name: t.name, description: t.description }));
    const auditStats = this.audit.getStats();

    return {
      name: 'OpenGravity Engine',
      version: '0.1.0',
      defaultModel: config.defaultModel,
      availableProviders,
      modelCount: models.length,
      models: models.map(m => ({ id: m.id, provider: m.provider, name: m.name })),
      tools,
      toolCount: tools.length,
      agents: {
        total: this.agents.size,
        active: Array.from(this.agents.values()).filter(a => ['planning', 'executing', 'verifying'].includes(a.getStatus().state)).length,
      },
      auditStats,
      z3Enabled: config.z3Enabled,
    };
  }
}
