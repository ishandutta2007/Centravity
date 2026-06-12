// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Audit Logger
//
// Full action timeline with DB persistence (v0.2.0).
//
// Backward compat: the JSONL file at data/audit.jsonl is still
// written on every log() call. New code that wants to query
// the audit log uses the DB via the audit table module. The
// JSONL file remains for log aggregators and external parsers.
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { AuditEntry, AuditWriter } from '../types/index.js';
import { getConfig } from '../config/index.js';
import * as auditTable from '../db/tables/audit.js';
import { trackPromise } from '../db/index.js';

export class AuditLogger implements AuditWriter {
  private logPath: string;
  private entries: AuditEntry[] = [];
  private counter = 0;

  constructor() {
    const config = getConfig();
    // The config names the audit JSONL file. We keep the .jsonl
    // extension in the resolved path even if the user wrote ".db".
    this.logPath = resolve(config.auditDbPath.replace(/\.db$/, '.jsonl'));
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

    // 1. Persist to JSONL file (backward compat — external log
    //    parsers and existing tooling depend on this).
    try {
      appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    } catch {
      // Non-fatal: audit logging should never break the engine
    }

    // 2. Persist to DB (v0.2.0). The DB is the source of truth;
    //    the JSONL is a hot cache. We fire-and-await so errors
    //    surface, but a DB error doesn't block the JSONL write.
    trackPromise(
      auditTable.insert({
        timestamp: fullEntry.timestamp,
        agentId: fullEntry.agentId,
        action: fullEntry.action,
        target: fullEntry.target,
        result: fullEntry.result,
        details: fullEntry.details,
        durationMs: fullEntry.durationMs,
      }).catch(err => {
        // Don't crash the engine; just log to stderr.
        console.error('Audit DB write failed:', err);
      })
    );
  }

  query(filter?: { agentId?: string; action?: string; result?: string; limit?: number }): AuditEntry[] {
    // Map the v0.1.0 query shape to the v0.2.0 DB query.
    // We do a sync-looking in-memory read of the local entries
    // for backward compat with callers that expect an array
    // synchronously. The DB has the authoritative copy.
    let results = this.entries;
    if (filter?.agentId) results = results.filter(e => e.agentId === filter.agentId);
    if (filter?.action) results = results.filter(e => e.action.includes(filter.action!));
    if (filter?.result) results = results.filter(e => e.result === filter.result);
    if (filter?.limit) results = results.slice(-filter.limit);
    return results;
  }

  /**
   * Async query against the DB. Use this for any new code that
   * needs accurate cross-restart audit data.
   */
  async queryDb(filter?: { agentId?: string; action?: string; result?: 'success' | 'failure' | 'blocked'; limit?: number }) {
    return auditTable.query(filter);
  }

  /**
   * Async aggregate stats. Use this for the Manager UI.
   */
  async statsDb(filter?: { agentId?: string; sinceMs?: number }) {
    return auditTable.getStats(filter);
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
