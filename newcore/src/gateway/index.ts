// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Model Gateway
// Universal LLM router with pluggable providers and fallback.
// ═══════════════════════════════════════════════════════════════

import type {
  ModelProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../types/index.js';
import { getConfig } from '../config/index.js';
import { MockProvider } from './providers/mock.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';
import { recordCall } from './cost-recorder.js';

export interface ModelGatewayOptions {
  /** The agent id that owns calls made through this gateway instance. */
  agentId?: string;
  /** The swarm id (if any) the calling agent belongs to. */
  swarmId?: string | null;
}

/**
 * Params that callers can attach to a single complete()/stream() call
 * to supply per-call context (agentId, swarmId). When omitted, the
 * gateway falls back to the values configured at construction.
 */
export interface CompletionCallParams {
  agentId?: string;
  swarmId?: string | null;
}

export class ModelGateway {
  private providers = new Map<string, ModelProvider>();
  private modelToProvider = new Map<string, string>();
  private fallbackChain: string[] = [];
  private agentId: string | undefined;
  private swarmId: string | null | undefined;

  constructor(options: ModelGatewayOptions = {}) {
    this.agentId = options.agentId;
    this.swarmId = options.swarmId ?? null;
    this.registerBuiltinProviders();
  }

  private registerBuiltinProviders(): void {
    const config = getConfig();

    // Mock provider is always available (no API key needed)
    this.registerProvider(new MockProvider());

    // Register real providers based on available API keys
    if (config.geminiApiKey) {
      this.registerProvider(new GeminiProvider(config.geminiApiKey));
    }
    if (config.openaiApiKey) {
      this.registerProvider(new OpenAIProvider(config.openaiApiKey));
    }
    if (config.anthropicApiKey) {
      this.registerProvider(new AnthropicProvider(config.anthropicApiKey));
    }

    // Ollama is always registered (may or may not be running)
    this.registerProvider(new OllamaProvider(config.ollamaBaseUrl));

    // Build fallback chain: prefer real providers, fall back to mock
    this.fallbackChain = ['gemini', 'openai', 'anthropic', 'ollama', 'mock'];
  }

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.name, provider);
    for (const model of provider.models) {
      this.modelToProvider.set(model.id, provider.name);
    }
  }

  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.models);
    }
    return models;
  }

  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];
    for (const [name, provider] of this.providers) {
      try {
        if (await provider.isAvailable()) {
          available.push(name);
        }
      } catch {
        // Provider not available, skip
      }
    }
    return available;
  }

  resolveModel(modelSpec: string): { provider: string; model: string } {
    // Format: "provider:model" or just "model" or just "provider"
    if (modelSpec.includes(':')) {
      const [provider, model] = modelSpec.split(':', 2);
      return { provider, model };
    }

    // Check if it's a provider name
    if (this.providers.has(modelSpec)) {
      const provider = this.providers.get(modelSpec)!;
      return { provider: modelSpec, model: provider.models[0]?.id ?? modelSpec };
    }

    // Check if it's a model id
    const providerName = this.modelToProvider.get(modelSpec);
    if (providerName) {
      return { provider: providerName, model: modelSpec };
    }

    // Default
    return { provider: 'mock', model: 'mock-default' };
  }

  /**
   * Make a completion call. `params` (when supplied) override the
   * gateway's default agentId/swarmId for this single call — useful
   * when one gateway instance is shared across multiple agents.
   */
  async complete(request: CompletionRequest, params: CompletionCallParams = {}): Promise<CompletionResponse> {
    const { provider: providerName, model } = this.resolveModel(request.model);

    // Try primary provider
    const provider = this.providers.get(providerName);
    if (provider) {
      try {
        const isAvail = await provider.isAvailable();
        if (isAvail) {
          const response = await provider.complete({ ...request, model });
          await this.maybeRecordCall(response, providerName, params);
          return response;
        }
      } catch (err) {
        console.error(`Provider ${providerName} failed:`, err);
      }
    }

    // Fallback chain
    for (const fallbackName of this.fallbackChain) {
      if (fallbackName === providerName) continue;
      const fb = this.providers.get(fallbackName);
      if (!fb) continue;
      try {
        const isAvail = await fb.isAvailable();
        if (isAvail) {
          const fbModel = fb.models[0]?.id ?? fallbackName;
          const response = await fb.complete({ ...request, model: fbModel });
          await this.maybeRecordCall(response, fallbackName, params);
          return response;
        }
      } catch {
        continue;
      }
    }

    throw new Error('No available LLM providers. Configure an API key or start Ollama.');
  }

  async *stream(request: CompletionRequest, params: CompletionCallParams = {}): AsyncIterable<StreamChunk> {
    const { provider: providerName, model } = this.resolveModel(request.model);
    const provider = this.providers.get(providerName);

    if (provider?.stream) {
      // Wrap the provider's stream so we can capture usage from the
      // final chunk and run the cost recorder.
      let lastChunk: StreamChunk | null = null;
      for await (const chunk of provider.stream({ ...request, model })) {
        lastChunk = chunk;
        yield chunk;
        if (chunk.done) break;
      }

      // Some providers put a `usage` field on the final chunk; if so
      // we record the call. If not, the caller (or complete() path)
      // will get the cost event instead.
      const usage = (lastChunk as (StreamChunk & { usage?: { promptTokens: number; completionTokens: number } }))?.usage;
      if (usage) {
        const costUsd = this.computeCost(providerName, model, usage.promptTokens, usage.completionTokens);
        await this.maybeRecordUsage(usage, providerName, model, costUsd, params);
      }
      return;
    }

    // Fallback: simulate streaming from non-streaming response
    const response = await this.complete(request, params);
    const words = response.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield {
        id: response.id,
        delta: (i > 0 ? ' ' : '') + words[i],
        done: i === words.length - 1,
      };
    }
  }

  // ── Cost tracking helpers ──────────────────────────────────────

  /**
   * Resolve the (agentId, swarmId) tuple to attach to a cost event.
   * Per-call params win over constructor defaults.
   */
  private resolveCallContext(params: CompletionCallParams): { agentId: string | undefined; swarmId: string | null } {
    return {
      agentId: params.agentId ?? this.agentId,
      swarmId: params.swarmId ?? this.swarmId ?? null,
    };
  }

  /**
   * Compute USD cost from a model id, prompt tokens, and completion
   * tokens. Uses the provider's ModelInfo for pricing. Returns 0 for
   * unknown models (e.g. a free-tier provider) or the mock provider.
   */
  private computeCost(providerName: string, modelId: string, promptTokens: number, completionTokens: number): number {
    const provider = this.providers.get(providerName);
    const model = provider?.models.find(m => m.id === modelId);
    if (!model) return 0;
    return promptTokens * model.costPerInputToken + completionTokens * model.costPerOutputToken;
  }

  private async maybeRecordCall(response: CompletionResponse, providerName: string, params: CompletionCallParams): Promise<void> {
    const ctx = this.resolveCallContext(params);
    if (!ctx.agentId) return; // No agent context → nowhere to attribute the call.
    const costUsd = this.computeCost(providerName, response.model, response.usage.promptTokens, response.usage.completionTokens);
    await recordCall(ctx.agentId, ctx.swarmId, providerName, response.model, response.usage, costUsd);
  }

  private async maybeRecordUsage(
    usage: { promptTokens: number; completionTokens: number },
    providerName: string,
    modelId: string,
    costUsd: number,
    params: CompletionCallParams,
  ): Promise<void> {
    const ctx = this.resolveCallContext(params);
    if (!ctx.agentId) return;
    await recordCall(ctx.agentId, ctx.swarmId, providerName, modelId, usage, costUsd);
  }
}
