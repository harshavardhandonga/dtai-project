import { azureConfig, isSearchConfigured } from "./config";
import { createEmbedding } from "./openai";
import type { KnowledgeChunk } from "../rag/knowledgeData";
import type { LocalSearchResult } from "../rag/localSearch";

const API_VERSION = "2026-04-01";

export interface SearchOptions {
  documentType?: string;
  policyCode?: string;
  ruleId?: string;
  topK?: number;
}

export interface AzureSearchResponse {
  results: LocalSearchResult[];
  mode: "AZURE_HYBRID" | "AZURE_KEYWORD";
}

function quote(value: string): string {
  return value.replace(/'/g, "''");
}

function buildFilter(options: SearchOptions): string | undefined {
  const filters: string[] = [];
  if (options.documentType) {
    filters.push(`documentType eq '${quote(options.documentType)}'`);
  }
  if (options.policyCode) {
    filters.push(`policyCode eq '${quote(options.policyCode)}'`);
  }
  if (options.ruleId) {
    filters.push(`ruleIds/any(rule: rule eq '${quote(options.ruleId)}')`);
  }
  return filters.length > 0 ? filters.join(" and ") : undefined;
}

export async function azureSearch(
  query: string,
  options: SearchOptions = {}
): Promise<AzureSearchResponse> {
  if (!isSearchConfigured()) throw new Error("Azure AI Search is not configured");

  const topK = options.topK ?? 5;
  let vector: number[] | undefined;
  try {
    vector = await createEmbedding(query);
  } catch (error) {
    console.error("[ClaimIQ] Query embedding unavailable; using Azure keyword search:", error);
  }

  const body: Record<string, unknown> = {
    search: query,
    top: topK,
    queryType: "simple",
    select: "id,documentCode,documentType,policyCode,sectionTitle,pageNumber,ruleIds,content",
  };
  const filter = buildFilter(options);
  if (filter) body.filter = filter;
  if (vector) {
    body.vectorQueries = [{
      kind: "vector",
      vector,
      fields: "contentVector",
      k: topK,
    }];
  }

  const url = `${azureConfig.searchEndpoint}/indexes/${encodeURIComponent(azureConfig.searchIndex)}/docs/search?api-version=${API_VERSION}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.searchKey!,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 800);
    throw new Error(`Azure AI Search failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const values: any[] = Array.isArray(payload.value) ? payload.value : [];
  const results = values
    .map((document, index): LocalSearchResult | null => {
      const content = String(document.content ?? document.text ?? "").trim();
      if (!content) return null;
      const chunk: KnowledgeChunk = {
        id: String(document.id ?? `az-${index}`),
        documentCode: String(document.documentCode ?? ""),
        documentType: document.documentType === "claims_sop" ? "claims_sop" : "motor_policy",
        policyCode: document.policyCode ? String(document.policyCode) : null,
        sectionTitle: String(document.sectionTitle ?? ""),
        pageNumber: Number(document.pageNumber ?? 0) || 0,
        ruleIds: Array.isArray(document.ruleIds) ? document.ruleIds.map(String) : [],
        content,
      };
      return {
        chunk,
        score: Number(document["@search.score"] ?? 1 - index * 0.1),
      };
    })
    .filter((result): result is LocalSearchResult => result !== null);

  return {
    results,
    mode: vector ? "AZURE_HYBRID" : "AZURE_KEYWORD",
  };
}
