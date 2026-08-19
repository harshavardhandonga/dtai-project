import { azureConfig } from "./config";
import type {
  StructuredClaim,
  SemanticReviewResult,
  RepairLineItem,
  MissingItem,
  DemoClaim,
} from "@/lib/types";

// Azure OpenAI chat completions (deployment-based, API key auth).
const API_VERSION = "2024-02-15-preview";

const MATERIALS = ["metal", "plastic", "glass", "fiberglass", "rubber", "electrical", "mechanical", "paint", "unknown"];
const CATEGORIES = ["part", "labour", "paint", "other"];
const ACTIONS = ["repair", "replace", "paint", "inspect", "unknown"];
const CONFIDENCES = ["high", "medium", "low"];
const CLASSIFICATIONS = ["CONSISTENT", "POSSIBLY_CONSISTENT", "REQUIRES_VERIFICATION", "INCONSISTENT_WITH_DESCRIPTION"];

function chatUrl(): string {
  return `${azureConfig.openaiEndpoint}/openai/deployments/${azureConfig.chatDeployment}/chat/completions?api-version=${API_VERSION}`;
}

// Lightweight reachability probe so the analyze route doesn't waste a slow
// Document Intelligence call when the OpenAI endpoint is down. A dead host
// returns an HTML 404; a live Azure endpoint always responds with JSON.
let reachableCache: boolean | null = null;
let reachableAt = 0;

export async function isOpenAiReachable(): Promise<boolean> {
  if (!azureConfig.openaiKey || !azureConfig.openaiEndpoint) return false;
  if (reachableCache !== null && Date.now() - reachableAt < 60000) return reachableCache;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `${azureConfig.openaiEndpoint}/openai/models?api-version=2024-06-01`,
      { headers: { "api-key": azureConfig.openaiKey! }, signal: ctrl.signal }
    );
    clearTimeout(timeout);
    const ct = res.headers.get("content-type") || "";
    reachableCache = ct.includes("json");
  } catch {
    reachableCache = false;
  }
  reachableAt = Date.now();
  return reachableCache;
}

const num = (v: any): number => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "0").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function coerceEnum<T extends string>(val: any, allowed: string[], fallback: T): T {
  const v = String(val ?? "").toLowerCase();
  return (allowed.includes(v) ? v : fallback) as T;
}

function coerceLineItem(raw: any, idx: number): RepairLineItem {
  return {
    id: String(raw.id || `L${idx + 1}`),
    rawDescription: String(raw.rawDescription ?? raw.description ?? ""),
    normalizedDescription: String(raw.normalizedDescription ?? raw.description ?? ""),
    quantity: raw.quantity != null ? num(raw.quantity) : 1,
    partCost: raw.partCost != null ? num(raw.partCost) : undefined,
    labourCost: raw.labourCost != null ? num(raw.labourCost) : undefined,
    paintCost: raw.paintCost != null ? num(raw.paintCost) : undefined,
    totalCost: raw.totalCost != null ? num(raw.totalCost) : undefined,
    category: coerceEnum(raw.category, CATEGORIES, "other"),
    material: coerceEnum(raw.material, MATERIALS, "unknown"),
    action: coerceEnum(raw.action, ACTIONS, "unknown"),
    vehicleLocation: raw.vehicleLocation ? String(raw.vehicleLocation) : undefined,
    sourceBlockIds: Array.isArray(raw.sourceBlockIds) ? raw.sourceBlockIds.map(String) : [],
    confidence: coerceEnum(raw.confidence, CONFIDENCES, "medium"),
  };
}

function coerceMissing(raw: any): MissingItem {
  return {
    field: String(raw.field ?? ""),
    description: String(raw.description ?? ""),
    required: !!raw.required,
  };
}

function coerceReview(raw: any, items: RepairLineItem[]): SemanticReviewResult {
  const itemId = String(raw.itemId ?? "");
  const item = items.find((i) => i.id === itemId);
  return {
    itemId: item?.id ?? itemId,
    normalizedDescription: String(raw.normalizedDescription ?? item?.normalizedDescription ?? ""),
    classification: coerceEnum(raw.classification, CLASSIFICATIONS, "REQUIRES_VERIFICATION"),
    reason: String(raw.reason ?? ""),
  };
}

const SYSTEM_PROMPT = `You are ClaimIQ's claim-structuring engine for Indian motor insurance own-damage claims.
Given the text extracted from a workshop repair estimate (by Azure Document Intelligence) and the claim context, you must produce a structured representation of the estimate and a semantic consistency review of every line item.

Return ONLY a JSON object with this exact shape:
{
  "estimate": {
    "estimateNumber": string | null,
    "partsTotal": number,
    "labourTotal": number,
    "paintTotal": number,
    "grandTotal": number
  },
  "lineItems": [
    {
      "id": "L1", "L2", ...,
      "rawDescription": string,
      "normalizedDescription": string,
      "quantity": number,
      "partCost": number,
      "labourCost": number,
      "paintCost": number,
      "totalCost": number,
      "category": one of ${JSON.stringify(CATEGORIES)},
      "material": one of ${JSON.stringify(MATERIALS)},
      "action": one of ${JSON.stringify(ACTIONS)},
      "vehicleLocation": string,
      "confidence": one of ${JSON.stringify(CONFIDENCES)}
    }
  ],
  "missingInformation": [
    { "field": string, "description": string, "required": boolean }
  ],
  "semanticReview": [
    {
      "itemId": string,  // must match a lineItems[].id
      "normalizedDescription": string,
      "classification": one of ${JSON.stringify(CLASSIFICATIONS)},
      "reason": string
    }
  ]
}

Rules:
- "category": "part" for parts/replacements, "labour" for labour-only operations, "paint" for painting, "other" otherwise.
- "material": the part's material. Use "paint" only for painting line items, "unknown" if not determinable.
- "action": "replace" for part replacement, "repair" for dent/repair, "paint" for painting, "inspect" for inspection.
- "confidence": how clearly the line was extracted from the document.
- "semanticReview.classification": judge whether each line is consistent with the accident description and primary impact location given in the context. "CONSISTENT" if it clearly matches; "POSSIBLY_CONSISTENT" if plausible; "REQUIRES_VERIFICATION" if uncertain; "INCONSISTENT_WITH_DESCRIPTION" if it contradicts the stated damage.
- Every line item MUST have a corresponding semanticReview entry.
- Estimate totals must reconcile with the line items (partsTotal = sum of partCost, labourTotal = sum of labourCost, paintTotal = sum of paintCost, grandTotal = partsTotal + labourTotal + paintTotal). If the document states a grand total, prefer it.
- Output ONLY the JSON object, no markdown, no commentary.`;

/**
 * Run the structuring + semantic-review step against Azure OpenAI.
 * claim/vehicle/garage come from the trusted claim context; only the
 * estimate, line items, missing information and semantic review are
 * produced by the model.
 */
export async function structureClaim(
  diText: string,
  context: DemoClaim["context"]
): Promise<{ structuredClaim: StructuredClaim; semanticReview: SemanticReviewResult[] }> {
  const ctxSummary = {
    vehicle: context.vehicle,
    garage: context.garage,
    claim: {
      accidentDescription: context.claim.accidentDescription,
      primaryImpactLocation: context.claim.primaryImpactLocation,
      lossDate: context.claim.lossDate,
    },
  };

  const res = await fetch(chatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": azureConfig.openaiKey!,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Claim context (JSON):\n${JSON.stringify(ctxSummary, null, 2)}\n\nDocument Intelligence extracted text from the workshop estimate:\n"""\n${diText}\n"""`,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI structuring failed (${res.status}): ${txt}`);
  }

  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned non-JSON content");
  }

  const lineItems = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map(coerceLineItem).filter((li: RepairLineItem) => li.normalizedDescription)
    : [];

  const estimate = {
    estimateNumber: parsed.estimate?.estimateNumber ? String(parsed.estimate.estimateNumber) : undefined,
    partsTotal: num(parsed.estimate?.partsTotal),
    labourTotal: num(parsed.estimate?.labourTotal),
    paintTotal: num(parsed.estimate?.paintTotal),
    grandTotal: num(parsed.estimate?.grandTotal),
  };

  const missingInformation = Array.isArray(parsed.missingInformation)
    ? parsed.missingInformation.map(coerceMissing).filter((m: MissingItem) => m.field)
    : [];

  const semanticReview = Array.isArray(parsed.semanticReview)
    ? parsed.semanticReview.map((r: any) => coerceReview(r, lineItems))
    : lineItems.map((li: RepairLineItem) => ({
        itemId: li.id,
        normalizedDescription: li.normalizedDescription,
        classification: "REQUIRES_VERIFICATION" as const,
        reason: "Auto-generated — model did not provide a review.",
      }));

  const structuredClaim: StructuredClaim = {
    claim: context.claim,
    vehicle: context.vehicle,
    garage: context.garage,
    estimate,
    lineItems,
    missingInformation,
  };

  return { structuredClaim, semanticReview };
}
