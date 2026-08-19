import type { DemoClaim, ReviewFinding, ReviewRiskResult } from "@/lib/types";
import { getBenchmark, calculateLabourDeviation, calculateReplacementIntensity } from "@/lib/benchmarks/repairBenchmarks";

// Risk score 0–100 — transparent, deterministic, NOT a fraud probability
export function calculateReviewRisk(
  claim: DemoClaim,
  findings: ReviewFinding[],
  settlement: { indicativeAdmissibleSettlement: number; ctlRatio: number }
): ReviewRiskResult {
  const { structuredClaim, context } = claim;
  const estimate = structuredClaim.estimate;
  const benchmark = getBenchmark(context.vehicle.make, context.garage.city, context.garage.networkStatus);

  const drivers: ReviewRiskResult["drivers"] = [];

  // 1. Estimate benchmark deviation (weight 25)
  const labourDev = Math.max(0, calculateLabourDeviation(estimate.labourTotal, estimate.partsTotal, benchmark));
  const estimateIDVRatio = (estimate.grandTotal / context.policySchedule.idv) * 100;
  const benchmarkDeviationScore = Math.min(100, (labourDev / 50) * 60 + Math.min(40, (estimateIDVRatio / 30) * 40));
  drivers.push({
    driver: "Estimate benchmark deviation",
    weight: 25,
    contribution: Math.round((benchmarkDeviationScore / 100) * 25),
    detail: `Labour ${labourDev.toFixed(0)}% above benchmark, estimate/IDV ${estimateIDVRatio.toFixed(1)}%`,
  });

  // 2. Replacement intensity (weight 15)
  const ri = calculateReplacementIntensity(structuredClaim.lineItems);
  const riScore = Math.min(100, (ri / 100) * 100);
  drivers.push({
    driver: "Replacement intensity",
    weight: 15,
    contribution: Math.round((riScore / 100) * 15),
    detail: `${ri.toFixed(0)}% replacement lines`,
  });

  // 3. Semantic inconsistency (weight 25)
  const semanticFindings = findings.filter((f) => f.type === "semantic");
  const inconsistentCount = semanticFindings.filter((f) => f.severity === "high").length;
  const reqVerifyCount = semanticFindings.filter((f) => f.severity !== "high").length;
  const semanticScore = Math.min(100, inconsistentCount * 50 + reqVerifyCount * 20);
  drivers.push({
    driver: "Semantic inconsistency",
    weight: 25,
    contribution: Math.round((semanticScore / 100) * 25),
    detail: `${inconsistentCount} inconsistent, ${reqVerifyCount} requires verification`,
  });

  // 4. Duplicate/arithmetic signals (weight 15)
  const dupFindings = findings.filter((f) => f.type === "duplicate");
  const arithFindings = findings.filter((f) => f.type === "arithmetic");
  const dupScore = Math.min(100, dupFindings.length * 40 + arithFindings.length * 50);
  drivers.push({
    driver: "Duplicate/arithmetic signals",
    weight: 15,
    contribution: Math.round((dupScore / 100) * 15),
    detail: `${dupFindings.length} duplicate, ${arithFindings.length} arithmetic findings`,
  });

  // 5. Data/identity quality (weight 10)
  const lowConfidenceCount = structuredClaim.lineItems.filter((li) => li.confidence === "low").length;
  const mediumConfidenceCount = structuredClaim.lineItems.filter((li) => li.confidence === "medium").length;
  const missingCount = structuredClaim.missingInformation.length;
  const dataScore = Math.min(100, lowConfidenceCount * 30 + mediumConfidenceCount * 15 + missingCount * 25);
  drivers.push({
    driver: "Data/identity quality",
    weight: 10,
    contribution: Math.round((dataScore / 100) * 10),
    detail: `${lowConfidenceCount} low-confidence, ${mediumConfidenceCount} medium-confidence, ${missingCount} missing fields`,
  });

  // 6. Claim severity (weight 10)
  const settlementL = settlement.indicativeAdmissibleSettlement / 100000;
  const severityScore = Math.min(100, settlementL * 20 + (settlement.ctlRatio > 0.6 ? 30 : 0));
  drivers.push({
    driver: "Claim severity",
    weight: 10,
    contribution: Math.round((severityScore / 100) * 10),
    detail: `Settlement ₹${(settlement.indicativeAdmissibleSettlement / 100000).toFixed(1)}L, CTL ratio ${(settlement.ctlRatio * 100).toFixed(0)}%`,
  });

  const score = drivers.reduce((sum, d) => sum + d.contribution, 0);
  const band: ReviewRiskResult["band"] =
    score >= 80 ? "Very High" : score >= 60 ? "High" : score >= 30 ? "Moderate" : "Low";

  return { score, band, drivers };
}
