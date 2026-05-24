import { createClient } from '@libsql/client';
import { getConfig } from '../config/index.js';
import { join } from 'path';

let dbClient: ReturnType<typeof createClient> | null = null;

export async function getDb() {
  if (dbClient) return dbClient;

  const config = getConfig();
  const dbPath = join(process.cwd(), 'data', 'opengravity.db');
  
  dbClient = createClient({
    url: `file:${dbPath}`,
  });

  // Initialize Schema
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      model TEXT NOT NULL,
      state TEXT NOT NULL,
      workspaceDir TEXT NOT NULL,
      currentStep INTEGER NOT NULL DEFAULT 0,
      startedAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `);

  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      toolCalls TEXT,
      toolCallId TEXT,
      name TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(agentId) REFERENCES agents(id)
    )
  `);

  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS plans (
      agentId TEXT PRIMARY KEY,
      planJson TEXT NOT NULL,
      FOREIGN KEY(agentId) REFERENCES agents(id)
    )
  `);

  return dbClient;
}
