import { NextRequest, NextResponse } from "next/server";
import { getDemoClaim } from "@/lib/demo/claims";
import { analyzeClaim } from "@/lib/analysis";
import { isLiveMode } from "@/lib/azure/config";
import { readDemoEstimate } from "@/lib/demo/demoData";
import { extractDocument } from "@/lib/azure/documentIntelligence";
import { structureClaim } from "@/lib/azure/openai";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const claimId = body.claimId;
  const baseClaim = getDemoClaim(claimId);

  if (!baseClaim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  let claim = baseClaim;

  // Live Azure AI: extract the estimate with Document Intelligence, then
  // structure it (line items + semantic review) with Azure OpenAI. The trusted
  // claim context (policy, vehicle, garage) is reused; only the AI-derived
  // fields are replaced. On any failure we fall back to the cached demo claim
  // so the workbench always renders.
  if (isLiveMode()) {
    try {
      const estimateBuffer = readDemoEstimate(claimId);
      if (estimateBuffer) {
        const diText = await extractDocument(estimateBuffer);
        const { structuredClaim, semanticReview } = await structureClaim(diText, baseClaim.context);
        claim = { ...baseClaim, structuredClaim, semanticReview, aiMode: "LIVE" };
      }
    } catch (err) {
      console.error("[ClaimIQ] Live Azure AI failed, falling back to demo claim:", err);
    }
  }

  const analysis = analyzeClaim(claim);
  return NextResponse.json(analysis);
}
