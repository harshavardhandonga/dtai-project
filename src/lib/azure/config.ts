// Azure AI service configuration for ClaimIQ live mode.
// Endpoints are non-secret URLs (repo defaults); API keys are delivered
// securely by the Base44 platform to /run/base44/app.env and never live in git.

function norm(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

export const azureConfig = {
  diEndpoint: norm(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT),
  diKey: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
  openaiEndpoint: norm(process.env.AZURE_OPENAI_ENDPOINT),
  openaiKey: process.env.AZURE_OPENAI_API_KEY,
  chatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || "claimiq-chat",
  embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "claimiq-embedding",
  searchEndpoint: norm(process.env.AZURE_SEARCH_ENDPOINT),
  // Query key for read-only retrieval; admin key for index creation + uploads.
  searchKey: process.env.AZURE_SEARCH_QUERY_KEY || process.env.AZURE_SEARCH_ADMIN_KEY,
  searchAdminKey: process.env.AZURE_SEARCH_ADMIN_KEY,
  searchIndex: process.env.AZURE_SEARCH_INDEX || "claimiq-knowledge",
};

/**
 * Live AI mode is active whenever the Azure OpenAI key is present.
 * Without credentials the app transparently falls back to cached demo
 * responses, so the workbench always renders.
 */
export function isLiveMode(): boolean {
  return !!azureConfig.openaiKey;
}
