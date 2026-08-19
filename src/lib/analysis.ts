import type { DemoClaim, ClaimAnalysisResult, AuditEvent } from "@/lib/types";
import { calculateSettlement } from "@/lib/rules/settlementEngine";
import { runEstimateReview } from "@/lib/rules/estimateReview";
import { calculateReviewRisk } from "@/lib/rules/reviewRiskEngine";
import { determineRouting, determineSIU } from "@/lib/rules/routingEngine";
import { determineApprovalAuthority } from "@/lib/rules/approvalAuthority";

function calculateCompleteness(claim: DemoClaim): number {
  const docs = claim.context.documentsAvailable;
  const required = ["workshopEstimate", "accidentNarrative", "vehicleRegistration", "policyConfirmation"];
  const optional = ["drivingLicence", "damagePhotographs"];

  const requiredPresent = required.filter((k) => docs[k]).length;
  const optionalPresent = optional.filter((k) => docs[k]).length;

  // Required fields weighted 80%, optional 20%
  const score = (requiredPresent / required.length) * 80 + (optionalPresent / optional.length) * 20;
  return Math.round(score);
}

function buildAuditTrail(claim: DemoClaim): AuditEvent[] {
  const now = new Date();
  const t = (offset: number) => {
    const d = new Date(now.getTime() + offset * 60000);
    return d.toISOString();
  };

  return [
    { id: "A1", timestamp: t(0), actor: "SYSTEM", action: "Claim opened" },
    { id: "A2", timestamp: t(0), actor: "SYSTEM", action: "Estimate uploaded" },
    { id: "A3", timestamp: t(0), actor: "AZURE_DI", action: `Document Intelligence completed (${claim.aiMode} mode)` },
    { id: "A4", timestamp: t(1), actor: "AZURE_OPENAI", action: `${claim.structuredClaim.lineItems.length} repair lines identified (${claim.aiMode} mode)` },
    { id: "A5", timestamp: t(1), actor: "SYSTEM", action: `Policy ${claim.context.policySchedule.policyCode} loaded` },
    { id: "A6", timestamp: t(1), actor: "RULE_ENGINE", action: "Indicative settlement calculated", relatedRuleIds: claim.context.policySchedule.policyCode === "AD-ELITE-02" ? ["PB-DED", "PB-ZD-LIMIT"] : ["PA-DEP-PLASTIC", "PA-DEP-AGE", "PA-PAINT", "PA-DED"] },
    { id: "A7", timestamp: t(1), actor: "RULE_ENGINE", action: "Estimate review completed" },
    { id: "A8", timestamp: t(1), actor: "RULE_ENGINE", action: "Review risk score calculated" },
    { id: "A9", timestamp: t(2), actor: "RULE_ENGINE", action: "Routing recommendation generated", relatedRuleIds: ["SOP-FT", "SOP-DR", "SOP-SP"] },
    { id: "A10", timestamp: t(2), actor: "SYSTEM", action: "Approval authority determined", relatedRuleIds: ["SOP-AUTH"] },
  ];
}

export function analyzeClaim(claim: DemoClaim): ClaimAnalysisResult {
  const settlement = calculateSettlement(claim);
  const reviewFindings = runEstimateReview(claim, claim.semanticReview);
  const reviewRisk = calculateReviewRisk(claim, reviewFindings, settlement);
  const completeness = calculateCompleteness(claim);
  const routing = determineRouting(claim, reviewRisk, reviewFindings, settlement, completeness);
  const siu = determineSIU(claim, reviewFindings, reviewRisk);
  const approvalAuthority = determineApprovalAuthority(settlement.indicativeAdmissibleSettlement);
  const auditTrail = buildAuditTrail(claim);

  return {
    claim,
    settlement,
    reviewFindings,
    reviewRisk,
    routing,
    siu,
    approvalAuthority,
    completeness,
    auditTrail,
  };
}
