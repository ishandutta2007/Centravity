import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from '../config/index.js';

let genAI: GoogleGenerativeAI | null = null;

export async function getEmbedding(text: string): Promise<number[]> {
  const config = getConfig();
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required for embedding generation.');
  }
  
  if (!genAI) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }

  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
