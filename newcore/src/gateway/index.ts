// ═══════════════════════════════════════════════════════════════
// OpenGravity — Model Gateway
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

export class ModelGateway {
  private providers = new Map<string, ModelProvider>();
  private modelToProvider = new Map<string, string>();
  private fallbackChain: string[] = [];

  constructor() {
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

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { provider: providerName, model } = this.resolveModel(request.model);

    // Try primary provider
    const provider = this.providers.get(providerName);
    if (provider) {
      try {
        const isAvail = await provider.isAvailable();
        if (isAvail) {
          return await provider.complete({ ...request, model });
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
          return await fb.complete({ ...request, model: fbModel });
        }
      } catch {
        continue;
      }
    }

    throw new Error('No available LLM providers. Configure an API key or start Ollama.');
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const { provider: providerName, model } = this.resolveModel(request.model);
    const provider = this.providers.get(providerName);

    if (provider?.stream) {
      yield* provider.stream({ ...request, model });
    } else {
      // Fallback: simulate streaming from non-streaming response
      const response = await this.complete(request);
      const words = response.content.split(' ');
      for (let i = 0; i < words.length; i++) {
        yield {
          id: response.id,
          delta: (i > 0 ? ' ' : '') + words[i],
          done: i === words.length - 1,
        };
      }
    }
  }
}
