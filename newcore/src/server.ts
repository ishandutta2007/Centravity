// ═══════════════════════════════════════════════════════════════
// OpenGravity — REST + WebSocket API Server
// Exposes the engine over HTTP for any frontend to consume.
// ═══════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import { loadConfig } from './config/index.js';
import { AgentOrchestrator } from './orchestrator/index.js';
import type { EngineEvent } from './types/index.js';

export async function startServer(orchestrator?: AgentOrchestrator) {
  const config = loadConfig();
  const engine = orchestrator ?? new AgentOrchestrator();

  const app = Fastify({ logger: { level: config.logLevel } });

  // ── Health ──
  app.get('/health', async () => ({ status: 'ok', engine: 'OpenGravity', version: '0.1.0' }));

  // ── Engine Info ──
  app.get('/info', async () => engine.getEngineInfo());

  // ── Models ──
  app.get('/models', async () => {
    const models = engine.getGateway().getAvailableModels();
    const providers = await engine.getGateway().getAvailableProviders();
    return { providers, models };
  });

  // ── Tools ──
  app.get('/tools', async () => {
    const tools = engine.getTools().getAll();
    return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  });

  // ── Chat (Direct LLM access) ──
  app.post<{ Body: { model?: string; message: string; history?: unknown[] } }>('/chat', async (req) => {
    const { model, message, history } = req.body;
    const messages = [
      ...(history as any[] ?? []),
      { role: 'user' as const, content: message },
    ];
    const response = await engine.getGateway().complete({
      model: model ?? config.defaultModel,
      messages,
    });
    return response;
  });

  // ── Agents ──
  app.post<{ Body: { task: string; model?: string; workspaceDir?: string } }>('/agents', async (req) => {
    const { task, model, workspaceDir } = req.body;
    const agent = engine.createAgent(task, { model, workspaceDir });
    // Run async (don't block the response)
    agent.run().catch(err => console.error('Agent error:', err));
    return { id: agent.id, status: agent.getStatus() };
  });

  app.get('/agents', async () => engine.listAgents());

  app.get<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return agent.getStatus();
  });

  app.post<{ Params: { id: string }; Body: { feedback: string } }>('/agents/:id/feedback', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    agent.sendFeedback(req.body.feedback);
    return { ok: true };
  });

  // HitL Endpoints
  app.post<{ Params: { id: string } }>('/agents/:id/approve', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.getStatus().state !== 'waiting_feedback') {
      return reply.code(400).send({ error: 'Agent is not waiting for feedback' });
    }
    agent.approveHitL(true);
    return { success: true, message: 'Agent execution resumed.' };
  });

  app.post<{ Params: { id: string } }>('/agents/:id/reject', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.getStatus().state !== 'waiting_feedback') {
      return reply.code(400).send({ error: 'Agent is not waiting for feedback' });
    }
    agent.approveHitL(false);
    return { success: true, message: 'Agent execution rejected.' };
  });

  // ── Artifacts ──
  app.get<{ Params: { agentId: string } }>('/artifacts/:agentId', async (req) => {
    return engine.getArtifacts().listByAgent(req.params.agentId);
  });

  // ── Audit ──
  app.get('/audit', async (req) => {
    const query = req.query as Record<string, string>;
    return engine.getAudit().query({
      agentId: query.agentId,
      action: query.action,
      limit: query.limit ? parseInt(query.limit) : 100,
    });
  });

  // ── Start ──
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n  ⚡ OpenGravity Engine API running at http://${config.host}:${config.port}\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  return app;
}
