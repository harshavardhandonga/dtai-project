import { NextRequest, NextResponse } from "next/server";
import { getDemoClaim } from "@/lib/demo/claims";
import { answerQuestion, answerWithCalculation } from "@/lib/rag/retrieval";
import { calculateSettlement } from "@/lib/rules/settlementEngine";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { question, claimId } = body;

  if (!question) {
    return NextResponse.json({ error: "Question required" }, { status: 400 });
  }

  const claim = claimId ? getDemoClaim(claimId) : undefined;
  const settlement = claim ? calculateSettlement(claim) : undefined;

  const answer = settlement
    ? answerWithCalculation(question, claim!, { adjustments: settlement.adjustments })
    : answerQuestion(question, claim);

  return NextResponse.json(answer);
}
