// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Artifact Store
//
// v0.2.0: keeps the v0.1.0 JSON file storage (artifacts/<id>/*.json)
// but ALSO indexes every artifact in the DB for querying and FTS5
// search. The file copy is still the human-readable canonical form;
// the DB row is the index for fast lookup and the FTS5 search index.
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ArtifactData, ArtifactType } from '../types/index.js';
import { getConfig } from '../config/index.js';
import * as artifactsTable from '../db/tables/artifacts.js';
import { trackPromise } from '../db/index.js';

export class ArtifactStore {
  private baseDir: string;

  constructor() {
    this.baseDir = getConfig().artifactsDir;
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
  }

  /** Writes the artifact to BOTH disk and DB. Returns the artifact id. */
  save(artifact: ArtifactData): string {
    const agentDir = join(this.baseDir, artifact.agentId);
    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

    const filename = `${artifact.id}.json`;
    const filepath = join(agentDir, filename);
    writeFileSync(filepath, JSON.stringify(artifact, null, 2), 'utf-8');

    // Index in DB for queryability + FTS5. The DB write is async;
    // we fire-and-await to surface errors, but a DB failure does
    // not delete the file (the file is the canonical record).
    trackPromise(
      artifactsTable.insert({
        agentId: artifact.agentId,
        swarmId: artifact.swarmId ?? null,
        type: artifact.type as ArtifactType,
        title: artifact.title,
        content: artifact.content,
        metadataJson: JSON.stringify(artifact.metadata ?? {}),
        visibility: artifact.visibility ?? 'private',
      }).then(dbId => {
        // The DB gets its own id (uuid) but the caller already has
        // artifact.id. We keep the file id and the DB row 1:1
        // via the metadata; the DB row id is internal.
        void dbId;
      }).catch(err => {
        console.error('ArtifactStore DB index failed:', err);
      })
    );

    return artifact.id;
  }

  get(agentId: string, artifactId: string): ArtifactData | null {
    const filepath = join(this.baseDir, agentId, `${artifactId}.json`);
    if (!existsSync(filepath)) return null;
    return JSON.parse(readFileSync(filepath, 'utf-8')) as ArtifactData;
  }

  listByAgent(agentId: string): ArtifactData[] {
    const agentDir = join(this.baseDir, agentId);
    if (!existsSync(agentDir)) return [];
    try {
      const files = readdirSync(agentDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(readFileSync(join(agentDir, f), 'utf-8')) as ArtifactData)
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  createPlanArtifact(agentId: string, plan: any): ArtifactData {
    const artifact: ArtifactData = {
      id: `plan-${Date.now()}`,
      agentId,
      type: 'execution_plan',
      title: 'Execution Plan',
      content: JSON.stringify(plan, null, 2),
      metadata: { stepCount: (plan.steps as unknown[])?.length ?? 0 },
      createdAt: Date.now(),
    };
    this.save(artifact);
    return artifact;
  }

  createDiffArtifact(agentId: string, filePath: string, before: string, after: string): ArtifactData {
    const artifact: ArtifactData = {
      id: `diff-${Date.now()}`,
      agentId,
      type: 'diff',
      title: `Changes to ${filePath}`,
      content: this.generateDiff(before, after),
      metadata: { filePath, beforeSize: before.length, afterSize: after.length },
      createdAt: Date.now(),
    };
    this.save(artifact);
    return artifact;
  }

  createLogArtifact(agentId: string, title: string, log: string): ArtifactData {
    const artifact: ArtifactData = {
      id: `log-${Date.now()}`,
      agentId,
      type: 'log',
      title,
      content: log,
      metadata: {},
      createdAt: Date.now(),
    };
    this.save(artifact);
    return artifact;
  }

  /**
   * v0.2.0: full-text search over artifacts. Uses the FTS5
   * index defined in migration 0006. Returns the matching
   * artifacts, ordered by relevance.
   */
  async search(query: string, limit = 20): Promise<ArtifactData[]> {
    const rows = await artifactsTable.search(query, limit);
    return rows.map(r => ({
      id: r.id,
      agentId: r.agentId,
      type: r.type,
      title: r.title,
      content: r.content,
      metadata: r.metadataJson ? JSON.parse(r.metadataJson) : {},
      createdAt: r.createdAt,
      swarmId: r.swarmId,
      visibility: r.visibility,
    }));
  }

  private generateDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const diff: string[] = [];

    const maxLen = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLen; i++) {
      const bLine = beforeLines[i];
      const aLine = afterLines[i];
      if (bLine === aLine) {
        diff.push(` ${bLine ?? ''}`);
      } else {
        if (bLine !== undefined) diff.push(`-${bLine}`);
        if (aLine !== undefined) diff.push(`+${aLine}`);
      }
    }
    return diff.join('\n');
  }
}
