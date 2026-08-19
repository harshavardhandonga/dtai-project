import type { ApprovalAuthorityResult } from "@/lib/types";
import { getRule } from "./ruleRegistry";

export function determineApprovalAuthority(settlement: number): ApprovalAuthorityResult {
  const rule = getRule("SOP-AUTH");
  if (!rule) {
    return { level: "Claims Officer", amountRange: "≤ ₹1,50,000", ruleId: "SOP-AUTH" };
  }
  const bands = (rule.logic as { bands: { max: number; level: string }[] }).bands;
  for (const band of bands) {
    if (settlement <= band.max) {
      const range =
        band.max === 150000
          ? "≤ ₹1,50,000"
          : band.max === 500000
          ? "₹1,50,001 – ₹5,00,000"
          : "> ₹5,00,000";
      return { level: band.level, amountRange: range, ruleId: "SOP-AUTH" };
    }
  }
  return { level: "Senior Claims Authority", amountRange: "> ₹5,00,000", ruleId: "SOP-AUTH" };
}
