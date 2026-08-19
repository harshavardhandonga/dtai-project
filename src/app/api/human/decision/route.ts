import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { claimId, action, reasonCode, comment } = body;

  // In a real app this would persist to a database; MVP has no DB
  const event = {
    id: `AUDIT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: "USER" as const,
    action: `Human decision: ${action}${reasonCode ? ` (${reasonCode})` : ""}${comment ? ` — ${comment}` : ""}`,
    metadata: { claimId, action, reasonCode, comment },
  };

  return NextResponse.json({ success: true, event });
}
