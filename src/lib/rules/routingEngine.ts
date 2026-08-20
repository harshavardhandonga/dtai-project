import type { DemoClaim, ReviewFinding, ReviewRiskResult, RoutingResult, SIUResult } from "@/lib/types";
import { getBenchmark, calculateLabourDeviation } from "@/lib/benchmarks/repairBenchmarks";

export function determineRouting(
  claim: DemoClaim,
  risk: ReviewRiskResult,
  findings: ReviewFinding[],
  settlement: { indicativeAdmissibleSettlement: number; ctlRatio: number; workshopEstimate: number },
  completeness: number
): RoutingResult {
  const { context, structuredClaim } = claim;
  const estimate = structuredClaim.estimate;
  const benchmark = getBenchmark(context.vehicle.make, context.garage.city, context.garage.networkStatus);

  const desktopTriggers: string[] = [];
  const specialistTriggers: string[] = [];

  // ── Specialist hard triggers ──
  if (risk.score >= 60) specialistTriggers.push(`Review Risk ${risk.score} ≥ 60`);
  if (settlement.indicativeAdmissibleSettlement > 250000) specialistTriggers.push(`Settlement ₹${settlement.indicativeAdmissibleSettlement.toLocaleString("en-IN")} > ₹2.5L`);
  if (settlement.ctlRatio >= 0.6) specialistTriggers.push(`Repair/IDV ${(settlement.ctlRatio * 100).toFixed(0)}% ≥ 60% — CTL Watch`);

  // Duplicate charges > ₹10,000
  const dupFindings = findings.filter((f) => f.type === "duplicate");
  const duplicateAmount = dupFindings.reduce((sum, finding) => sum + finding.amount, 0);
  if (duplicateAmount > 10000) {
    specialistTriggers.push(`Material duplicate charges (₹${duplicateAmount.toLocaleString("en-IN")})`);
  }

  // Significant impact mismatch
  const mismatchFindings = findings.filter((f) => f.type === "semantic" && f.severity === "high");
  if (mismatchFindings.length > 0) specialistTriggers.push(`Significant impact mismatch (${mismatchFindings.length} item${mismatchFindings.length > 1 ? "s" : ""})`);

  // ── Desktop hard triggers ──
  if (risk.score >= 30 && risk.score < 60) desktopTriggers.push(`Review Risk ${risk.score} (30–59 band)`);

  const estimateIDVRatio = (estimate.grandTotal / context.policySchedule.idv) * 100;
  if (estimateIDVRatio > 15) desktopTriggers.push(`Estimate/IDV ${(estimateIDVRatio).toFixed(1)}% > 15%`);

  const labourDev = Math.max(0, calculateLabourDeviation(estimate.labourTotal, estimate.partsTotal, benchmark));
  if (context.garage.networkStatus === "non_network" && labourDev > 30) {
    desktopTriggers.push(`Non-network labour ${labourDev.toFixed(0)}% above benchmark`);
  }

  const lowConfidenceItems = structuredClaim.lineItems.filter((li) => li.confidence === "low" || li.confidence === "medium");
  const lowConfidenceImpact = lowConfidenceItems.reduce((s, li) => s + (li.totalCost || 0), 0);
  if (lowConfidenceImpact > 10000) desktopTriggers.push(`Low-confidence fields affecting settlement > ₹10,000`);

  const possibleConsistent = findings.filter((f) => f.type === "semantic" && f.severity === "low");
  if (possibleConsistent.length > 0) desktopTriggers.push(`Repair/replace ambiguity requires verification`);

  // ── Routing precedence ──
  let primaryRoute: RoutingResult["primaryRoute"];
  let routeLabel: string;
  let routeColor: RoutingResult["routeColor"];

  if (specialistTriggers.length > 0) {
    primaryRoute = "specialist_review";
    routeLabel = "Specialist Review";
    routeColor = "red";
  } else if (desktopTriggers.length > 0) {
    primaryRoute = "desktop_review";
    routeLabel = "Desktop Surveyor Review";
    routeColor = "amber";
  } else {
    // Check Fast Track conditions
    const fastTrackEligible =
      settlement.indicativeAdmissibleSettlement <= 60000 &&
      risk.score < 30 &&
      completeness >= 90 &&
      desktopTriggers.length === 0 &&
      specialistTriggers.length === 0;

    if (fastTrackEligible) {
      primaryRoute = "fast_track";
      routeLabel = "Fast Track Candidate";
      routeColor = "green";
    } else {
      primaryRoute = "desktop_review";
      routeLabel = "Desktop Surveyor Review";
      routeColor = "amber";
    }
  }

  const reasons = [...specialistTriggers, ...desktopTriggers];
  if (reasons.length === 0) reasons.push("All Fast Track conditions satisfied");

  return {
    primaryRoute,
    routeLabel,
    routeColor,
    reasons,
    desktopTriggers,
    specialistTriggers,
    fastTrackEligible: primaryRoute === "fast_track",
  };
}

export function determineSIU(
  claim: DemoClaim,
  findings: ReviewFinding[],
  _risk: ReviewRiskResult
): SIUResult {
  // SIU requires: one confirmed critical integrity trigger OR ≥2 independent unresolved material concerns
  // A high risk score alone must NEVER trigger SIU (PRD §65)

  // Technical findings such as duplicate charges and impact mismatches remain
  // specialist-review signals. They become SIU inputs only after a human or
  // trusted upstream control explicitly classifies them as unresolved material
  // integrity concerns.
  const integritySignals = claim.context.integritySignals ?? [];
  const confirmedCritical = integritySignals.filter((signal) => signal.confirmed && signal.critical);
  const unresolvedCategories = new Set(
    integritySignals
      .filter((signal) => !signal.resolved && signal.material)
      .map((signal) => signal.category)
  );

  if (confirmedCritical.length > 0) {
    return {
      referral: "recommended",
      reason: `SIU referral recommended: confirmed critical integrity signal (${confirmedCritical.map((s) => s.description).join(", ")}).`,
      integrityConcerns: confirmedCritical.map((s) => s.description),
    };
  }

  if (unresolvedCategories.size >= 2) {
    return {
      referral: "recommended",
      reason: `SIU referral recommended: ${unresolvedCategories.size} independent unresolved material integrity concern categories (${[...unresolvedCategories].join(", ")}).`,
      integrityConcerns: integritySignals
        .filter((signal) => !signal.resolved && signal.material)
        .map((signal) => signal.description),
    };
  }

  return {
    referral: "not_required",
    reason: "Technical and estimate concerns exist, but the current evidence does not satisfy SIU referral criteria. A high risk score alone does not trigger SIU.",
    integrityConcerns: [],
  };
}
