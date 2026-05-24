// ═══════════════════════════════════════════════════════════════
// OpenGravity Engine — Core Type Definitions
// The shared type contracts that every component depends on.
// ═══════════════════════════════════════════════════════════════

// ── Agent Types ──

export type AgentState =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'waiting_feedback'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentConfig {
  id: string;
  task: string;
  model: string;
  workspaceDir: string;
  maxRetries: number;
  timeoutMs: number;
  tools: string[];
  policyOverrides?: Record<string, boolean>;
}

export interface AgentStatus {
  id: string;
  state: AgentState;
  task: string;
  model: string;
  currentStep: number;
  totalSteps: number;
  artifacts: string[];
  startedAt: number;
  updatedAt: number;
  error?: string;
}

// ── LLM / Gateway Types ──

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  stop?: string[];
}

export interface CompletionResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  latencyMs: number;
}

export interface StreamChunk {
  id: string;
  delta: string;
  toolCallDelta?: Partial<ToolCall>;
  done: boolean;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPerInputToken: number;  // USD
  costPerOutputToken: number; // USD
}

// ── Provider Interface ──

export interface ModelProvider {
  readonly name: string;
  readonly models: ModelInfo[];
  isAvailable(): Promise<boolean>;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;
}

// ── Tool System Types ──

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: ArtifactData[];
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(input: ToolInput, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  workspaceDir: string;
  agentId: string;
  policyEngine: PolicyChecker;
  auditLog: AuditWriter;
}

// ── Policy Types ──

export interface PolicyChecker {
  check(action: PolicyAction): PolicyDecision;
}

export interface PolicyAction {
  type: 'file_read' | 'file_write' | 'file_delete' | 'command_exec' | 'network' | 'install_package';
  target: string;
  agentId: string;
  workspaceDir: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiresApproval?: boolean;
}

// ── Artifact Types ──

export type ArtifactType =
  | 'execution_plan'
  | 'diff'
  | 'log'
  | 'test_result'
  | 'verification'
  | 'z3_proof'
  | 'error_trace';

export interface ArtifactData {
  id: string;
  agentId: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

// ── Audit Types ──

export interface AuditEntry {
  id: string;
  timestamp: number;
  agentId: string;
  action: string;
  target: string;
  result: 'success' | 'failure' | 'blocked';
  details: string;
  durationMs: number;
}

export interface AuditWriter {
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void;
}

// ── Execution Plan Types ──

export interface ExecutionPlan {
  taskDescription: string;
  steps: PlanStep[];
  reasoning: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface PlanStep {
  id: number;
  description: string;
  tool: string;
  toolInput: ToolInput;
  dependsOn: number[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: ToolResult;
}

// ── Z3 Solver Types ──

export interface Z3Constraint {
  name: string;
  expression: string;
  description: string;
}

export interface Z3VerificationResult {
  satisfiable: boolean;
  counterexample?: Record<string, unknown>;
  proof?: string;
  errors: string[];
  timeMs: number;
}

// ── Event Types ──

export type EngineEvent =
  | { type: 'agent:created'; agentId: string; task: string }
  | { type: 'agent:state_changed'; agentId: string; from: AgentState; to: AgentState }
  | { type: 'agent:step_started'; agentId: string; step: number; description: string }
  | { type: 'agent:step_completed'; agentId: string; step: number; result: ToolResult }
  | { type: 'agent:artifact_created'; agentId: string; artifact: ArtifactData }
  | { type: 'agent:error'; agentId: string; error: string }
  | { type: 'agent:completed'; agentId: string; summary: string }
  | { type: 'gateway:request'; model: string; tokens: number }
  | { type: 'gateway:response'; model: string; latencyMs: number };
