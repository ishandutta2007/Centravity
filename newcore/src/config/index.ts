// ═══════════════════════════════════════════════════════════════
// OpenGravity Engine — Configuration Manager
// Loads from .env + YAML + CLI args with Zod validation.
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Schema ──

export const ConfigSchema = z.object({
  // Server
  port: z.number().default(3777),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // LLM Providers
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  defaultModel: z.string().default('mock'),

  // Workspace
  workspaceRoot: z.string().default('./workspaces'),
  artifactsDir: z.string().default('./artifacts'),
  auditDbPath: z.string().default('./data/audit.db'),

  // Policy
  allowNetworkRequests: z.boolean().default(false),
  allowSystemPackages: z.boolean().default(false),
  maxCommandTimeoutMs: z.number().default(30_000),
  maxFileSizeBytes: z.number().default(10 * 1024 * 1024), // 10MB

  // Z3 Solver
  z3Enabled: z.boolean().default(true),
  z3TimeoutMs: z.number().default(5_000),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── Loader ──

let _config: Config | null = null;

function parseEnvBool(val: string | undefined): boolean | undefined {
  if (val === undefined || val === '') return undefined;
  return val === 'true' || val === '1';
}

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadConfig(overrides?: Partial<Config>): Config {
  // Load .env file from project root
  const envPath = resolve(process.cwd(), '.env');
  const envVars = { ...loadEnvFile(envPath), ...process.env };

  const raw = {
    port: envVars.PORT ? parseInt(envVars.PORT, 10) : undefined,
    host: envVars.HOST || undefined,
    logLevel: envVars.LOG_LEVEL || undefined,
    openaiApiKey: envVars.OPENAI_API_KEY || undefined,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY || undefined,
    geminiApiKey: envVars.GEMINI_API_KEY || undefined,
    ollamaBaseUrl: envVars.OLLAMA_BASE_URL || undefined,
    defaultModel: envVars.DEFAULT_MODEL || undefined,
    workspaceRoot: envVars.WORKSPACE_ROOT || undefined,
    artifactsDir: envVars.ARTIFACTS_DIR || undefined,
    auditDbPath: envVars.AUDIT_DB_PATH || undefined,
    allowNetworkRequests: parseEnvBool(envVars.ALLOW_NETWORK_REQUESTS),
    allowSystemPackages: parseEnvBool(envVars.ALLOW_SYSTEM_PACKAGES),
    maxCommandTimeoutMs: envVars.MAX_COMMAND_TIMEOUT_MS ? parseInt(envVars.MAX_COMMAND_TIMEOUT_MS, 10) : undefined,
    maxFileSizeBytes: envVars.MAX_FILE_SIZE_BYTES ? parseInt(envVars.MAX_FILE_SIZE_BYTES, 10) : undefined,
    z3Enabled: parseEnvBool(envVars.Z3_ENABLED),
    z3TimeoutMs: envVars.Z3_TIMEOUT_MS ? parseInt(envVars.Z3_TIMEOUT_MS, 10) : undefined,
    ...overrides,
  };

  // Strip undefined values so Zod defaults work
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  );

  _config = ConfigSchema.parse(cleaned);
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}
