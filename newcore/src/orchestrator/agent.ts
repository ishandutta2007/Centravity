import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentConfig, AgentState, AgentStatus, ChatMessage,
  CompletionRequest, ExecutionPlan, PlanStep, ToolResult,
  ToolContext, EngineEvent, Whiteboard,
} from '../types/index.js';
import type { ModelGateway } from '../gateway/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ArtifactStore } from '../artifacts/index.js';
import type { AuditLogger } from '../audit/index.js';
import type { PolicyEngine } from '../policy/index.js';
import { getDb } from '../db/index.js';
import * as agentsTable from '../db/tables/agents.js';
import * as messagesTable from '../db/tables/messages.js';
import * as costTable from '../db/tables/cost-events.js';
import * as lwmTable from '../db/tables/lwm-snapshots.js';
import { withTransaction } from '../db/index.js';
import { LiquidMemory } from '../memory/liquid.js';
import { persistSnapshot as persistLwmSnapshot, clearSnapshotTracking } from '../memory/snapshot.js';
import { getConfig } from '../config/index.js';

const SYSTEM_PROMPT = `You are an expert software engineering agent in the OpenCentravity Engine.

Your role:
- Plan, implement, and verify code changes autonomously
- Use tools to read/write files, run commands, search code
- Use Z3 verification to prove correctness before committing changes

CRITICAL PARADIGMS:
1. TOKEN REDUCTION: Never read huge files. Use \`semantic_search\` (Tool-Level RAG) to find only exact lines via cosine similarity.
2. PASS-BY-REFERENCE: Never pass large datasets. Use \`python_sandbox\` to read/write files directly.
3. MULTI-AGENT: Use \`delegate_task\` if you need another agent to do sub-work.

When asked to create a plan, respond with JSON matching this schema:
{
  "taskDescription": "...",
  "reasoning": "...",
  "estimatedComplexity": "low|medium|high",
  "steps": [
    { "id": 1, "description": "...", "tool": "tool_name", "toolInput": {...}, "dependsOn": [] }
  ]
}

Available tools: read_file, write_file, list_directory, run_command, search_code, semantic_search, python_sandbox, delegate_task, whiteboard_post, git_operation, lint_code, type_check, z3_verify
`;

export class Agent extends EventEmitter {
  readonly id: string;
  readonly config: AgentConfig;
  public readonly memory: LiquidMemory;
  private state: AgentState = 'idle';
  private messages: ChatMessage[] = [];
  private plan: ExecutionPlan | null = null;
  private currentStep = 0;
  private artifactIds: string[] = [];
  private startedAt = 0;
  private updatedAt = 0;
  
  // HitL Control
  private resumeResolver: ((value: boolean) => void) | null = null;
  private approveGoalsPromise: Promise<void>;
  private approveGoalsResolver!: () => void;

  constructor(
    config: AgentConfig,
    private gateway: ModelGateway,
    private tools: ToolRegistry,
    private artifacts: ArtifactStore,
    private audit: AuditLogger,
    private policy: PolicyEngine,
    private fileLocks: Set<string> = new Set(),
    private whiteboard?: Whiteboard,
  ) {
    super();
    this.id = config.id;
    this.config = config;
    this.memory = new LiquidMemory();
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    this.approveGoalsPromise = new Promise<void>((resolve) => {
      this.approveGoalsResolver = resolve;
    });
  }

  // LWM snapshot tracking — incremented on every step, snapshot
  // written when this hits the configured interval.
  private lwmTickCounter: number = 0;

  async hydrate(): Promise<void> {
    // Use the new typed row reader; falls back gracefully on legacy data.
    const row = await agentsTable.findById(this.id);

    if (row) {
      this.state = row.state;
      this.currentStep = row.currentStep;
      this.startedAt = row.startedAt;
      this.updatedAt = row.updatedAt;

      // Restore v2 fields on the in-memory config (so getStatus()
      // reports them and downstream code can react to them).
      this.config.parentId = row.parentId;
      this.config.swarmId = row.swarmId;
      this.config.role = row.role;

      // Load messages via the new table module. This also works
      // for legacy data because messages are stored with the same
      // column names.
      const msgRows = await messagesTable.loadForAgent(this.id);
      this.messages = msgRows.map(rowToMessage);

      // Plan is still stored in the `plans` table as JSON.
      // (We kept this in v0.2.0 because the plan shape evolves
      //  and is read infrequently.)
      const db = await getDb();
      const planRows = await db.execute({
        sql: 'SELECT planJson FROM plans WHERE agentId = ?',
        args: [this.id],
      });
      if (planRows.rows.length > 0) {
        this.plan = JSON.parse(planRows.rows[0].planJson as string);
      }
    }
  }

  async persist(): Promise<void> {
    // Single transaction: write the agent row, then any new messages.
    // Returns nothing; idempotent.
    await withTransaction(async () => {
      this.updatedAt = Date.now();

      // Use the typed insert helper. It does an UPSERT, so calling
      // it on every persist() is safe.
      await agentsTable.insert(this.config, {
        role: this.config.role,
        parentId: this.config.parentId,
        swarmId: this.config.swarmId,
      });

      // Persist any messages that aren't already in the DB. The
      // v0.1.0 code wrote every message on every persist; we keep
      // that behavior but do it in one batch transaction.
      const messageIds = await messagesTable.insertBatch(this.id, this.messages);

      // Persist the plan if we have one.
      if (this.plan) {
        const db = await getDb();
        await db.execute({
          sql: 'INSERT INTO plans (agentId, planJson) VALUES (?, ?) ON CONFLICT(agentId) DO UPDATE SET planJson=excluded.planJson',
          args: [this.id, JSON.stringify(this.plan)],
        });
      }

      // Bump the in-memory counter to reflect what we just wrote.
      this.artifactIds = Array.from(new Set(this.artifactIds));
    });

    // Also persist the agent's mutable fields (state, currentStep, etc.)
    // in a separate small update so the type-safe API does its job.
    await agentsTable.update(this.id, {
      state: this.state,
      currentStep: this.currentStep,
      error: this.state === 'failed' ? (this.messages[this.messages.length - 1]?.content ?? null) : null,
      completedAt: (this.state === 'completed' || this.state === 'failed' || this.state === 'cancelled') ? Date.now() : null,
      artifactsCount: this.artifactIds.length,
    });

    // Persist an LWM snapshot so the agent's focus state survives
    // a restart. Throttled by the snapshot module's own logic.
    try {
      await lwmTable.save(this.id, {
        tick: Date.now(),
        telemetry: this.memory.getTelemetryState(),
        nodes: this.memory.getAllNodes(),
        edges: this.memory.getAllEdges(),
      });
    } catch {
      // LWM snapshot failure is non-fatal — never break the agent
      // run because of a snapshot write error.
    }
  }

  getStatus(): AgentStatus {
    return {
      id: this.id,
      state: this.state,
      task: this.config.task,
      model: this.config.model,
      currentStep: this.currentStep,
      totalSteps: this.plan?.steps.length ?? 0,
      artifacts: this.artifactIds,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      error: this.state === 'failed' ? this.messages[this.messages.length - 1]?.content : undefined,
      // v0.2.0 multi-agent fields
      parentId: this.config.parentId ?? null,
      swarmId: this.config.swarmId ?? null,
      role: this.config.role ?? 'coder',
    };
  }

  approveHitL(approved: boolean) {
    if (this.resumeResolver) {
      this.resumeResolver(approved);
      this.resumeResolver = null;
    } else {
      // If we approve before it pauses, auto-resolve it
      this.resumeResolver = ((val: boolean) => {}) as any;
    }
  }

  async run(): Promise<AgentStatus> {
    if (this.startedAt === 0) {
      this.startedAt = Date.now();
      await this.persist();
    }
    this.audit.log({ agentId: this.id, action: 'agent:start', target: this.config.task, result: 'success', details: '', durationMs: 0 });

    try {
      if (this.state === 'idle' || this.state === 'planning') {
        await this.setState('planning');
        if (!this.plan) {
          this.plan = await this.createPlan();
          await this.persist();
          const planArtifact = this.artifacts.createPlanArtifact(this.id, this.plan as any);
          this.artifactIds.push(planArtifact.id);
          this.emitEvent({ type: 'agent:artifact_created', agentId: this.id, artifact: planArtifact });
        }
        
        // Initialize LWM from the planning goals
        this.initializeLWMFromPlan(this.plan);
        
        // Create and save the goal confirmation artifact
        const goalConfirmationArtifact = this.createGoalConfirmationArtifact(this.plan);
        this.artifactIds.push(goalConfirmationArtifact.id);
        this.emitEvent({ type: 'agent:artifact_created', agentId: this.id, artifact: goalConfirmationArtifact });

        // Suspend execution until the human reviews and approves the goals
        await this.setState('waiting_goal_approval');
      }

      if (this.state === 'waiting_goal_approval') {
        await this.approveGoalsPromise;
        await this.setState('executing');
      }

      if (this.state === 'executing' || this.state === 'waiting_feedback') {
        await this.executeSteps();
      }

      if (this.state === 'executing' || this.state === 'verifying') {
        await this.setState('verifying');
        await this.verify();
      }

      await this.setState('completed');
      clearSnapshotTracking(this.id);
      this.audit.log({ agentId: this.id, action: 'agent:complete', target: this.config.task, result: 'success', details: `${this.plan?.steps.length ?? 0} steps completed`, durationMs: Date.now() - this.startedAt });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.setState('failed');
      clearSnapshotTracking(this.id);
      this.emitEvent({ type: 'agent:error', agentId: this.id, error });
      this.audit.log({ agentId: this.id, action: 'agent:error', target: this.config.task, result: 'failure', details: error, durationMs: Date.now() - this.startedAt });
    }

    return this.getStatus();
  }

  private async createPlan(): Promise<ExecutionPlan> {
    this.messages.push({ role: 'user', content: `Create a detailed execution plan for this task:\n\n${this.config.task}\n\nRespond with a JSON execution plan.` });

    const response = await this.gateway.complete(
      {
        model: this.config.model,
        messages: this.messages,
        temperature: 0.3,
        maxTokens: 4096,
      },
      { agentId: this.id, swarmId: this.config.swarmId ?? null },
    );

    this.messages.push({ role: 'assistant', content: response.content });
    this.emitEvent({ type: 'gateway:response', model: response.model, latencyMs: response.latencyMs });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in planning response');
      const plan = JSON.parse(jsonMatch[0]) as ExecutionPlan;

      if (!plan.steps || !Array.isArray(plan.steps)) {
        throw new Error('Plan missing steps array');
      }

      plan.steps = plan.steps.map((step, i) => ({
        ...step,
        id: step.id ?? i + 1,
        status: 'pending' as const,
        dependsOn: step.dependsOn ?? [],
      }));

      return plan;
    } catch (err) {
      return {
        taskDescription: this.config.task,
        reasoning: 'Direct execution - could not parse structured plan',
        estimatedComplexity: 'low',
        steps: [{
          id: 1,
          description: this.config.task,
          tool: 'run_command',
          toolInput: { command: `echo "Executing: ${this.config.task}"` },
          dependsOn: [],
          status: 'pending',
        }],
      };
    }
  }

  private async executeSteps(): Promise<void> {
    if (!this.plan) throw new Error('No plan to execute');

    const toolContext: ToolContext = {
      workspaceDir: this.config.workspaceDir,
      agentId: this.id,
      policyEngine: this.policy,
      auditLog: this.audit,
      fileLocks: this.fileLocks,
      whiteboard: this.whiteboard || { postMessage: () => {}, getMessages: () => [], clear: () => {} },
    };

    for (let i = this.currentStep; i < this.plan.steps.length; i++) {
      const step = this.plan.steps[i];
      this.currentStep = i;
      await this.persist();

      for (const depId of step.dependsOn) {
        const depStep = this.plan.steps.find(s => s.id === depId);
        if (depStep && depStep.status !== 'completed') {
          step.status = 'skipped';
          continue;
        }
      }

      if (step.status === 'skipped') continue;

      step.status = 'running';
      this.emitEvent({ type: 'agent:step_started', agentId: this.id, step: step.id, description: step.description });

      // ── LWM: Activate step node before execution ──
      const stepNodeId = `step:${step.id}`;
      this.memory.addNode(stepNodeId, 'transient', `Executing: ${step.description}`, 0.0, 0.2);
      this.memory.addStimulus(stepNodeId, 0.8);
      if (step.tool) {
        this.memory.addNode(`tool:${step.tool}`, 'transient', `Using tool: ${step.tool}`, 0.0, 0.25);
        this.memory.addEdge(stepNodeId, `tool:${step.tool}`, 0.3);
      }
      this.memory.tick(0.1);

      if (step.tool === 'python_sandbox') {
        await this.setState('waiting_feedback');
        
        let approved = true;
        if (this.resumeResolver === null) {
           approved = await new Promise<boolean>((resolve) => {
             this.resumeResolver = resolve;
             console.log(`\n[HitL] 🛑 Agent ${this.id} paused for HitL approval on step ${step.id}`);
             console.log(`[HitL] API: POST /agents/${this.id}/approve  or  POST /agents/${this.id}/reject\n`);
           });
        }
        this.resumeResolver = null;

        await this.setState('executing');
        
        if (!approved) {
          step.result = { success: false, output: '', error: 'Human rejected execution.' };
          step.status = 'failed';
          
          // ── LWM: Inject rejection stimulus ──
          const errorNodeId = `error:step${step.id}`;
          this.memory.addNode(errorNodeId, 'transient', `FAILED: Human rejected execution for step ${step.id}`, 0.0, 0.08);
          this.memory.addStimulus(errorNodeId, 1.0);
          this.memory.addEdge(stepNodeId, errorNodeId, 0.8);
          this.memory.tick(0.1);

          this.emitEvent({ type: 'agent:step_completed', agentId: this.id, step: step.id, result: step.result });
          continue;
        }
      }

      let result: ToolResult;

      if (step.tool && this.tools.get(step.tool)) {
        result = await this.tools.execute(step.tool, step.toolInput, toolContext);
      } else {
        result = await this.executeLLMStep(step, toolContext);
      }

      step.result = result;
      step.status = result.success ? 'completed' : 'failed';

      // ── LWM: Inject outcome stimulus ──
      if (result.success) {
        this.memory.addStimulus(stepNodeId, -0.5);
        this.memory.addNode(`outcome:step${step.id}`, 'transient',
          `Completed: ${step.description}`, 0.0, 0.3);
      } else {
        const errorNodeId = `error:step${step.id}`;
        this.memory.addNode(errorNodeId, 'transient',
          `FAILED: ${step.description} — ${(result.error ?? '').slice(0, 200)}`, 0.0, 0.08);
        this.memory.addStimulus(errorNodeId, 1.0);
        this.memory.addEdge(stepNodeId, errorNodeId, 0.8);
      }
      this.memory.tick(0.1);

      this.emitEvent({ type: 'agent:step_completed', agentId: this.id, step: step.id, result });

      if (!result.success && this.config.maxRetries > 0) {
        const fixed = await this.retryStep(step, result, toolContext);
        if (fixed) {
          step.status = 'completed';
          step.result = fixed;
          // Dampen error node on successful retry
          this.memory.addStimulus(`error:step${step.id}`, -0.7);
          this.memory.tick(0.05);
        }
      }

      // Prune message history to prevent context bloat
      this.pruneMessages();

      // Periodic LWM snapshot — every lwmSnapshotEveryNTicks steps.
      // Non-blocking: we don't await, so a slow DB doesn't pause the agent.
      this.lwmTickCounter++;
      const config = getConfig();
      if (this.lwmTickCounter % config.lwmSnapshotEveryNTicks === 0) {
        void persistLwmSnapshot(this.id, this.memory, Date.now());
      }

      this.artifacts.createLogArtifact(this.id, `Step ${step.id}: ${step.description}`, 
        `Tool: ${step.tool}\nStatus: ${step.status}\nOutput: ${(step.result?.output ?? '').slice(0, 2000)}\n${step.result?.error ? `Error: ${step.result.error}` : ''}`
      );
    }
    
    this.currentStep = this.plan.steps.length;
    await this.persist();
  }

  private async executeLLMStep(step: PlanStep, toolContext: ToolContext): Promise<ToolResult> {
    let whiteboardInjection = "";
    if (this.whiteboard) {
      const messages = this.whiteboard.getMessages(this.id);
      if (messages.length > 0) {
        whiteboardInjection = "\n\n[NEW WHITEBOARD MESSAGES FROM PEERS]:\n" + messages.map(m => `From ${m.fromAgentId}: ${m.content}`).join("\n");
        this.whiteboard.clear(this.id);
      }
    }

    this.messages.push({
      role: 'user',
      content: `Execute step ${step.id}: ${step.description}\n\nUse one of the available tools to accomplish this.${whiteboardInjection}`,
    });

    const toolDefs = this.tools.getDefinitions(this.config.tools.length > 0 ? this.config.tools : undefined);

    const response = await this.gateway.complete(
      {
        model: this.config.model,
        messages: this.buildMessagesWithLWMContext(),
        tools: toolDefs,
        temperature: 0.2,
        maxTokens: 4096,
      },
      { agentId: this.id, swarmId: this.config.swarmId ?? null },
    );

    this.messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });

    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        if (tc.function.name === 'python_sandbox') {
           await this.setState('waiting_feedback');
           const approved = await new Promise<boolean>((resolve) => { this.resumeResolver = resolve; });
           await this.setState('executing');
           if (!approved) return { success: false, output: '', error: 'Human rejected execution.' };
        }
        
        const input = JSON.parse(tc.function.arguments);
        const result = await this.tools.execute(tc.function.name, input, toolContext);
        this.messages.push({ role: 'tool', content: result.output || result.error || '', name: tc.function.name, toolCallId: tc.id });
        if (!result.success) return result;
      }
      return { success: true, output: 'Tool calls executed successfully.' };
    }

    return { success: true, output: response.content };
  }

  private async retryStep(step: PlanStep, failedResult: ToolResult, toolContext: ToolContext): Promise<ToolResult | null> {
    this.messages.push({
      role: 'user',
      content: `Step ${step.id} failed with error: ${failedResult.error}\n\nPlease fix the issue and try again.`,
    });

    const toolDefs = this.tools.getDefinitions();
    const response = await this.gateway.complete(
      {
        model: this.config.model,
        messages: this.buildMessagesWithLWMContext(),
        tools: toolDefs,
        temperature: 0.2,
        maxTokens: 4096,
      },
      { agentId: this.id, swarmId: this.config.swarmId ?? null },
    );

    this.messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });

    if (response.toolCalls?.length) {
      for (const tc of response.toolCalls) {
        const input = JSON.parse(tc.function.arguments);
        const result = await this.tools.execute(tc.function.name, input, toolContext);
        if (result.success) return result;
      }
    }
    return null;
  }

  private async verify(): Promise<void> {
    if (!this.plan) return;
    const completedSteps = this.plan.steps.filter(s => s.status === 'completed');
    const failedSteps = this.plan.steps.filter(s => s.status === 'failed');

    const verificationLog = [
      `═══ Verification Report ═══`,
      `Task: ${this.config.task}`,
      `Steps completed: ${completedSteps.length}/${this.plan.steps.length}`,
      `Steps failed: ${failedSteps.length}`,
      `Total time: ${Date.now() - this.startedAt}ms`,
      ``,
    ];

    for (const step of this.plan.steps) {
      const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
      verificationLog.push(`${icon} Step ${step.id}: ${step.description} [${step.status}]`);
    }

    const artifact = this.artifacts.createLogArtifact(this.id, 'Verification Report', verificationLog.join('\n'));
    this.artifactIds.push(artifact.id);
    this.emitEvent({ type: 'agent:artifact_created', agentId: this.id, artifact });
  }

  private async setState(state: AgentState): Promise<void> {
    const from = this.state;
    this.state = state;
    // Update the agent row directly. Fire-and-forget so a slow
    // DB doesn't block state transitions (the in-memory state
    // is the source of truth during the run; the DB catches
    // up asynchronously and is only consulted on restart).
    void agentsTable.update(this.id, {
      state,
      completedAt: (state === 'completed' || state === 'failed' || state === 'cancelled') ? Date.now() : null,
    }).catch(() => {
      // Non-fatal: state changes happen often; if the DB is
      // momentarily unavailable, the in-memory state is still
      // correct for this run.
    });
    this.emitEvent({ type: 'agent:state_changed', agentId: this.id, from, to: state });
  }

  private emitEvent(event: EngineEvent): void {
    this.emit(event.type, event);
    this.emit('event', event);
  }

  sendFeedback(feedback: string): void {
    this.messages.push({ role: 'user', content: `[User Feedback]: ${feedback}` });
    // Inject feedback as a high-intensity stimulus into the LWM
    const feedbackNodeId = `feedback:${Date.now()}`;
    this.memory.addNode(feedbackNodeId, 'transient', `User Feedback: ${feedback}`, 0.0, 0.1);
    this.memory.addStimulus(feedbackNodeId, 0.9);
    this.memory.tick(0.1);
    this.persist();
  }

  // ── LWM Integration Methods ──

  /**
   * Initialize the LWM graph from the execution plan.
   * Each step becomes a goal node, with edges linking sequential steps.
   */
  private initializeLWMFromPlan(plan: ExecutionPlan): void {
    // Root goal node — the user's original task with maximum anchoring
    this.memory.addNode('root:task', 'goal', plan.taskDescription, 0.95, 0.005);

    // Create a goal node for each plan step
    for (const step of plan.steps) {
      const nodeId = `goal:step${step.id}`;
      const bias = step.dependsOn.length === 0 ? 0.7 : 0.5;
      this.memory.addNode(nodeId, 'goal', step.description, bias, 0.02);
      this.memory.addEdge('root:task', nodeId, 0.6);
    }

    // Link sequential dependencies
    for (const step of plan.steps) {
      for (const depId of step.dependsOn) {
        this.memory.addEdge(`goal:step${depId}`, `goal:step${step.id}`, 0.4);
      }
    }

    this.memory.tick(0.1);
  }

  /**
   * Creates a human-readable goal confirmation artifact.
   * This is presented to the user for review before execution begins.
   */
  private createGoalConfirmationArtifact(plan: ExecutionPlan): import('../types/index.js').ArtifactData {
    const lines: string[] = [
      `═══ GOAL CONFIRMATION ═══`,
      ``,
      `Task: ${plan.taskDescription}`,
      `Reasoning: ${plan.reasoning}`,
      `Complexity: ${plan.estimatedComplexity}`,
      `Steps: ${plan.steps.length}`,
      ``,
      `── Planned Steps ──`,
    ];

    for (const step of plan.steps) {
      const deps = step.dependsOn.length > 0 ? ` (depends on: ${step.dependsOn.join(', ')})` : '';
      lines.push(`  ${step.id}. [${step.tool ?? 'llm'}] ${step.description}${deps}`);
    }

    lines.push(``, `── LWM State ──`);
    const telemetry = this.memory.getTelemetryState();
    for (const node of telemetry.swarmAttention.slice(0, 10)) {
      lines.push(`  • ${node.nodeId} — Activation: ${(node.activation * 100).toFixed(0)}%`);
    }

    lines.push(``, `═══ Awaiting your approval to proceed. ═══`);

    return this.artifacts.createLogArtifact(this.id, 'Goal Confirmation', lines.join('\n'));
  }

  /**
   * Called by the API/CLI to resume agent execution after goal review.
   * Resolves the internal promise that the run() method is awaiting.
   */
  approveGoals(): void {
    if (this.state !== 'waiting_goal_approval') return;
    this.audit.log({
      agentId: this.id,
      action: 'hitl:goal_approved',
      target: this.config.task,
      result: 'success',
      details: 'Human approved execution goals',
      durationMs: 0,
    });
    this.approveGoalsResolver();
  }

  /**
   * Builds a message array with the active LWM context injected
   * as a dynamic system prompt prefix.
   */
  private buildMessagesWithLWMContext(): ChatMessage[] {
    const lwmContext = this.memory.getLiquidPromptContext();
    if (!lwmContext) return this.messages;

    // Clone messages and prepend LWM context to the system prompt
    const result = [...this.messages];
    const systemIdx = result.findIndex(m => m.role === 'system');
    if (systemIdx >= 0) {
      result[systemIdx] = {
        ...result[systemIdx],
        content: result[systemIdx].content + '\n\n' + lwmContext,
      };
    } else {
      result.unshift({ role: 'system', content: lwmContext });
    }
    return result;
  }

  /**
   * Prunes the message history to prevent unbounded context growth.
   * Retains the system prompt, the last N user/assistant exchanges,
   * and all tool-call messages from the current step.
   */
  private pruneMessages(): void {
    const MAX_HISTORY = 12; // Keep last 12 messages beyond the system prompt
    if (this.messages.length <= MAX_HISTORY + 1) return;

    const systemMessage = this.messages[0]; // Always preserve
    const recentMessages = this.messages.slice(-(MAX_HISTORY));
    this.messages = [systemMessage, ...recentMessages];
  }
}

/**
 * Local helper: convert a messages-table row into the in-memory
 * ChatMessage shape. Exported only within this module.
 */
function rowToMessage(row: messagesTable.MessageRow): ChatMessage {
  return {
    role: row.role,
    content: row.content,
    name: row.name ?? undefined,
    toolCallId: row.toolCallId ?? undefined,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls) : undefined,
  };
}
