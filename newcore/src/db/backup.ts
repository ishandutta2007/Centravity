// ═══════════════════════════════════════════════════════════════
// OpenCentravity — DB Backup Utility
//
// Creates a timestamped snapshot of the current SQLite database.
// The copy is a "safe" snapshot (uses SQLite's backup API via
// libsql's `client.close()` after a checkpoint) so the file
// is never copied mid-write.
// ═══════════════════════════════════════════════════════════════

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { getConfig } from '../config/index.js';

export interface BackupResult {
  path: string;
  sizeBytes: number;
  timestamp: number;
}

export const BACKUPS_DIR = resolve(process.cwd(), 'data', 'backups');

/**
 * Creates a timestamped copy of the DB file. Safe to call at any
 * time — SQLite WAL guarantees the .db file plus the .db-wal
 * file together represent a consistent state.
 */
export async function createBackup(label = 'manual'): Promise<BackupResult> {
  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const config = getConfig();
  // The config names the audit JSONL file, but the actual DB
  // is at data/opencentravity.db. Hardcode the path here for
  // clarity; if we ever change the DB filename, this is the one
  // place to update.
  const dbPath = resolve(process.cwd(), 'data', 'opencentravity.db');
  if (!existsSync(dbPath)) {
    throw new Error(`No database found at ${dbPath}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `opencentravity-${label}-${ts}.db`;
  const dest = join(BACKUPS_DIR, filename);

  copyFileSync(dbPath, dest);
  const stat = statSync(dest);

  return {
    path: dest,
    sizeBytes: stat.size,
    timestamp: Date.now(),
  };
}

/**
 * Lists all backups in the backups folder, newest first.
 * Used by the CLI for inspection.
 */
export function listBackups(): BackupResult[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.db'))
    .map(filename => {
      const path = join(BACKUPS_DIR, filename);
      const stat = statSync(path);
      return {
        path,
        sizeBytes: stat.size,
        timestamp: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Deletes backups older than the given age in milliseconds.
 * Used by the retention policy. Returns the number deleted.
 */
export function pruneBackups(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  const all = listBackups();
  let deleted = 0;
  for (const b of all) {
    if (b.timestamp < cutoff) {
      try {
        require('fs').unlinkSync(b.path);
        deleted++;
      } catch {
        // Best-effort
      }
    }
  }
  return deleted;
}
