import { NextRequest, NextResponse } from "next/server";
import { getDemoClaim } from "@/lib/demo/claims";
import { answerQuestion, answerWithCalculation } from "@/lib/rag/retrieval";
import { calculateSettlement } from "@/lib/rules/settlementEngine";
import { applyPolicyVariant } from "@/lib/demo/policyVariants";
import { z } from "zod";

const requestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  claimId: z.string().optional(),
  policyCode: z.enum(["AD-COMP-01", "AD-ELITE-02"]).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Question required" }, { status: 400 });
  }
  const { question, claimId, policyCode } = parsed.data;

  const storedClaim = claimId ? getDemoClaim(claimId) : undefined;
  const claim = storedClaim ? applyPolicyVariant(storedClaim, policyCode) : undefined;
  const settlement = claim ? calculateSettlement(claim) : undefined;

  const answer = settlement
    ? await answerWithCalculation(question, claim!, { adjustments: settlement.adjustments })
    : await answerQuestion(question, claim);

  return NextResponse.json(answer);
}
