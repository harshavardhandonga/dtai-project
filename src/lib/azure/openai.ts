import { azureConfig, isEmbeddingConfigured, isOpenAiConfigured } from "./config";
import type {
  DemoClaim,
  DocumentExtraction,
  RepairLineItem,
  SemanticReviewResult,
  StructuredClaim,
} from "@/lib/types";
import type { LocalSearchResult } from "@/lib/rag/localSearch";
import {
  claimUnderstandingJsonSchema,
  claimUnderstandingSchema,
  groundedRagJsonSchema,
  groundedRagSchema,
} from "@/lib/ai/schemas";

function openAiV1BaseUrl(): string {
  const endpoint = azureConfig.openaiEndpoint.replace(/\/+$/, "");
  if (/\/openai\/v1$/i.test(endpoint)) return endpoint;
  if (/\/openai$/i.test(endpoint)) return `${endpoint}/v1`;
  return `${endpoint}/openai/v1`;
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

async function createStructuredResponse(
  name: string,
  schema: object,
  system: string,
  user: string
): Promise<unknown> {
  if (!isOpenAiConfigured()) throw new Error("Azure OpenAI is not configured");

  const response = await fetch(`${openAiV1BaseUrl()}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.openaiKey!,
    },
    body: JSON.stringify({
      model: azureConfig.chatDeployment,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 800);
    throw new Error(`Azure OpenAI Responses request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const text = responseText(payload);
  if (!text) throw new Error("Azure OpenAI returned no structured output text");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Azure OpenAI returned invalid JSON");
  }
}

let reachableCache: boolean | null = null;
let reachableAt = 0;

export async function isOpenAiReachable(): Promise<boolean> {
  if (!isOpenAiConfigured()) return false;
  if (reachableCache !== null && Date.now() - reachableAt < 60_000) return reachableCache;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${openAiV1BaseUrl()}/models`, {
      headers: { "api-key": azureConfig.openaiKey! },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    reachableCache = response.ok && response.headers.get("content-type")?.includes("json") === true;
  } catch {
    reachableCache = false;
  }

  reachableAt = Date.now();
  return reachableCache;
}

const CLAIM_SYSTEM_PROMPT = `You support motor insurance document interpretation.
Use only the supplied Azure Document Intelligence source blocks.
Never invent missing information or document coordinates.
Normalize repair terminology conservatively.
Map every extracted line item to the sourceBlockIds that support it.
Classify uncertain material as "unknown" and reduce confidence when evidence is weak.
Do not calculate settlement, approve, reject, or infer fraud.
For semantic review, a mismatch is a review signal only.
Return the required structured schema only.`;

function toLineItem(
  raw: ReturnType<typeof claimUnderstandingSchema.parse>["lineItems"][number],
  validBlockIds: Set<string>
): RepairLineItem {
  const sourceBlockIds = raw.sourceBlockIds.filter((id) => validBlockIds.has(id));
  return {
    ...raw,
    quantity: raw.quantity ?? undefined,
    partCost: raw.partCost ?? undefined,
    labourCost: raw.labourCost ?? undefined,
    paintCost: raw.paintCost ?? undefined,
    totalCost: raw.totalCost ?? undefined,
    vehicleLocation: raw.vehicleLocation ?? undefined,
    sourceBlockIds,
    confidence: sourceBlockIds.length > 0 ? raw.confidence : "low",
  };
}

export async function structureClaim(
  extraction: DocumentExtraction,
  context: DemoClaim["context"]
): Promise<{ structuredClaim: StructuredClaim; semanticReview: SemanticReviewResult[] }> {
  const compactBlocks = extraction.sourceBlocks.map((block) => ({
    blockId: block.blockId,
    pageNumber: block.pageNumber,
    type: block.type,
    text: block.text,
  }));
  const userPrompt = `Claim context:
${JSON.stringify({
  claim: {
    accidentDescription: context.claim.accidentDescription,
    primaryImpactLocation: context.claim.primaryImpactLocation,
    lossDate: context.claim.lossDate,
  },
  vehicle: context.vehicle,
  garage: context.garage,
}, null, 2)}

Document source blocks:
${JSON.stringify(compactBlocks)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createStructuredResponse(
        "claimiq_claim_understanding",
        claimUnderstandingJsonSchema,
        CLAIM_SYSTEM_PROMPT,
        attempt === 0
          ? userPrompt
          : `${userPrompt}\n\nValidation retry: follow the schema exactly and ensure every semantic itemId matches a returned line item.`
      );
      const parsed = claimUnderstandingSchema.parse(raw);
      const validBlockIds = new Set(extraction.sourceBlocks.map((block) => block.blockId));
      const lineItems = parsed.lineItems.map((item) => toLineItem(item, validBlockIds));
      const lineIds = new Set(lineItems.map((item) => item.id));
      const suppliedReviews = parsed.semanticReview
        .filter((review) => lineIds.has(review.itemId))
        .map((review) => ({ ...review }));
      const reviewedIds = new Set(suppliedReviews.map((review) => review.itemId));
      const semanticReview: SemanticReviewResult[] = [
        ...suppliedReviews,
        ...lineItems
          .filter((item) => !reviewedIds.has(item.id))
          .map((item) => ({
            itemId: item.id,
            normalizedDescription: item.normalizedDescription,
            classification: "REQUIRES_VERIFICATION" as const,
            reason: "The model did not return a semantic review for this extracted line.",
          })),
      ];

      return {
        structuredClaim: {
          claim: context.claim,
          vehicle: context.vehicle,
          garage: context.garage,
          estimate: {
            ...parsed.estimate,
            estimateNumber: parsed.estimate.estimateNumber ?? undefined,
          },
          lineItems,
          missingInformation: parsed.missingInformation,
        },
        semanticReview,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Azure OpenAI structured output validation failed");
}

export async function createEmbedding(input: string): Promise<number[]> {
  if (!isEmbeddingConfigured()) throw new Error("Azure OpenAI embeddings are not configured");
  const response = await fetch(`${openAiV1BaseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.openaiKey!,
    },
    body: JSON.stringify({
      model: azureConfig.embeddingDeployment,
      input,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Azure OpenAI embedding request failed (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Azure OpenAI returned no embedding vector");
  }
  return vector.map(Number);
}

const RAG_SYSTEM_PROMPT = `Answer using only the supplied policy or SOP excerpts.
Do not use general insurance knowledge and do not invent rules.
Keep the answer concise and distinguish policy rules, SOP rules, calculations, and AI interpretation.
If the excerpts are insufficient, state that human review is required.
Return only the required structured schema and include only chunk IDs that directly support the answer.`;

export async function generateGroundedRagAnswer(
  question: string,
  results: LocalSearchResult[]
): Promise<{ answer: string; usedChunkIds: string[] }> {
  const raw = await createStructuredResponse(
    "claimiq_grounded_rag_answer",
    groundedRagJsonSchema,
    RAG_SYSTEM_PROMPT,
    JSON.stringify({
      question,
      excerpts: results.map(({ chunk }) => ({
        chunkId: chunk.id,
        documentCode: chunk.documentCode,
        pageNumber: chunk.pageNumber,
        ruleIds: chunk.ruleIds,
        content: chunk.content,
      })),
    })
  );
  const parsed = groundedRagSchema.parse(raw);
  const validIds = new Set(results.map((result) => result.chunk.id));
  return {
    answer: parsed.answer,
    usedChunkIds: parsed.usedChunkIds.filter((id) => validIds.has(id)),
  };
}
