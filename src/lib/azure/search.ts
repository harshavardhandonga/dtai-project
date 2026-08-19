import { azureConfig } from "./config";
import { generateEmbedding, isEmbeddingsReachable } from "./embeddings";
import type { KnowledgeChunk } from "../rag/knowledgeData";
import type { LocalSearchResult } from "../rag/localSearch";

// Azure AI Search — hybrid (keyword + vector) retrieval over the
// claimiq-knowledge index. Falls back to local keyword search on any error
// (handled by the caller in retrieval.ts).
const API_VERSION = "2024-07-01";

export interface SearchOptions {
  documentType?: string;
  policyCode?: string;
  ruleId?: string;
  topK?: number;
}

function searchUrl(): string {
  return `${azureConfig.searchEndpoint}/indexes/${azureConfig.searchIndex}/docs/search?api-version=${API_VERSION}`;
}

function buildFilter(options: SearchOptions): string | undefined {
  const filters: string[] = [];
  if (options.documentType) {
    filters.push(`documentType eq '${options.documentType}'`);
  }
  if (options.policyCode) {
    filters.push(`(policyCode eq '' or policyCode eq '${options.policyCode}')`);
  }
  if (options.ruleId) {
    filters.push(`ruleIds/any(r: r eq '${options.ruleId}')`);
  }
  return filters.length > 0 ? filters.join(" and ") : undefined;
}

function mapResults(values: any[]): LocalSearchResult[] {
  return values
    .map((d, i): LocalSearchResult | null => {
      const content = String(d.content ?? d.text ?? "").trim();
      if (!content) return null;
      const chunk: KnowledgeChunk = {
        id: String(d.id ?? `az-${i}`),
        documentCode: String(d.documentCode ?? ""),
        documentVersion: String(d.documentVersion ?? "1.0"),
        documentType: (d.documentType as KnowledgeChunk["documentType"]) || "motor_policy",
        policyCode: d.policyCode ? String(d.policyCode) : null,
        sectionTitle: String(d.sectionTitle ?? ""),
        clauseNumber: d.clauseNumber ? String(d.clauseNumber) : undefined,
        pageNumber: Number(d.pageNumber ?? 0) || 0,
        ruleIds: Array.isArray(d.ruleIds) ? d.ruleIds.map(String) : [],
        content,
      };
      return { chunk, score: Number(d["@search.score"] ?? 1 - i * 0.1) };
    })
    .filter((r): r is LocalSearchResult => r !== null);
}

/**
 * Hybrid keyword + vector search against Azure AI Search.
 * Per PRD §74: "Use: Hybrid keyword + vector retrieval".
 * If the embeddings endpoint is unavailable, falls back to full-text-only.
 */
export async function azureSearch(
  query: string,
  options: SearchOptions = {}
): Promise<LocalSearchResult[]> {
  const filter = buildFilter(options);
  const top = options.topK ?? 5;

  const body: Record<string, unknown> = {
    search: query,
    top,
    queryType: "simple",
  };
  if (filter) body.filter = filter;

  // Attempt vector search if embeddings are available
  const embeddingsAvailable = await isEmbeddingsReachable();
  if (embeddingsAvailable) {
    try {
      const queryVector = await generateEmbedding(query);
      body.vectorQueries = [{ vector: queryVector, k: top, fields: "contentVector" }];
      body.select = ["id", "documentCode", "documentVersion", "documentType", "policyCode",
        "sectionTitle", "clauseNumber", "pageNumber", "ruleIds", "content"].join(", ");
    } catch (err) {
      console.error("[ClaimIQ] Query embedding failed, using text-only search:", err);
    }
  }

  const res = await fetch(searchUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.searchKey!,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Azure AI Search failed (${res.status}): ${txt.substring(0, 200)}`);
  }

  const data: any = await res.json();
  const values: any[] = Array.isArray(data.value) ? data.value : [];
  return mapResults(values);
}

/**
 * Retrieve chunks by exact rule ID (PRD §74 Mode B — application explanation).
 * Uses a filter on the ruleIds collection for precise rule-based lookup.
 */
export async function azureSearchByRuleId(
  ruleId: string,
  options: { documentType?: string; topK?: number } = {}
): Promise<LocalSearchResult[]> {
  return azureSearch("*", {
    ...options,
    ruleId,
    topK: options.topK ?? 3,
  });
}
