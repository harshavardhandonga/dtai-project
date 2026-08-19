import { NextRequest, NextResponse } from "next/server";
import { getDemoClaim } from "@/lib/demo/claims";
import { analyzeClaim } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const claimId = body.claimId;
  const claim = getDemoClaim(claimId);

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const analysis = analyzeClaim(claim);
  return NextResponse.json(analysis);
}
