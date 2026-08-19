import { NextRequest, NextResponse } from "next/server";
import { ingestKnowledge } from "@/lib/rag/ingest";

// POST /api/rag/ingest — runs the one-time knowledge ingestion pipeline.
// Chunks the knowledge corpus, generates embeddings (if Azure OpenAI is
// available), creates the Azure AI Search index, and uploads all documents.
export async function POST(_req: NextRequest) {
  const result = await ingestKnowledge();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
