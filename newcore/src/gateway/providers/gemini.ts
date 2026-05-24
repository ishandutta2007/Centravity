// ═══════════════════════════════════════════════════════════════
// OpenGravity — Google Gemini Provider
// Connects to Google AI Studio / Vertex AI.
// ═══════════════════════════════════════════════════════════════

import type {
  ModelProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
} from '../../types/index.js';

export class GeminiProvider implements ModelProvider {
  readonly name = 'gemini';
  readonly models: ModelInfo[] = [
    {
      id: 'gemini-2.5-flash',
      provider: 'gemini',
      name: 'Gemini 2.5 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStreaming: true,
      costPerInputToken: 0.000000075,
      costPerOutputToken: 0.0000003,
    },
    {
      id: 'gemini-2.5-pro',
      provider: 'gemini',
      name: 'Gemini 2.5 Pro',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStreaming: true,
      costPerInputToken: 0.00000125,
      costPerOutputToken: 0.000005,
    },
  ];

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const model = request.model || 'gemini-2.5-flash';

    // Convert messages to Gemini format
    const contents = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 8192,
        ...(request.stop ? { stopSequences: request.stop } : {}),
      },
    };

    // Add tool declarations if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const candidate = data.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned no candidates');
    }

    const parts = candidate.content?.parts ?? [];
    let content = '';
    const toolCalls = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call-${Date.now()}-${toolCalls.length}`,
          type: 'function' as const,
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    const usage = data.usageMetadata ?? {};

    return {
      id: `gemini-${Date.now()}`,
      model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private convertMessages(messages: CompletionRequest['messages']): unknown[] {
    const contents: unknown[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini handles system instructions differently; prepend to first user message
        contents.push({ role: 'user', parts: [{ text: `[System Instructions]: ${msg.content}` }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: unknown[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name ?? 'tool_result',
              response: { content: msg.content },
            },
          }],
        });
      }
    }

    return contents;
  }
}
