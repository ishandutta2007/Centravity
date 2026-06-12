// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Gateway Cost Recorder
//
// Per-LLM-call cost tracker. Called by the ModelGateway after
// every provider.complete() and the final chunk of provider.stream().
// Errors are swallowed — cost tracking must NEVER break an LLM call.
// ═══════════════════════════════════════════════════════════════

import * as costTable from '../db/tables/cost-events.js';

export interface RecordCallUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Records a single LLM call's cost. Fire-and-forget: any error is
 * caught and logged so a misbehaving cost table can never abort
 * an in-flight agent run.
 */
export async function recordCall(
  agentId: string,
  swarmId: string | null,
  provider: string,
  model: string,
  usage: RecordCallUsage,
  costUsd: number,
): Promise<void> {
  try {
    await costTable.record({
      agentId,
      swarmId,
      provider,
      model,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      costUsd,
    });
  } catch (err) {
    // Swallow: cost tracking is observability, not correctness.
    // A failing cost event must never abort an in-flight LLM call
    // or agent step.
    console.error('[cost-recorder] Failed to record cost event:', err);
  }
}
