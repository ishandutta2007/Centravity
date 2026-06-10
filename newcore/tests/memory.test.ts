// ═══════════════════════════════════════════════════════════════
// OpenGravity — Liquid Working Memory (LWM) Test Suite
// Validates: decay dynamics, stimulus propagation, Hebbian
// plasticity, goal anchoring, prompt synthesis, and telemetry.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { LiquidMemory } from '../src/memory/liquid.js';

describe('LiquidMemory', () => {
  let mem: LiquidMemory;

  beforeEach(() => {
    mem = new LiquidMemory();
  });

  // ── Node Management ──

  describe('Node Management', () => {
    it('should add and retrieve nodes', () => {
      mem.addNode('goal:1', 'goal', 'Build REST API', 0.8);
      const nodes = mem.getAllNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe('goal:1');
      expect(nodes[0].type).toBe('goal');
      expect(nodes[0].content).toBe('Build REST API');
      expect(nodes[0].goalBias).toBe(0.8);
    });

    it('should update content on duplicate node add without lowering goalBias', () => {
      mem.addNode('goal:1', 'goal', 'Build REST API', 0.8);
      mem.addNode('goal:1', 'goal', 'Build REST API v2', 0.3);
      const nodes = mem.getAllNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].content).toBe('Build REST API v2');
      expect(nodes[0].goalBias).toBe(0.8); // Should keep the higher bias
    });

    it('should remove nodes and their associated edges', () => {
      mem.addNode('a', 'transient', 'A', 0);
      mem.addNode('b', 'transient', 'B', 0);
      mem.addEdge('a', 'b', 0.5);
      mem.removeNode('a');
      expect(mem.getAllNodes()).toHaveLength(1);
      expect(mem.getAllEdges()).toHaveLength(0);
    });

    it('should clear all nodes and edges', () => {
      mem.addNode('a', 'goal', 'A', 0.5);
      mem.addNode('b', 'transient', 'B', 0);
      mem.addEdge('a', 'b', 0.3);
      mem.clear();
      expect(mem.getAllNodes()).toHaveLength(0);
      expect(mem.getAllEdges()).toHaveLength(0);
    });
  });

  // ── Activation Dynamics ──

  describe('Activation Dynamics', () => {
    it('should decay transient node activations over time', () => {
      mem.addNode('temp', 'transient', 'Temporary data', 0.0, 0.3);
      mem.addStimulus('temp', 0.8);
      const initialActivation = mem.getAllNodes()[0].activation;

      // Tick many times to allow decay
      for (let i = 0; i < 50; i++) {
        mem.tick(0.1);
      }

      const finalActivation = mem.getAllNodes()[0].activation;
      expect(finalActivation).toBeLessThan(initialActivation);
      expect(finalActivation).toBeGreaterThanOrEqual(0);
    });

    it('should keep goal node activation high due to goalBias reinforcement', () => {
      mem.addNode('root', 'goal', 'Main task', 0.9, 0.01);
      const initialActivation = mem.getAllNodes()[0].activation;

      // Tick many times — goal should resist decay due to goalBias
      for (let i = 0; i < 100; i++) {
        mem.tick(0.1);
      }

      const finalActivation = mem.getAllNodes()[0].activation;
      // Goal nodes with high bias should maintain significant activation
      expect(finalActivation).toBeGreaterThan(0.3);
    });

    it('should cap activation between 0 and 1', () => {
      mem.addNode('n', 'transient', 'Node', 0.0, 0.1);
      mem.addStimulus('n', 5.0); // Way above 1.0
      expect(mem.getAllNodes()[0].activation).toBeLessThanOrEqual(1.0);

      mem.setActivation('n', -2.0); // Way below 0
      expect(mem.getAllNodes()[0].activation).toBe(0.0);
    });

    it('should apply stimulus correctly', () => {
      mem.addNode('n', 'transient', 'Node', 0.0, 0.1);
      const before = mem.getAllNodes()[0].activation;
      mem.addStimulus('n', 0.3);
      const after = mem.getAllNodes()[0].activation;
      expect(after).toBeGreaterThan(before);
    });
  });

  // ── Edge Propagation ──

  describe('Edge Propagation', () => {
    it('should propagate activation across edges during tick', () => {
      mem.addNode('source', 'transient', 'Source', 0.0, 0.05);
      mem.addNode('target', 'transient', 'Target', 0.0, 0.05);
      mem.addEdge('source', 'target', 0.8);

      // Heavily stimulate source
      mem.addStimulus('source', 0.9);

      // Target should receive activation via the edge
      const targetBefore = mem.getAllNodes().find(n => n.id === 'target')!.activation;
      mem.tick(0.2);
      const targetAfter = mem.getAllNodes().find(n => n.id === 'target')!.activation;

      // Target should have changed due to incoming signal from source
      expect(targetAfter).not.toBe(targetBefore);
    });

    it('should strengthen edge weights when both nodes are co-active (Hebbian)', () => {
      mem.addNode('a', 'transient', 'A', 0.0, 0.01);
      mem.addNode('b', 'transient', 'B', 0.0, 0.01);
      mem.addEdge('a', 'b', 0.1);

      // Stimulate both nodes simultaneously
      mem.addStimulus('a', 0.9);
      mem.addStimulus('b', 0.9);

      const edgeBefore = mem.getAllEdges()[0].weight;
      mem.tick(0.2);
      const edgeAfter = mem.getAllEdges()[0].weight;

      // Hebbian rule: co-active nodes should strengthen their edge
      expect(edgeAfter).toBeGreaterThan(edgeBefore);
    });

    it('should weaken edge weights when nodes are not co-active', () => {
      mem.addNode('a', 'transient', 'A', 0.0, 0.5);
      mem.addNode('b', 'transient', 'B', 0.0, 0.5);
      // Set both activations to near-zero so co-activation is negligible
      mem.setActivation('a', 0.01);
      mem.setActivation('b', 0.01);
      mem.addEdge('a', 'b', 0.5);

      // Let the weight decay term dominate over many ticks
      for (let i = 0; i < 50; i++) {
        mem.tick(0.1);
      }

      const edgeAfter = mem.getAllEdges()[0].weight;
      expect(edgeAfter).toBeLessThan(0.5);
    });

    it('should clamp edge weights between -1 and 1', () => {
      mem.addNode('a', 'transient', 'A', 0.0, 0.01);
      mem.addNode('b', 'transient', 'B', 0.0, 0.01);
      mem.addEdge('a', 'b', 0.99);

      mem.addStimulus('a', 1.0);
      mem.addStimulus('b', 1.0);

      for (let i = 0; i < 100; i++) {
        mem.tick(0.2);
        mem.addStimulus('a', 0.5);
        mem.addStimulus('b', 0.5);
      }

      const edge = mem.getAllEdges()[0];
      expect(edge.weight).toBeLessThanOrEqual(1.0);
      expect(edge.weight).toBeGreaterThanOrEqual(-1.0);
    });
  });

  // ── Prompt Context Synthesis ──

  describe('Prompt Context Synthesis', () => {
    it('should generate empty string when no nodes are active', () => {
      expect(mem.getLiquidPromptContext()).toBe('');
    });

    it('should include goal nodes in the context output', () => {
      mem.addNode('goal:1', 'goal', 'Build authentication module', 0.8);
      const ctx = mem.getLiquidPromptContext();
      expect(ctx).toContain('LIQUID WORKING MEMORY');
      expect(ctx).toContain('Build authentication module');
      expect(ctx).toContain('goal:1');
    });

    it('should include transient nodes with high activation', () => {
      mem.addNode('error:1', 'transient', 'TypeError in server.ts', 0.0, 0.1);
      mem.addStimulus('error:1', 0.9);
      const ctx = mem.getLiquidPromptContext();
      expect(ctx).toContain('TypeError in server.ts');
    });

    it('should exclude nodes with activation below threshold', () => {
      mem.addNode('old', 'transient', 'Old completed task', 0.0, 0.9);
      // Don't stimulate — let it stay at default low activation or decay
      mem.setActivation('old', 0.05);
      const ctx = mem.getLiquidPromptContext();
      expect(ctx).not.toContain('Old completed task');
    });
  });

  // ── Telemetry ──

  describe('Telemetry State', () => {
    it('should identify the highest-activation node as activeFocus', () => {
      mem.addNode('a', 'transient', 'Low', 0.0, 0.1);
      mem.addNode('b', 'goal', 'High focus', 0.9);
      mem.addStimulus('b', 0.1);

      const tel = mem.getTelemetryState();
      expect(tel.activeFocus).toBe('b');
    });

    it('should list active goals above threshold', () => {
      mem.addNode('g1', 'goal', 'Goal 1', 0.7);
      mem.addNode('g2', 'goal', 'Goal 2', 0.7);
      mem.addNode('t1', 'transient', 'Transient', 0.0);

      const tel = mem.getTelemetryState();
      expect(tel.activeGoals).toContain('g1');
      expect(tel.activeGoals).toContain('g2');
      expect(tel.activeGoals).not.toContain('t1');
    });

    it('should compute cognitiveLoad from error/failure nodes', () => {
      mem.addNode('error:compile', 'transient', 'Compile error in auth.ts', 0.0, 0.05);
      mem.addStimulus('error:compile', 0.8);
      mem.addNode('normal', 'transient', 'Normal operation', 0.0, 0.1);
      mem.addStimulus('normal', 0.5);

      const tel = mem.getTelemetryState();
      expect(tel.cognitiveLoad).toBeGreaterThan(0);
    });

    it('should sort swarmAttention by activation descending', () => {
      mem.addNode('low', 'transient', 'Low', 0.0, 0.1);
      mem.addNode('high', 'goal', 'High', 0.9);
      mem.addNode('mid', 'transient', 'Mid', 0.0, 0.1);
      mem.addStimulus('mid', 0.5);

      const tel = mem.getTelemetryState();
      for (let i = 1; i < tel.swarmAttention.length; i++) {
        expect(tel.swarmAttention[i - 1].activation)
          .toBeGreaterThanOrEqual(tel.swarmAttention[i].activation);
      }
    });
  });

  // ── Integration Scenario ──

  describe('Integration: Multi-Step Agent Simulation', () => {
    it('should simulate a full plan-execute-verify lifecycle', () => {
      // Phase 1: Initialize goals from plan
      mem.addNode('root:task', 'goal', 'Build Express API with auth', 0.95, 0.005);
      mem.addNode('goal:step1', 'goal', 'Create project structure', 0.7, 0.02);
      mem.addNode('goal:step2', 'goal', 'Implement auth middleware', 0.5, 0.02);
      mem.addEdge('root:task', 'goal:step1', 0.6);
      mem.addEdge('root:task', 'goal:step2', 0.6);
      mem.addEdge('goal:step1', 'goal:step2', 0.4);
      mem.tick(0.1);

      // Phase 2: Execute step 1 (success)
      mem.addNode('step:1', 'transient', 'Executing: Create project structure', 0.0, 0.2);
      mem.addStimulus('step:1', 0.8);
      mem.tick(0.1);
      // Step 1 completes successfully
      mem.addStimulus('step:1', -0.5);
      mem.addNode('outcome:step1', 'transient', 'Completed: project structure created', 0.0, 0.3);
      mem.tick(0.1);

      // Phase 2: Execute step 2 (failure then retry)
      mem.addNode('step:2', 'transient', 'Executing: Implement auth middleware', 0.0, 0.2);
      mem.addStimulus('step:2', 0.8);
      mem.tick(0.1);
      // Step 2 fails
      const errorNodeId = 'error:step2';
      mem.addNode(errorNodeId, 'transient', 'FAILED: Cannot find module bcrypt', 0.0, 0.08);
      mem.addStimulus(errorNodeId, 1.0);
      mem.addEdge('step:2', errorNodeId, 0.8);
      mem.tick(0.1);

      // Verify: error node has high activation
      const errorNode = mem.getAllNodes().find(n => n.id === errorNodeId)!;
      expect(errorNode.activation).toBeGreaterThan(0.5);

      // Verify: telemetry shows cognitive load
      const tel = mem.getTelemetryState();
      expect(tel.cognitiveLoad).toBeGreaterThan(0);
      expect(tel.activeFocus).toBeTruthy();

      // Verify: prompt context includes the error
      const ctx = mem.getLiquidPromptContext();
      expect(ctx).toContain('Cannot find module bcrypt');

      // Verify: root task goal is still highly active
      const rootNode = mem.getAllNodes().find(n => n.id === 'root:task')!;
      expect(rootNode.activation).toBeGreaterThan(0.5);

      // Snapshot the error activation BEFORE dampening
      const errorActivationBeforeDampen = errorNode.activation;

      // Retry succeeds — dampen error
      mem.addStimulus(errorNodeId, -0.7);
      mem.tick(0.05);

      // After dampening, error should be reduced
      const errorAfter = mem.getAllNodes().find(n => n.id === errorNodeId)!;
      expect(errorAfter.activation).toBeLessThan(errorActivationBeforeDampen);
    });
  });
});
