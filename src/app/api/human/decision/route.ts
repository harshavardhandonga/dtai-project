import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  claimId: z.string().min(1),
  action: z.enum(["accept", "change_route", "request_evidence", "escalate_specialist", "refer_siu"]),
  reasonCode: z.enum(["H01", "H02", "H03", "H04", "H05", "H06"]).optional(),
  comment: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action !== "accept" && !value.reasonCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reasonCode"],
      message: "A reason code is required when changing or escalating the recommendation.",
    });
  }
});

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid human decision", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { claimId, action, reasonCode, comment } = parsed.data;

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
