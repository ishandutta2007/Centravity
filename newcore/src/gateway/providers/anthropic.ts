// ═══════════════════════════════════════════════════════════════
// OpenGravity — Anthropic Provider
// ═══════════════════════════════════════════════════════════════

import type {
  ModelProvider, ModelInfo, CompletionRequest, CompletionResponse,
} from '../../types/index.js';

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly models: ModelInfo[] = [
    { id: 'claude-sonnet-4-20250514', provider: 'anthropic', name: 'Claude Sonnet 4', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.000003, costPerOutputToken: 0.000015 },
    { id: 'claude-3-5-haiku-20241022', provider: 'anthropic', name: 'Claude 3.5 Haiku', contextWindow: 200_000, maxOutputTokens: 8_192, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.0000008, costPerOutputToken: 0.000004 },
  ];
  private apiKey: string;
  constructor(apiKey: string) { this.apiKey = apiKey; }

  async isAvailable(): Promise<boolean> { return !!this.apiKey; }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const systemMsg = request.messages.find(m => m.role === 'system');
    const nonSystemMsgs = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model || 'claude-sonnet-4-20250514',
      max_tokens: request.maxTokens ?? 8192,
      messages: nonSystemMsgs.map(m => {
        if (m.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] };
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      }),
    };
    if (systemMsg) body.system = systemMsg.content;
    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Anthropic error (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as any;

    let content = '';
    const toolCalls = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') content += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, type: 'function' as const, function: { name: block.name, arguments: JSON.stringify(block.input) } });
      }
    }
    return {
      id: data.id, model: data.model, content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0, totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) },
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      latencyMs: Date.now() - start,
    };
  }
}
