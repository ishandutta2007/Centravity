// ═══════════════════════════════════════════════════════════════
// OpenGravity — Vector Search Tool (Tool-Level RAG)
// Uses real embeddings and cosine similarity against local files.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { Tool, ToolInput, ToolResult, ToolContext } from '../types/index.js';
import { getEmbedding, cosineSimilarity } from '../gateway/embeddings.js';

interface VectorChunk {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  embedding: number[];
}

// In-memory vector store for the workspace
const vectorStore = new Map<string, VectorChunk[]>();

export class SemanticSearchTool implements Tool {
  name = 'semantic_search';
  description = `Tool-Level RAG: Search the codebase using REAL VECTOR EMBEDDINGS and Cosine Similarity.
  Use this INSTEAD of reading entire files to save massive amounts of tokens.
  The tool chunks files, embeds them, and returns the top 3 mathematical semantic matches.
  Example query: "How does the API authentication work?"`;
  
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The semantic concept or question to search for' },
      path: { type: 'string', description: 'Directory to search in (relative to workspace)' },
      filePattern: { type: 'string', description: 'Glob pattern for files (e.g., "*.ts")' },
    },
    required: ['query'],
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolResult> {
    const query = input.query as string;
    const searchPath = input.path ? join(context.workspaceDir, input.path as string) : context.workspaceDir;
    const filePattern = input.filePattern as string | undefined;

    if (!existsSync(searchPath)) {
      return { success: false, output: '', error: `Path not found: ${searchPath}` };
    }

    // 1. Gather files
    const files: string[] = [];
    this.collectFiles(searchPath, context.workspaceDir, filePattern, files);

    // 2. Index files (generate embeddings if missing)
    await this.indexFiles(files, context.workspaceDir);

    // 3. Embed Query
    const queryEmbedding = await getEmbedding(query);

    // 4. Cosine Similarity Search
    const results: { chunk: VectorChunk; score: number }[] = [];
    for (const file of files) {
      const fileChunks = vectorStore.get(file) || [];
      for (const chunk of fileChunks) {
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        results.push({ chunk, score });
      }
    }

    // 5. Return Top 3 matches
    results.sort((a, b) => b.score - a.score);
    const topMatches = results.slice(0, 3);

    if (topMatches.length === 0) {
      return { success: true, output: 'No semantically relevant code found for your query.' };
    }

    const outputLines = [
      `🔍 True Vector RAG Results for: "${query}"`,
      `Returned top ${topMatches.length} mathematically closest snippets via Cosine Similarity.\n`
    ];

    for (const [i, match] of topMatches.entries()) {
      outputLines.push(`--- Match ${i + 1} | File: ${match.chunk.file} (Lines ${match.chunk.startLine}-${match.chunk.endLine}) | Similarity: ${(match.score * 100).toFixed(1)}% ---`);
      outputLines.push(match.chunk.content);
      outputLines.push('');
    }

    return { success: true, output: outputLines.join('\n') };
  }

  // ── Helpers ──

  private collectFiles(dir: string, root: string, pattern: string | undefined, out: string[]): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'artifacts') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      
      if (stat.isDirectory()) {
        this.collectFiles(full, root, pattern, out);
      } else if (stat.isFile() && stat.size < 500 * 1024) { 
        if (pattern && !this.matchGlob(entry, pattern)) continue;
        out.push(relative(root, full));
      }
    }
  }

  private matchGlob(filename: string, pattern: string): boolean {
    const ext = pattern.replace('*', '');
    return filename.endsWith(ext);
  }

  private async indexFiles(files: string[], root: string): Promise<void> {
    for (const file of files) {
      if (vectorStore.has(file)) continue; // Already indexed
      
      const fullPath = join(root, file);
      const content = readFileSync(fullPath, 'utf-8');
      
      const rawChunks = content.split(/\n\s*\n/);
      const chunks: VectorChunk[] = [];
      let startLine = 1;

      for (const rc of rawChunks) {
        const lines = rc.split('\n').length;
        const endLine = startLine + lines - 1;
        const chunkText = rc.trim();
        
        if (chunkText.length > 50) { 
          // Generate embedding for chunk
          const embedding = await getEmbedding(`File: ${file}\n\n${chunkText}`);
          chunks.push({
            file,
            startLine,
            endLine,
            content: chunkText,
            embedding
          });
        }
        startLine = endLine + 2;
      }
      
      vectorStore.set(file, chunks);
    }
  }
}
