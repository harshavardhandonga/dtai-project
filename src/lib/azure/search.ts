import { azureConfig } from "./config";
import type { KnowledgeChunk } from "../rag/knowledgeData";
import type { LocalSearchResult } from "../rag/localSearch";

// Azure AI Search — full-text retrieval over the claimiq-knowledge index.
// Falls back to local keyword search on any error (handled by the caller).
const API_VERSION = "2023-11-01";

export interface SearchOptions {
  documentType?: string;
  policyCode?: string;
  ruleId?: string;
  topK?: number;
}

export async function azureSearch(query: string, options: SearchOptions = {}): Promise<LocalSearchResult[]> {
  const url = `${azureConfig.searchEndpoint}/indexes/${azureConfig.searchIndex}/docs/search?api-version=${API_VERSION}`;
  const body: Record<string, unknown> = {
    search: query,
    top: options.topK ?? 5,
    queryType: "simple",
  };

  // Filter by document type only — reliable and avoids nullable-string filter pitfalls.
  if (options.documentType) {
    body.filter = `documentType eq '${options.documentType}'`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.searchKey!,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Azure AI Search failed (${res.status}): ${txt}`);
  }

  const data: any = await res.json();
  const values: any[] = Array.isArray(data.value) ? data.value : [];

  return values
    .map((d, i): LocalSearchResult | null => {
      const content = String(d.content ?? d.text ?? "").trim();
      if (!content) return null;
      const chunk: KnowledgeChunk = {
        id: String(d.id ?? `az-${i}`),
        documentCode: String(d.documentCode ?? ""),
        documentType: (d.documentType as KnowledgeChunk["documentType"]) || "motor_policy",
        policyCode: d.policyCode ? String(d.policyCode) : null,
        sectionTitle: String(d.sectionTitle ?? ""),
        pageNumber: Number(d.pageNumber ?? 0) || 0,
        ruleIds: Array.isArray(d.ruleIds) ? d.ruleIds.map(String) : [],
        content,
      };
      return { chunk, score: Number(d["@search.score"] ?? 1 - i * 0.1) };
    })
    .filter((r): r is LocalSearchResult => r !== null);
}
