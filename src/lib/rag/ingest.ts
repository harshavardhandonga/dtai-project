// RAG Knowledge Ingestion Pipeline
// One-time pipeline: chunk → embed (Azure OpenAI) → create index → upload to Azure AI Search
// Per PRD §71: "PDF → Azure Document Intelligence → section-aware text → Chunking →
//   Azure OpenAI Embeddings → Azure AI Search"
// The text was already extracted from the PDFs into knowledgeData.ts; this
// pipeline re-chunks it section/clause-aware and indexes it.

import { azureConfig } from "@/lib/azure/config";
import { generateEmbeddingsBatch, isEmbeddingsReachable } from "@/lib/azure/embeddings";
import { chunkKnowledge } from "@/lib/rag/chunker";
import type { KnowledgeChunk } from "@/lib/rag/knowledgeData";

const SEARCH_API_VERSION = "2024-07-01";
// text-embedding-3-small produces 1536-dimensional vectors.
const EMBEDDING_DIMS = 1536;

export interface IngestionResult {
  success: boolean;
  chunksProcessed: number;
  vectorsGenerated: boolean;
  indexCreated: boolean;
  error?: string;
}

function indexUrl(): string {
  return `${azureConfig.searchEndpoint}/indexes/${azureConfig.searchIndex}?api-version=${SEARCH_API_VERSION}`;
}

function docsUrl(): string {
  return `${azureConfig.searchEndpoint}/indexes/${azureConfig.searchIndex}/docs/index?api-version=${SEARCH_API_VERSION}`;
}

/**
 * Create the Azure AI Search index with the PRD §73 KnowledgeChunk schema,
 * including a vector field for hybrid retrieval.
 */
async function createIndex(): Promise<void> {
  const indexDef = {
    name: azureConfig.searchIndex,
    fields: [
      { name: "id", type: "Edm.String", key: true, searchable: false, filterable: false },
      { name: "documentCode", type: "Edm.String", searchable: true, filterable: true, facetable: false },
      { name: "documentVersion", type: "Edm.String", searchable: false, filterable: false },
      { name: "documentType", type: "Edm.String", searchable: true, filterable: true, facetable: false },
      { name: "policyCode", type: "Edm.String", searchable: true, filterable: true, facetable: false },
      { name: "sectionTitle", type: "Edm.String", searchable: true, filterable: false },
      { name: "clauseNumber", type: "Edm.String", searchable: true, filterable: true, facetable: false },
      { name: "pageNumber", type: "Edm.Int32", searchable: false, filterable: true, facetable: false },
      { name: "ruleIds", type: "Collection(Edm.String)", searchable: true, filterable: true, facetable: false },
      { name: "content", type: "Edm.String", searchable: true, filterable: false, sortable: false },
      {
        name: "contentVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        stored: false,
        dimensions: EMBEDDING_DIMS,
        vectorSearchProfile: "vector-profile",
      },
    ],
    vectorSearch: {
      profiles: [
        {
          name: "vector-profile",
          algorithm: "vector-algo",
        },
      ],
      algorithms: [
        {
          name: "vector-algo",
          kind: "hnsw",
        },
      ],
    },
    semantic: {
      configurations: [
        {
          name: "semantic-config",
          prioritizedFields: {
            titleField: { name: "sectionTitle" },
            prioritizedContentFields: [{ name: "content" }],
            prioritizedKeywordsFields: [{ name: "ruleIds" }],
          },
        },
      ],
    },
  };

  const res = await fetch(indexUrl(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.searchAdminKey || azureConfig.searchKey!,
    },
    body: JSON.stringify(indexDef),
  });

  if (!res.ok && res.status !== 409) {
    // 409 = index already exists, which is fine for re-ingestion
    const txt = await res.text().catch(() => "");
    throw new Error(`Index creation failed (${res.status}): ${txt.substring(0, 300)}`);
  }
}

/**
 * Upload documents to the Azure AI Search index in batches.
 */
async function uploadDocuments(
  chunks: KnowledgeChunk[],
  vectors: number[][] | null
): Promise<void> {
  const BATCH_SIZE = 50;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const documents = batch.map((chunk, j) => {
      const doc: Record<string, unknown> = {
        "@search.action": "mergeOrUpload",
        id: chunk.id,
        documentCode: chunk.documentCode,
        documentVersion: chunk.documentVersion || "1.0",
        documentType: chunk.documentType,
        policyCode: chunk.policyCode || "",
        sectionTitle: chunk.sectionTitle,
        clauseNumber: chunk.clauseNumber || "",
        pageNumber: chunk.pageNumber,
        ruleIds: chunk.ruleIds,
        content: chunk.content,
      };
      if (vectors && vectors[i + j]) {
        doc.contentVector = vectors[i + j];
      }
      return doc;
    });

    const res = await fetch(docsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureConfig.searchAdminKey || azureConfig.searchKey!,
      },
      body: JSON.stringify({ value: documents }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Document upload failed (${res.status}): ${txt.substring(0, 300)}`);
    }
  }
}

/**
 * Run the full ingestion pipeline:
 * 1. Re-chunk knowledge data (section/clause-aware)
 * 2. Generate embeddings via Azure OpenAI (if available)
 * 3. Create the Azure AI Search index
 * 4. Upload all chunks with vectors
 *
 * If Azure OpenAI is unreachable, the index is still created and populated
 * with text-only chunks (full-text search works; vector search won't until
 * embeddings are backfilled).
 */
export async function ingestKnowledge(): Promise<IngestionResult> {
  try {
    // 1. Chunk
    const chunks = chunkKnowledge();

    // 2. Embed (if Azure OpenAI is reachable)
    let vectors: number[][] | null = null;
    let vectorsGenerated = false;

    const embeddingsAvailable = await isEmbeddingsReachable();
    if (embeddingsAvailable) {
      try {
        const texts = chunks.map((c) => c.content);
        vectors = await generateEmbeddingsBatch(texts);
        vectorsGenerated = true;
      } catch (err) {
        console.error("[ClaimIQ] Embedding generation failed, continuing without vectors:", err);
      }
    }

    // 3. Create index
    await createIndex();

    // 4. Upload
    await uploadDocuments(chunks, vectors);

    return {
      success: true,
      chunksProcessed: chunks.length,
      vectorsGenerated,
      indexCreated: true,
    };
  } catch (err) {
    return {
      success: false,
      chunksProcessed: 0,
      vectorsGenerated: false,
      indexCreated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
