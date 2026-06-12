// ═══════════════════════════════════════════════════════════════
// OpenCentravity — Liquid Working Memory (LWM) Engine
// Mathematical state-space memory using discretized differential
// equations and Hebbian plasticity for agent context control.
// ═══════════════════════════════════════════════════════════════

import type { MemoryNode, MemoryEdge, TelemetryState } from '../types/index.js';

export class LiquidMemory {
  private nodes = new Map<string, MemoryNode>();
  private edges = new Map<string, Map<string, number>>(); // source -> target -> weight
  
  // Hyperparameters
  private readonly ETA = 0.1;       // Hebbian learning rate
  private readonly DECAY_W = 0.02;  // Edge weight decay rate
  private readonly DEFAULT_DECAY = 0.15; // Node activation decay rate

  constructor() {}

  // ── Node & Edge Management ──

  addNode(
    id: string,
    type: 'goal' | 'transient',
    content: string,
    goalBias = 0.0,
    decayRate = 0.15
  ): void {
    if (this.nodes.has(id)) {
      // If node exists, update its content and ensure goalBias/type are correct
      const existing = this.nodes.get(id)!;
      existing.content = content;
      existing.goalBias = Math.max(existing.goalBias, goalBias);
      return;
    }

    this.nodes.set(id, {
      id,
      type,
      content,
      activation: type === 'goal' ? 0.9 : 0.5, // Goals start highly active
      goalBias,
      decayRate: type === 'goal' ? 0.01 : decayRate, // Goals decay extremely slowly on their own
    });
  }

  addEdge(sourceId: string, targetId: string, initialWeight = 0.1): void {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return;

    if (!this.edges.has(sourceId)) {
      this.edges.set(sourceId, new Map());
    }
    this.edges.get(sourceId)!.set(targetId, initialWeight);
  }

  addStimulus(nodeId: string, intensity: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Direct additive stimulus bounded by [0, 1]
    node.activation = Math.min(1.0, node.activation + intensity);
  }

  setActivation(nodeId: string, value: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.activation = Math.max(0.0, Math.min(1.0, value));
    }
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.edges.delete(id);
    for (const [, targets] of this.edges) {
      targets.delete(id);
    }
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }

  // ── Mathematical Core (LNN Dynamics) ──

  /**
   * Ticks the system forward by dt.
   * Updates node activations via continuous-time differential approximations
   * and updates edge weights via Hebbian plasticity.
   */
  tick(dt = 0.1): void {
    const nextActivations = new Map<string, number>();

    // 1. Calculate next activation states
    for (const [id, node] of this.nodes) {
      const activation = node.activation;
      
      // Calculate incoming signals from other nodes
      let incoming = 0;
      for (const [sourceId, targets] of this.edges) {
        if (targets.has(id)) {
          const sourceNode = this.nodes.get(sourceId);
          if (sourceNode) {
            const weight = targets.get(id)!;
            incoming += weight * sourceNode.activation;
          }
        }
      }

      // Reinforce goals continuously based on their goalBias
      const goalInput = node.type === 'goal' ? node.goalBias : 0;

      // Discretized differential equation:
      // da/dt = -gamma*a + (1 - a) * (incoming + goalInput)
      const decay = node.decayRate * activation;
      const saturation = 1.0 - activation;
      const excitation = incoming + goalInput;

      const da = -decay + saturation * excitation;
      
      let nextActivation = activation + da * dt;
      nextActivation = Math.max(0.0, Math.min(1.0, nextActivation));

      nextActivations.set(id, nextActivation);
    }

    // Apply next activations
    for (const [id, value] of nextActivations) {
      const node = this.nodes.get(id)!;
      node.activation = value;
    }

    // 2. Synaptic Plasticity (Hebbian weight updates)
    for (const [sourceId, targets] of this.edges) {
      const sourceNode = this.nodes.get(sourceId);
      if (!sourceNode) continue;

      for (const [targetId, weight] of targets) {
        const targetNode = this.nodes.get(targetId);
        if (!targetNode) continue;

        // Hebbian rule: nodes that activate together wire together.
        // dw = dt * (eta * a_j * a_i - decay_w * w_ji)
        const coActivation = sourceNode.activation * targetNode.activation;
        const dw = dt * (this.ETA * coActivation - this.DECAY_W * weight);
        
        let nextWeight = weight + dw;
        nextWeight = Math.max(-1.0, Math.min(1.0, nextWeight));
        
        targets.set(targetId, nextWeight);
      }
    }
  }

  // ── Context Synthesis ──

  /**
   * Compiles highly active nodes into a dense system context string
   * to inject directly into the LLM prompt.
   */
  getLiquidPromptContext(): string {
    const activeNodes = Array.from(this.nodes.values())
      .filter(n => n.activation > 0.12)
      .sort((a, b) => b.activation - a.activation);

    if (activeNodes.length === 0) return '';

    const lines: string[] = [
      '═══ LIQUID WORKING MEMORY (ACTIVE FOCUS) ═══',
      'The following goals and execution contexts are active in your working memory:',
    ];

    const goals = activeNodes.filter(n => n.type === 'goal');
    const transient = activeNodes.filter(n => n.type === 'transient');

    if (goals.length > 0) {
      lines.push('\n[Active Invariants & Goals]');
      for (const g of goals) {
        const priority = g.goalBias > 0.7 ? 'CRITICAL' : g.goalBias > 0.4 ? 'HIGH' : 'NORMAL';
        lines.push(`• [${priority}] ${g.id} (Salience: ${(g.activation * 100).toFixed(0)}%)`);
        lines.push(`  ↳ ${g.content}`);
      }
    }

    if (transient.length > 0) {
      lines.push('\n[Current Execution Context & Observations]');
      for (const t of transient) {
        lines.push(`• ${t.id} (Salience: ${(t.activation * 100).toFixed(0)}%)`);
        lines.push(`  ↳ ${t.content}`);
      }
    }

    lines.push('=============================================');
    return lines.join('\n');
  }

  // ── Telemetry ──

  /**
   * Returns a lightweight summary of the current memory dynamics
   * for visual tools and dashboard systems.
   */
  getTelemetryState(): TelemetryState {
    let activeFocus = 'None';
    let maxActivation = 0;
    const activeGoals: string[] = [];
    let cognitiveLoad = 0;

    const swarmAttention: Array<{ nodeId: string; activation: number }> = [];

    for (const [id, node] of this.nodes) {
      swarmAttention.push({ nodeId: id, activation: node.activation });

      if (node.activation > maxActivation) {
        maxActivation = node.activation;
        activeFocus = id;
      }

      if (node.type === 'goal' && node.activation > 0.3) {
        activeGoals.push(id);
      }

      // Sum of activations for error or failure nodes indicates cognitive struggle
      const idLower = id.toLowerCase();
      const contentLower = node.content.toLowerCase();
      if (
        idLower.includes('error') || idLower.includes('fail') || idLower.includes('bug') ||
        contentLower.includes('error') || contentLower.includes('fail') || contentLower.includes('bug')
      ) {
        cognitiveLoad += node.activation;
      }
    }

    // Sort attention list descending by activation
    swarmAttention.sort((a, b) => b.activation - a.activation);

    return {
      activeFocus,
      activeGoals,
      cognitiveLoad: Math.min(10.0, cognitiveLoad), // Cap cognitive load indicator
      swarmAttention,
    };
  }

  getAllNodes(): MemoryNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): MemoryEdge[] {
    const list: MemoryEdge[] = [];
    for (const [source, targets] of this.edges) {
      for (const [target, weight] of targets) {
        list.push({ source, target, weight });
      }
    }
    return list;
  }
}
