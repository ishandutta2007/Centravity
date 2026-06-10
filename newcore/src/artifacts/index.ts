// ═══════════════════════════════════════════════════════════════
// OpenGravity — Artifact Store
// Verifiable outputs: plans, diffs, logs, test results, Z3 proofs.
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ArtifactData, ArtifactType } from '../types/index.js';
import { getConfig } from '../config/index.js';

export class ArtifactStore {
  private baseDir: string;

  constructor() {
    this.baseDir = getConfig().artifactsDir;
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
  }

  save(artifact: ArtifactData): string {
    const agentDir = join(this.baseDir, artifact.agentId);
    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

    const filename = `${artifact.id}.json`;
    const filepath = join(agentDir, filename);
    writeFileSync(filepath, JSON.stringify(artifact, null, 2), 'utf-8');
    return filepath;
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
