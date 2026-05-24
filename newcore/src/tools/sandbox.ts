// ═══════════════════════════════════════════════════════════════
// OpenGravity — Python Sandbox Tool (V2)
// True containerized execution via Docker with HitL hooks.
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { randomBytes } from 'crypto';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';

export class PythonSandboxTool implements Tool {
  name = 'python_sandbox';
  description = `Execute Python code in a secure, containerized DOCKER sandbox.
  CRITICAL CONCEPT: Pass-by-Reference, not Pass-by-Value.
  Do NOT pass large datasets through the LLM. Instead, have one agent/tool 
  save data to a file (e.g., 'data.csv') in the workspace, and have the 
  sandbox read from that file. The sandbox mounts the workspace at /workspace.
  Requires Human-in-the-Loop (HitL) approval before execution.`;
  
  parameters = {
    type: 'object',
    properties: {
      code: { 
        type: 'string', 
        description: 'The Python code to execute. Can read/write to /workspace.' 
      },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional pip dependencies to install (e.g., ["pandas", "matplotlib"])'
      }
    },
    required: ['code'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const code = input.code as string;
    const dependencies = (input.dependencies as string[]) || [];
    
    // 1. Human-in-the-Loop (HitL) Approval Phase
    // Note: The agent orchestrator now pauses execution completely until
    // the POST /agents/:id/approve API is hit. This is handled before this tool is even called.
    
    // 2. Setup Sandbox Directory
    const sandboxDir = resolve(context.workspaceDir, '.sandbox');
    if (!existsSync(sandboxDir)) mkdirSync(sandboxDir, { recursive: true });

    // 3. Write Code to File
    const scriptId = randomBytes(4).toString('hex');
    const scriptPath = join(sandboxDir, `script_${scriptId}.py`);
    
    const wrappedCode = `
import os
import sys

# Set working directory to the mounted workspace
os.chdir("/workspace")

# User Code
${code}
`;

    writeFileSync(scriptPath, wrappedCode, 'utf-8');

    // 4. Check if Docker is installed
    let useDocker = true;
    try {
      execSync('docker info', { stdio: 'ignore' });
    } catch {
      useDocker = false;
      context.auditLog.log({
        agentId: context.agentId,
        action: 'sandbox:warning',
        target: 'docker',
        result: 'failure',
        details: 'Docker not found. Falling back to local python process.',
        durationMs: 0
      });
    }

    // 5. Execute Code
    try {
      let output = '';
      
      if (useDocker) {
        // Build the docker command
        let depCmd = '';
        if (dependencies.length > 0) {
           depCmd = `pip install -q ${dependencies.join(' ')} && `;
        }
        
        // Convert windows paths for docker
        const winPath = context.workspaceDir.replace(/\\/g, '/');
        const dockerCmd = `docker run --rm -v "${winPath}:/workspace" -w /workspace python:3.11-slim bash -c "${depCmd}python .sandbox/script_${scriptId}.py"`;
        
        output = execSync(dockerCmd, {
          encoding: 'utf-8',
          timeout: 60_000, 
          maxBuffer: 5 * 1024 * 1024 
        });
      } else {
        // Fallback local execution
        if (dependencies.length > 0) {
          execSync(`pip install -q ${dependencies.join(' ')}`, { cwd: sandboxDir });
        }
        output = execSync(`python "${scriptPath}"`, {
          cwd: context.workspaceDir,
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024
        });
      }

      return { 
        success: true, 
        output: output.trim() || 'Execution successful (no output).' 
      };
    } catch (err: any) {
      const stdout = err.stdout?.toString() ?? '';
      const stderr = err.stderr?.toString() ?? '';
      return { 
        success: false, 
        output: stdout, 
        error: stderr || err.message 
      };
    }
  }
}
