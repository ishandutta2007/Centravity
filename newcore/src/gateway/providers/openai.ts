// ═══════════════════════════════════════════════════════════════
// OpenGravity — OpenAI Provider
// ═══════════════════════════════════════════════════════════════

import type {
  ModelProvider, ModelInfo, CompletionRequest, CompletionResponse,
} from '../../types/index.js';

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  readonly models: ModelInfo[] = [
    { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128_000, maxOutputTokens: 16_384, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.0000025, costPerOutputToken: 0.00001 },
    { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', contextWindow: 128_000, maxOutputTokens: 16_384, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.00000015, costPerOutputToken: 0.0000006 },
  ];
  private apiKey: string;
  constructor(apiKey: string) { this.apiKey = apiKey; }

  async isAvailable(): Promise<boolean> { return !!this.apiKey; }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: request.model || 'gpt-4o',
      messages: request.messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.name) msg.name = m.name;
        if (m.toolCallId) msg.tool_call_id = m.toolCallId;
        if (m.toolCalls) msg.tool_calls = m.toolCalls;
        return msg;
      }),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 8192,
    };
    if (request.tools?.length) { body.tools = request.tools; body.tool_choice = 'auto'; }
    if (request.stop) body.stop = request.stop;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`OpenAI error (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as any;
    const choice = data.choices[0];
    return {
      id: data.id, model: data.model, content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls?.map((tc: any) => ({ id: tc.id, type: 'function' as const, function: { name: tc.function.name, arguments: tc.function.arguments } })),
      usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0, totalTokens: data.usage?.total_tokens ?? 0 },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      latencyMs: Date.now() - start,
    };
  }
}
