import { NextRequest, NextResponse } from "next/server";
import { getDemoClaim } from "@/lib/demo/claims";
import { analyzeClaim } from "@/lib/analysis";
import {
  isDocumentIntelligenceConfigured,
  isLiveMode,
  isOpenAiConfigured,
} from "@/lib/azure/config";
import { readDemoEstimate } from "@/lib/demo/demoData";
import { extractDocument } from "@/lib/azure/documentIntelligence";
import { structureClaim, isOpenAiReachable } from "@/lib/azure/openai";
import { getDemoDocumentExtraction } from "@/lib/demo/sourceBlocks";
import { applyPolicyVariant } from "@/lib/demo/policyVariants";
import { z } from "zod";
import type { DemoClaim, PipelineStatus } from "@/lib/types";

const requestSchema = z.object({
  claimId: z.string().min(1),
  policyCode: z.enum(["AD-COMP-01", "AD-ELITE-02"]).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid claimId is required" }, { status: 400 });
  }
  const { claimId, policyCode } = parsed.data;
  const storedClaim = getDemoClaim(claimId);

  if (!storedClaim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const baseClaim = applyPolicyVariant(storedClaim, policyCode);
  let claim: DemoClaim = {
    ...baseClaim,
    documentExtraction: getDemoDocumentExtraction(baseClaim),
  };
  let pipeline: PipelineStatus = {
    mode: "DEMO",
    documentIntelligence: "cached",
    claimUnderstanding: "cached",
    message: "Cached demo evidence is active; deterministic settlement and routing are fully live.",
  };

  // Live Azure AI: extract the estimate with Document Intelligence, then
  // structure it (line items + semantic review) with Azure OpenAI. The trusted
  // claim context (policy, vehicle, garage) is reused; only the AI-derived
  // fields are replaced. On any failure we fall back to the cached demo claim
  // so the workbench always renders.
  if (isLiveMode() && isDocumentIntelligenceConfigured() && isOpenAiConfigured() && (await isOpenAiReachable())) {
    try {
      const estimateBuffer = readDemoEstimate(claimId);
      if (estimateBuffer) {
        const extraction = await extractDocument(estimateBuffer, "image/png");
        const { structuredClaim, semanticReview } = await structureClaim(extraction, baseClaim.context);
        claim = { ...baseClaim, structuredClaim, semanticReview, documentExtraction: extraction, aiMode: "LIVE" };
        pipeline = {
          mode: "LIVE",
          documentIntelligence: "live",
          claimUnderstanding: "live",
          message: "Live Azure Document Intelligence and Azure OpenAI Responses processing completed.",
        };
      }
    } catch (err) {
      console.error("[ClaimIQ] Live Azure AI failed, falling back to demo claim:", err);
      pipeline.message = "Live Azure processing was unavailable; cached claim interpretation was used safely.";
    }
  } else if (isLiveMode()) {
    pipeline.message = "Azure credentials were detected, but the complete live pipeline is unavailable; cached claim interpretation was used.";
  }

  const analysis = analyzeClaim(claim, pipeline);
  return NextResponse.json(analysis);
}
