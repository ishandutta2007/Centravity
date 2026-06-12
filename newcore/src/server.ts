// ═══════════════════════════════════════════════════════════════
// OpenCentravity — REST + WebSocket API Server
// Exposes the engine over HTTP for any frontend to consume.
// ═══════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import { loadConfig } from './config/index.js';
import { AgentOrchestrator } from './orchestrator/index.js';
import type { EngineEvent } from './types/index.js';
import * as swarmsTable from './db/tables/swarms.js';
import * as agentsTable from './db/tables/agents.js';
import * as costTable from './db/tables/cost-events.js';
import * as lwmTable from './db/tables/lwm-snapshots.js';
import * as whiteboardTable from './db/tables/whiteboard.js';
import * as locksTable from './db/tables/locks.js';
import * as artifactsTable from './db/tables/artifacts.js';

export async function startServer(orchestrator?: AgentOrchestrator) {
  const config = loadConfig();
  const engine = orchestrator ?? new AgentOrchestrator();

  const app = Fastify({ logger: { level: config.logLevel } });

  // ── Health ──
  app.get('/health', async () => ({ status: 'ok', engine: 'OpenCentravity', version: '0.1.0' }));

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

  // ── Liquid Working Memory (LWM) ──

  /** Returns the real-time cognitive telemetry of an agent's LWM. */
  app.get<{ Params: { id: string } }>('/agents/:id/memory/telemetry', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return {
      telemetry: agent.memory.getTelemetryState(),
      nodes: agent.memory.getAllNodes(),
      edges: agent.memory.getAllEdges(),
    };
  });

  /** Approves the agent's goals and resumes execution. */
  app.post<{ Params: { id: string } }>('/agents/:id/memory/approve', async (req, reply) => {
    const agent = engine.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    agent.approveGoals();
    return { ok: true, status: agent.getStatus() };
  });

  /** Injects a manual human stimulus into a specific LWM node. */
  app.post<{ Params: { id: string }; Body: { nodeId: string; intensity: number; content?: string } }>(
    '/agents/:id/memory/stimulus',
    async (req, reply) => {
      const agent = engine.getAgent(req.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const { nodeId, intensity, content } = req.body;
      if (content) {
        agent.memory.addNode(nodeId, 'transient', content, 0.0, 0.15);
      }
      agent.memory.addStimulus(nodeId, intensity);
      agent.memory.tick(0.1);

      return {
        ok: true,
        telemetry: agent.memory.getTelemetryState(),
      };
    }
  );

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

  // ═══════════════════════════════════════════════════════════════
  // v0.2.0 PHASE 4 ROUTES (additive — no existing route changed)
  // ═══════════════════════════════════════════════════════════════

  // ── Swarms ──
  app.get('/swarms', async () => ({ swarms: await swarmsTable.listAll(100) }));

  app.get<{ Params: { id: string } }>('/swarms/:id', async (req, reply) => {
    const swarm = await swarmsTable.findById(req.params.id);
    if (!swarm) return reply.code(404).send({ error: 'Swarm not found' });
    const agents = await agentsTable.findMany({ swarmId: swarm.id });
    return { swarm, agentCount: agents.length };
  });

  app.get<{ Params: { id: string } }>('/swarms/:id/cost', async (req) => {
    return costTable.summarize({ swarmId: req.params.id });
  });

  app.get<{ Params: { id: string } }>('/swarms/:id/agents', async (req) => {
    const agents = await agentsTable.findMany({ swarmId: req.params.id });
    return { agents: agents.map(agentsTable.rowToStatus) };
  });

  // ── Agents (extended) ──
  app.get<{ Params: { id: string } }>('/agents/:id/cost', async (req) => {
    return costTable.summarize({ agentId: req.params.id });
  });

  app.get<{ Params: { id: string } }>('/agents/:id/children', async (req, reply) => {
    const parent = await agentsTable.findById(req.params.id);
    if (!parent) return reply.code(404).send({ error: 'Agent not found' });
    const tree = await agentsTable.getDescendantTree(req.params.id);
    return { children: tree };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/agents/:id/memory/snapshots', async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const snapshots = await lwmTable.loadForAgent(req.params.id, limit);
    return { snapshots };
  });

  app.get<{ Params: { id: string } }>('/agents/:id/messages', async (req) => {
    const messages = await whiteboardTable.getUnread(req.params.id);
    return { messages };
  });

  // ── File locks ──
  app.get<{ Querystring: { workspace_dir?: string } }>('/workspaces/locks', async (req, reply) => {
    const dir = req.query.workspace_dir;
    if (!dir) return reply.code(400).send({ error: 'Missing ?workspace_dir= query param' });
    const locks = await locksTable.listForWorkspace(dir);
    return { locks };
  });

  // ── Artifact search (FTS5) ──
  app.get<{ Querystring: { q?: string; limit?: string } }>('/artifacts/search', async (req, reply) => {
    const q = req.query.q;
    if (!q) return reply.code(400).send({ error: 'Missing ?q= query param' });
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const results = await artifactsTable.search(q, limit);
    return { results };
  });

  // ── Audit stats (DB-backed) ──
  app.get('/audit/stats', async () => {
    return engine.getAudit().statsDb();
  });

  // ── Server-Sent Events stream (Phase 4 stub) ──
  // Subscribers receive every engine event. Closes when the
  // client disconnects. Sends a 15s heartbeat to keep proxies
  // from killing idle connections.
  app.get('/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.writeHead(200);
    reply.raw.write(': connected\n\n');

    const onEvent = (event: EngineEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    engine.on('event', onEvent);

    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); }
      catch { /* connection closed */ }
    }, 15_000);

    const cleanup = () => {
      engine.off('event', onEvent);
      clearInterval(heartbeat);
    };
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
  });

  // ── Start ──
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n  ⚡ OpenCentravity Engine API running at http://${config.host}:${config.port}\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  return app;
}
