import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDemoClaim } from "@/lib/demo/claims";
import { applyPolicyVariant } from "@/lib/demo/policyVariants";
import { extractDocument } from "@/lib/azure/documentIntelligence";
import { isOpenAiReachable, structureClaim } from "@/lib/azure/openai";
import {
  isDocumentIntelligenceConfigured,
  isOpenAiConfigured,
} from "@/lib/azure/config";
import { analyzeClaim } from "@/lib/analysis";
import type { DemoClaim, PipelineStatus } from "@/lib/types";

const fieldsSchema = z.object({
  claimId: z.enum(["CLM-CRETA-001", "CLM-HCITY-002", "CLM-BMW-003"]),
  policyCode: z.enum(["AD-COMP-01", "AD-ELITE-02"]),
});

const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);
const maxFileSize = 3 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!isDocumentIntelligenceConfigured() || !isOpenAiConfigured() || !(await isOpenAiReachable())) {
    return NextResponse.json(
      {
        error: "Custom document analysis requires working Azure Document Intelligence and Azure OpenAI credentials. The three cached demo claims remain available.",
      },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const parsed = fieldsSchema.safeParse({
    claimId: form.get("claimId"),
    policyCode: form.get("policyCode"),
  });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json({ error: "A file, claim context, and policy are required." }, { status: 400 });
  }
  if (!allowedTypes.has(file.type)) {
    return NextResponse.json({ error: "Upload a PDF, PNG, JPG, or JPEG document." }, { status: 415 });
  }
  if (file.size === 0 || file.size > maxFileSize) {
    return NextResponse.json({ error: "The document must be between 1 byte and 3 MB." }, { status: 413 });
  }

  const storedClaim = getDemoClaim(parsed.data.claimId);
  if (!storedClaim) {
    return NextResponse.json({ error: "Synthetic claim context not found." }, { status: 404 });
  }

  try {
    const baseClaim = applyPolicyVariant(storedClaim, parsed.data.policyCode);
    const extraction = await extractDocument(
      Buffer.from(await file.arrayBuffer()),
      file.type
    );
    const { structuredClaim, semanticReview } = await structureClaim(extraction, baseClaim.context);
    const claim: DemoClaim = {
      ...baseClaim,
      structuredClaim,
      semanticReview,
      documentExtraction: extraction,
      aiMode: "LIVE",
    };
    const pipeline: PipelineStatus = {
      mode: "LIVE",
      documentIntelligence: "live",
      claimUnderstanding: "live",
      message: "The uploaded document was processed live using the selected synthetic claim context.",
    };
    return NextResponse.json(analyzeClaim(claim, pipeline));
  } catch (error) {
    console.error("[ClaimIQ] Uploaded document analysis failed:", error);
    return NextResponse.json(
      { error: "The live document pipeline could not complete. Retry the upload or use a cached demo claim." },
      { status: 502 }
    );
  }
}

