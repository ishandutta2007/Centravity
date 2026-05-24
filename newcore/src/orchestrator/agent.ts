import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentConfig, AgentState, AgentStatus, ChatMessage,
  CompletionRequest, ExecutionPlan, PlanStep, ToolResult,
  ToolContext, EngineEvent,
} from '../types/index.js';
import type { ModelGateway } from '../gateway/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ArtifactStore } from '../artifacts/index.js';
import type { AuditLogger } from '../audit/index.js';
import type { PolicyEngine } from '../policy/index.js';
import { getDb } from '../db/index.js';

const SYSTEM_PROMPT = `You are an expert software engineering agent in the OpenGravity Engine.

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

Available tools: read_file, write_file, list_directory, run_command, search_code, semantic_search, python_sandbox, delegate_task, git_operation, lint_code, type_check, z3_verify
`;

export class Agent extends EventEmitter {
  readonly id: string;
  readonly config: AgentConfig;
  private state: AgentState = 'idle';
  private messages: ChatMessage[] = [];
  private plan: ExecutionPlan | null = null;
  private currentStep = 0;
  private artifactIds: string[] = [];
  private startedAt = 0;
  private updatedAt = 0;
  
  // HitL Control
  private resumeResolver: ((value: boolean) => void) | null = null;

  constructor(
    config: AgentConfig,
    private gateway: ModelGateway,
    private tools: ToolRegistry,
    private artifacts: ArtifactStore,
    private audit: AuditLogger,
    private policy: PolicyEngine,
  ) {
    super();
    this.id = config.id;
    this.config = config;
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  }

  async hydrate(): Promise<void> {
    const db = await getDb();
    
    const agentRows = await db.execute({
      sql: 'SELECT * FROM agents WHERE id = ?',
      args: [this.id]
    });
    
    if (agentRows.rows.length > 0) {
      const row = agentRows.rows[0];
      this.state = row.state as AgentState;
      this.currentStep = row.currentStep as number;
      this.startedAt = row.startedAt as number;
      this.updatedAt = row.updatedAt as number;
      
      const msgRows = await db.execute({
        sql: 'SELECT * FROM messages WHERE agentId = ? ORDER BY createdAt ASC',
        args: [this.id]
      });
      
      this.messages = msgRows.rows.map(r => ({
        role: r.role as any,
        content: r.content as string,
        name: r.name as string | undefined,
        toolCallId: r.toolCallId as string | undefined,
        toolCalls: r.toolCalls ? JSON.parse(r.toolCalls as string) : undefined
      }));
      
      const planRows = await db.execute({
        sql: 'SELECT planJson FROM plans WHERE agentId = ?',
        args: [this.id]
      });
      
      if (planRows.rows.length > 0) {
        this.plan = JSON.parse(planRows.rows[0].planJson as string);
      }
    }
  }

  async persist(): Promise<void> {
    const db = await getDb();
    this.updatedAt = Date.now();
    
    await db.execute({
      sql: `INSERT INTO agents (id, task, model, state, workspaceDir, currentStep, startedAt, updatedAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET state=excluded.state, currentStep=excluded.currentStep, updatedAt=excluded.updatedAt`,
      args: [this.id, this.config.task, this.config.model, this.state, this.config.workspaceDir, this.currentStep, this.startedAt, this.updatedAt]
    });
    
    for (const msg of this.messages) {
      const msgId = uuidv4();
      await db.execute({
        sql: `INSERT OR IGNORE INTO messages (id, agentId, role, content, toolCalls, toolCallId, name, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [msgId, this.id, msg.role, msg.content, msg.toolCalls ? JSON.stringify(msg.toolCalls) : null, msg.toolCallId || null, msg.name || null, Date.now()]
      });
    }
    
    if (this.plan) {
      await db.execute({
        sql: `INSERT INTO plans (agentId, planJson) VALUES (?, ?) ON CONFLICT(agentId) DO UPDATE SET planJson=excluded.planJson`,
        args: [this.id, JSON.stringify(this.plan)]
      });
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
    };
  }

  approveHitL(approved: boolean) {
    if (this.resumeResolver) {
      this.resumeResolver(approved);
      this.resumeResolver = null;
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
      }

      if (this.state === 'planning' || this.state === 'executing' || this.state === 'waiting_feedback') {
        await this.setState('executing');
        await this.executeSteps();
      }

      if (this.state === 'executing' || this.state === 'verifying') {
        await this.setState('verifying');
        await this.verify();
      }

      await this.setState('completed');
      this.audit.log({ agentId: this.id, action: 'agent:complete', target: this.config.task, result: 'success', details: `${this.plan?.steps.length ?? 0} steps completed`, durationMs: Date.now() - this.startedAt });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.setState('failed');
      this.emitEvent({ type: 'agent:error', agentId: this.id, error });
      this.audit.log({ agentId: this.id, action: 'agent:error', target: this.config.task, result: 'failure', details: error, durationMs: Date.now() - this.startedAt });
    }

    return this.getStatus();
  }

  private async createPlan(): Promise<ExecutionPlan> {
    this.messages.push({ role: 'user', content: `Create a detailed execution plan for this task:\n\n${this.config.task}\n\nRespond with a JSON execution plan.` });

    const response = await this.gateway.complete({
      model: this.config.model,
      messages: this.messages,
      temperature: 0.3, 
      maxTokens: 4096,
    });

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

      if (step.tool === 'python_sandbox') {
        await this.setState('waiting_feedback');
        
        const approved = await new Promise<boolean>((resolve) => {
          this.resumeResolver = resolve;
          console.log(`\n[HitL] 🛑 Agent ${this.id} paused for HitL approval on step ${step.id}`);
          console.log(`[HitL] API: POST /agents/${this.id}/approve  or  POST /agents/${this.id}/reject\n`);
        });

        await this.setState('executing');
        
        if (!approved) {
          step.result = { success: false, output: '', error: 'Human rejected execution.' };
          step.status = 'failed';
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

      this.emitEvent({ type: 'agent:step_completed', agentId: this.id, step: step.id, result });

      if (!result.success && this.config.maxRetries > 0) {
        const fixed = await this.retryStep(step, result, toolContext);
        if (fixed) {
          step.status = 'completed';
          step.result = fixed;
        }
      }

      this.artifacts.createLogArtifact(this.id, `Step ${step.id}: ${step.description}`, 
        `Tool: ${step.tool}\nStatus: ${step.status}\nOutput: ${(step.result?.output ?? '').slice(0, 2000)}\n${step.result?.error ? `Error: ${step.result.error}` : ''}`
      );
    }
    
    this.currentStep = this.plan.steps.length;
    await this.persist();
  }

  private async executeLLMStep(step: PlanStep, toolContext: ToolContext): Promise<ToolResult> {
    this.messages.push({
      role: 'user',
      content: `Execute step ${step.id}: ${step.description}\n\nUse one of the available tools to accomplish this.`,
    });

    const toolDefs = this.tools.getDefinitions(this.config.tools.length > 0 ? this.config.tools : undefined);

    const response = await this.gateway.complete({
      model: this.config.model,
      messages: this.messages,
      tools: toolDefs,
      temperature: 0.2,
      maxTokens: 4096,
    });

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
    const response = await this.gateway.complete({
      model: this.config.model,
      messages: this.messages,
      tools: toolDefs,
      temperature: 0.2,
      maxTokens: 4096,
    });

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
    await this.persist();
    this.emitEvent({ type: 'agent:state_changed', agentId: this.id, from, to: state });
  }

  private emitEvent(event: EngineEvent): void {
    this.emit(event.type, event);
    this.emit('event', event);
  }

  sendFeedback(feedback: string): void {
    this.messages.push({ role: 'user', content: `[User Feedback]: ${feedback}` });
    this.persist();
  }
}
