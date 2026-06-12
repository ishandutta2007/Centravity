// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Agent Integration Test Suite (LWM Lifecycle)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../src/orchestrator/index.js';
import { loadConfig } from '../src/config/index.js';
import { resetForTests, getDb } from '../src/db/index.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('Agent LWM Integration', () => {
  beforeAll(() => {
    // Ensure test directories exist
    if (!existsSync('./data')) mkdirSync('./data', { recursive: true });
    if (!existsSync('./workspaces')) mkdirSync('./workspaces', { recursive: true });
    if (!existsSync('./artifacts')) mkdirSync('./artifacts', { recursive: true });
    
    // Initialize config with mock model
    loadConfig({
      defaultModel: 'mock',
      workspaceRoot: './workspaces',
      artifactsDir: './artifacts',
    });
  });

  beforeEach(async () => {
    await resetForTests();
    await getDb();
  });

  it('should run the agent lifecycle through the LWM goal approval gate', async () => {
    const orchestrator = new AgentOrchestrator();
    
    // Create an agent with a task that contains "plan" to trigger MockProvider's planning response
    const task = 'Create a plan for developing a new feature';
    const agent = orchestrator.createAgent(task, { model: 'mock' });
    
    expect(agent.getStatus().state).toBe('idle');

    // Run the agent in a non-blocking way
    const runPromise = agent.run();

    // Give it a brief moment to transition through planning and reach the waiting_goal_approval state
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify agent is paused waiting for goal approval
    const statusBeforeApprove = agent.getStatus();
    expect(statusBeforeApprove.state).toBe('waiting_goal_approval');

    // Check that LWM has been initialized with the planning goals
    const telemetry = agent.memory.getTelemetryState();
    expect(telemetry.swarmAttention.length).toBeGreaterThan(0);
    expect(telemetry.activeGoals).toContain('root:task');
    expect(telemetry.activeGoals).toContain('goal:step1');

    // Verify that the Goal Confirmation Artifact was created
    expect(statusBeforeApprove.artifacts.length).toBeGreaterThan(1);
    const goalConfirmationArtifact = statusBeforeApprove.artifacts
      .map(id => orchestrator.getArtifacts().get(agent.id, id))
      .find(art => art?.title === 'Goal Confirmation');
      
    expect(goalConfirmationArtifact).toBeDefined();
    expect(goalConfirmationArtifact?.content).toContain('═══ GOAL CONFIRMATION ═══');

    // Approve the goals to resume execution
    agent.approveGoals();

    // Wait for the agent execution to finish
    const finalStatus = await runPromise;
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.totalSteps).toBe(5); // The mock plan has 5 steps
    expect(finalStatus.currentStep).toBe(5);
  });
});
