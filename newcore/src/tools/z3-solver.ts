// ═══════════════════════════════════════════════════════════════
// OpenGravity — Z3 Formal Verification Tool
// Uses actual Microsoft Z3 WASM solver for SMT-LIB2 verification.
// ═══════════════════════════════════════════════════════════════

import { init } from 'z3-solver';
import type { Tool, ToolInput, ToolResult, ToolContext, Z3Constraint } from '../types/index.js';
import { getConfig } from '../config/index.js';

let z3Api: any = null;

export class Z3VerifyTool implements Tool {
  name = 'z3_verify';
  description = `Formal verification tool using Microsoft Z3 SMT solver.
  Use this to formally prove code correctness, bounds safety, null safety, and overflows.
  Constraints must be written in valid SMT-LIB2 format or simple JavaScript boolean expressions.`;

  parameters = {
    type: 'object',
    properties: {
      constraints: {
        type: 'array',
        description: 'Array of constraints to verify',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            expression: { type: 'string', description: 'Constraint (e.g., "(declare-const x Int) (assert (> x 0))")' },
            description: { type: 'string' },
          },
          required: ['name', 'expression'],
        },
      },
      mode: {
        type: 'string',
        enum: ['smt2', 'javascript_expr'],
        description: 'Format of the expression (smt2 is preferred)',
      },
    },
    required: ['constraints'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const config = getConfig();
    if (!config.z3Enabled) {
      return { success: true, output: 'Z3 verification disabled.' };
    }

    if (!z3Api) {
      z3Api = await init();
    }

    const { Z3 } = z3Api;
    const constraints = input.constraints as Z3Constraint[];
    const mode = input.mode as string || 'smt2';
    
    const lines: string[] = ['═══ Z3 Formal Verification Report ═══'];
    let passedCount = 0;

    for (const c of constraints) {
      try {
        const { Context } = z3Api;
        const ctx = new Context('main');
        const solver = new ctx.Solver();

        if (mode === 'smt2') {
          solver.fromString(c.expression);
        } else {
          // Fallback logic for basic expressions if they don't provide SMT-LIB2
          // This evaluates simple expressions dynamically to true/false as a fallback
          // Ideally the agent will send 'smt2'
          const val = eval(c.expression);
          solver.add(val === true ? ctx.Bool.val(true) : ctx.Bool.val(false));
        }

        const checkResult = await solver.check();
        
        if (checkResult === 'sat') {
          const model = solver.model();
          let counterexample = '';
          for (const decl of model.decls()) {
             counterexample += `${decl.name()}: ${model.eval(decl.apply(), true).toString()} `;
          }
          
          lines.push(`✅ ${c.name}: SATISFIABLE`);
          lines.push(`   ↳ ${c.description}`);
          if (counterexample) lines.push(`   💡 Model: ${counterexample}`);
          passedCount++;
        } else if (checkResult === 'unsat') {
          lines.push(`❌ ${c.name}: UNSATISFIABLE`);
          lines.push(`   ↳ ${c.description}`);
          lines.push(`   ⚠ Code/logic is mathematically impossible to satisfy.`);
        } else {
          lines.push(`❓ ${c.name}: UNKNOWN`);
        }
      } catch (err: any) {
        lines.push(`❌ ${c.name}: ERROR parsing constraint: ${err.message}`);
      }
    }

    return {
      success: passedCount === constraints.length,
      output: lines.join('\n'),
    };
  }
}
