import { knowledgeChunks, type KnowledgeChunk } from "./knowledgeData";

// Local keyword-based search — fallback when Azure AI Search is unavailable
// Implements a simple TF-style scoring over the pre-chunked knowledge corpus

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: string[]): number {
  const chunkTokens = tokenize(chunk.content);
  const chunkSet = new Set(chunkTokens);
  let score = 0;
  for (const qt of queryTokens) {
    if (chunkSet.has(qt)) {
      score += 1;
      // Boost for rule ID matches
      if (chunk.ruleIds.includes(qt.toUpperCase())) score += 3;
    }
  }
  // Normalize by chunk length to avoid bias toward long chunks
  return score / Math.sqrt(chunkTokens.length);
}

export interface LocalSearchResult {
  chunk: KnowledgeChunk;
  score: number;
}

export function localSearch(
  query: string,
  options: { documentType?: string; policyCode?: string; ruleId?: string; topK?: number } = {}
): LocalSearchResult[] {
  const { documentType, policyCode, ruleId, topK = 5 } = options;
  const queryTokens = tokenize(query);

  let candidates = knowledgeChunks;

  // Filter by document type
  if (documentType) {
    candidates = candidates.filter((c) => c.documentType === documentType);
  }
  // Filter by policy code
  if (policyCode) {
    candidates = candidates.filter(
      (c) => c.policyCode === null || c.policyCode === policyCode
    );
  }
  // Filter by rule ID (exact match mode)
  if (ruleId) {
    candidates = candidates.filter((c) => c.ruleIds.includes(ruleId));
  }

  // Score and rank
  const scored = candidates
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export function retrieveByRuleId(ruleId: string): KnowledgeChunk[] {
  return knowledgeChunks.filter((c) => c.ruleIds.includes(ruleId));
}
