// Azure OpenAI Embeddings client — text-embedding-3-small via deployment-based API.
// Used for knowledge-index ingestion (chunk vectors) and runtime query embedding
// for hybrid vector retrieval in Azure AI Search.

import { azureConfig } from "./config";

const API_VERSION = "2024-02-15-preview";

function embeddingsUrl(): string {
  return `${azureConfig.openaiEndpoint}/openai/deployments/${azureConfig.embeddingDeployment}/embeddings?api-version=${API_VERSION}`;
}

/**
 * Generate an embedding vector for a single text input.
 * Returns a Float32 array (1536 dims for text-embedding-3-small).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(embeddingsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.openaiKey!,
    },
    body: JSON.stringify({ input: text }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Embeddings request failed (${res.status}): ${txt.substring(0, 200)}`);
  }

  const data: any = await res.json();
  const vector: number[] = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embeddings response missing vector data");
  }
  return vector;
}

/**
 * Generate embeddings for multiple texts in a single request (batch).
 * Azure OpenAI accepts up to 16 inputs per call for text-embedding-3-small.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 16;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(embeddingsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureConfig.openaiKey!,
      },
      body: JSON.stringify({ input: batch }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Batch embeddings failed (${res.status}): ${txt.substring(0, 200)}`);
    }

    const data: any = await res.json();
    const vectors: number[][] = (data?.data || [])
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);

    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} vectors, got ${vectors.length}`);
    }
    results.push(...vectors);
  }

  return results;
}

/**
 * Check whether the embeddings endpoint is reachable and returns JSON.
 * Mirrors the reachability probe pattern used for the chat endpoint.
 */
let embReachableCache: boolean | null = null;
let embReachableAt = 0;

export async function isEmbeddingsReachable(): Promise<boolean> {
  if (!azureConfig.openaiKey || !azureConfig.openaiEndpoint) return false;
  if (embReachableCache !== null && Date.now() - embReachableAt < 60000) return embReachableCache;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `${azureConfig.openaiEndpoint}/openai/models?api-version=2024-06-01`,
      { headers: { "api-key": azureConfig.openaiKey! }, signal: ctrl.signal }
    );
    clearTimeout(timeout);
    const ct = res.headers.get("content-type") || "";
    embReachableCache = ct.includes("json");
  } catch {
    embReachableCache = false;
  }
  embReachableAt = Date.now();
  return embReachableCache;
}
