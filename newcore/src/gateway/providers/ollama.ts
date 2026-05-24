// ═══════════════════════════════════════════════════════════════
// OpenGravity — Ollama Provider (Local Models)
// ═══════════════════════════════════════════════════════════════

import type {
  ModelProvider, ModelInfo, CompletionRequest, CompletionResponse,
} from '../../types/index.js';

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama';
  readonly models: ModelInfo[] = [
    { id: 'llama3', provider: 'ollama', name: 'Llama 3 (Local)', contextWindow: 8_192, maxOutputTokens: 4_096, supportsTools: false, supportsStreaming: true, costPerInputToken: 0, costPerOutputToken: 0 },
    { id: 'codellama', provider: 'ollama', name: 'Code Llama (Local)', contextWindow: 16_384, maxOutputTokens: 4_096, supportsTools: false, supportsStreaming: true, costPerInputToken: 0, costPerOutputToken: 0 },
    { id: 'deepseek-coder', provider: 'ollama', name: 'DeepSeek Coder (Local)', contextWindow: 16_384, maxOutputTokens: 4_096, supportsTools: false, supportsStreaming: true, costPerInputToken: 0, costPerOutputToken: 0 },
  ];
  private baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl = baseUrl.replace(/\/$/, ''); }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch { return false; }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const prompt = request.messages.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `Human: ${m.content}`;
      return `Assistant: ${m.content}`;
    }).join('\n\n');

    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model || 'llama3', prompt, stream: false, options: { temperature: request.temperature ?? 0.7, num_predict: request.maxTokens ?? 4096 } }),
    });
    if (!resp.ok) throw new Error(`Ollama error (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as any;
    return {
      id: `ollama-${Date.now()}`, model: request.model || 'llama3', content: data.response ?? '',
      usage: { promptTokens: data.prompt_eval_count ?? 0, completionTokens: data.eval_count ?? 0, totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) },
      finishReason: 'stop', latencyMs: Date.now() - start,
    };
  }
}
