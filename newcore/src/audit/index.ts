// ═══════════════════════════════════════════════════════════════
// OpenGravity — Audit Logger
// Full action timeline with SQLite persistence.
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { AuditEntry, AuditWriter } from '../types/index.js';
import { getConfig } from '../config/index.js';

export class AuditLogger implements AuditWriter {
  private logPath: string;
  private entries: AuditEntry[] = [];
  private counter = 0;

  constructor() {
    const config = getConfig();
    // Use a JSON-lines file for simplicity (no native module issues with better-sqlite3)
    this.logPath = resolve(config.auditDbPath.replace('.db', '.jsonl'));
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const fullEntry: AuditEntry = {
      id: `audit-${++this.counter}-${Date.now()}`,
      timestamp: Date.now(),
      ...entry,
    };
    this.entries.push(fullEntry);

    // Persist to JSONL file
    try {
      appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    } catch {
      // Non-fatal: audit logging should never break the engine
    }
  }

  query(filter?: { agentId?: string; action?: string; result?: string; limit?: number }): AuditEntry[] {
    let results = this.entries;
    if (filter?.agentId) results = results.filter(e => e.agentId === filter.agentId);
    if (filter?.action) results = results.filter(e => e.action.includes(filter.action!));
    if (filter?.result) results = results.filter(e => e.result === filter.result);
    if (filter?.limit) results = results.slice(-filter.limit);
    return results;
  }

  getTimeline(agentId: string): string {
    const entries = this.entries.filter(e => e.agentId === agentId);
    if (!entries.length) return 'No audit entries for this agent.';

    return entries.map(e => {
      const time = new Date(e.timestamp).toISOString().slice(11, 23);
      const icon = e.result === 'success' ? '✅' : e.result === 'blocked' ? '🚫' : '❌';
      return `[${time}] ${icon} ${e.action} → ${e.target.slice(0, 80)}${e.durationMs ? ` (${e.durationMs}ms)` : ''}`;
    }).join('\n');
  }

  getStats(): { total: number; success: number; failure: number; blocked: number } {
    return {
      total: this.entries.length,
      success: this.entries.filter(e => e.result === 'success').length,
      failure: this.entries.filter(e => e.result === 'failure').length,
      blocked: this.entries.filter(e => e.result === 'blocked').length,
    };
  }
}
