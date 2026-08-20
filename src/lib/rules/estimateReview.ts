import type { DemoClaim, ReviewFinding, SemanticReviewResult, RepairLineItem } from "@/lib/types";
import { getBenchmark, calculateLabourDeviation, calculateReplacementIntensity } from "@/lib/benchmarks/repairBenchmarks";

export function runEstimateReview(
  claim: DemoClaim,
  semanticReview: SemanticReviewResult[]
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const { structuredClaim, context } = claim;
  const lineItems = structuredClaim.lineItems;
  const estimate = structuredClaim.estimate;
  const benchmark = getBenchmark(context.vehicle.make, context.garage.city, context.garage.networkStatus);

  // ── Layer A: Deterministic Checks ──

  // Duplicate line detection (by normalized description similarity)
  const seen = new Map<string, RepairLineItem>();
  for (const item of lineItems) {
    const key = item.normalizedDescription.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) {
      const dup = seen.get(key)!;
      const dupAmount = (item.totalCost || 0);
      findings.push({
        id: `F-DUP-${item.id}`,
        type: "duplicate",
        severity: dupAmount > 10000 ? "high" : "medium",
        description: `Duplicate line item: "${item.normalizedDescription}" appears more than once (₹${dupAmount.toLocaleString("en-IN")}).`,
        amount: dupAmount,
        relatedItemIds: [item.id, dup.id],
        ruleId: "SOP-DUP",
        source: "RULE",
      });
    } else {
      seen.set(key, item);
    }
  }

  // Duplicate labour operation detection (by vehicle location + action)
  for (const item of lineItems) {
    if (item.category !== "labour" || !item.vehicleLocation) continue;
    if (!/(remov|dismant|refit|install)/i.test(item.normalizedDescription)) continue;
    // Check if there's already a part item for the same location with labour
    const partForLocation = lineItems.find(
      (li) => li.category === "part" && li.vehicleLocation === item.vehicleLocation && li.labourCost && li.labourCost > 0
    );
    if (partForLocation) {
      const dupAmount = item.totalCost || 0;
      findings.push({
        id: `F-DUPL-${item.id}`,
        type: "duplicate",
        severity: dupAmount > 10000 ? "high" : "medium",
        description: `Duplicate labour operation: "${item.normalizedDescription}" — labour for "${item.vehicleLocation}" already included in ${partForLocation.normalizedDescription} (₹${dupAmount.toLocaleString("en-IN")}).`,
        amount: dupAmount,
        relatedItemIds: [item.id, partForLocation.id],
        ruleId: "SOP-DUP",
        source: "RULE",
      });
    }
  }

  // Arithmetic consistency check
  const calculatedTotal = lineItems.reduce((sum, li) => sum + (li.totalCost || 0), 0);
  const diff = Math.abs(calculatedTotal - estimate.grandTotal);
  const diffPct = estimate.grandTotal > 0 ? diff / estimate.grandTotal : 0;
  if (diff > 5000 || diffPct > 0.02) {
    findings.push({
      id: "F-ARITH-1",
      type: "arithmetic",
      severity: "high",
      description: `Arithmetic inconsistency: line items sum to ₹${calculatedTotal.toLocaleString("en-IN")} but grand total states ₹${estimate.grandTotal.toLocaleString("en-IN")} (diff ₹${diff.toLocaleString("en-IN")}, ${(diffPct * 100).toFixed(1)}%).`,
      amount: diff,
      ruleId: "SOP-ARITH",
      source: "RULE",
    });
  }

  // Estimate/IDV ratio
  const estimateIDVRatio = (estimate.grandTotal / context.policySchedule.idv) * 100;
  if (estimateIDVRatio > 15) {
    findings.push({
      id: "F-EIR-1",
      type: "benchmark",
      severity: "medium",
      description: `Estimate/IDV ratio is ${(estimateIDVRatio).toFixed(1)}% (benchmark: ${benchmark.estimateIDVRatio}%). High estimate relative to vehicle value.`,
      amount: 0,
      ruleId: "SOP-DR",
      source: "SYNTHETIC",
    });
  }

  // ── Layer B: Synthetic Benchmarking ──

  // Labour rate deviation
  const labourDeviation = calculateLabourDeviation(estimate.labourTotal, estimate.partsTotal, benchmark);
  if (labourDeviation > 30) {
    findings.push({
      id: "F-LBR-1",
      type: "benchmark",
      severity: labourDeviation > 40 ? "high" : "medium",
      description: `Labour cost is ${labourDeviation.toFixed(0)}% above applicable benchmark for ${benchmark.vehicleClass} vehicle, ${context.garage.networkStatus} garage in ${context.garage.city}.`,
      amount: Math.round(estimate.labourTotal - estimate.partsTotal / benchmark.partsLabourRatio),
      source: "SYNTHETIC",
    });
  }

  // Replacement intensity
  const replacementIntensity = calculateReplacementIntensity(lineItems);
  if (replacementIntensity > benchmark.replacementIntensityThreshold) {
    findings.push({
      id: "F-RI-1",
      type: "intensity",
      severity: replacementIntensity > 80 ? "high" : "medium",
      description: `Replacement intensity is ${replacementIntensity.toFixed(0)}% (${benchmark.replacementIntensityThreshold}% benchmark). High proportion of replacement vs repair — evaluate repairability.`,
      amount: 0,
      source: "SYNTHETIC",
    });
  }

  // ── Layer C: AI Semantic Review ──
  for (const sr of semanticReview) {
    if (sr.classification === "INCONSISTENT_WITH_DESCRIPTION" || sr.classification === "REQUIRES_VERIFICATION" || sr.classification === "POSSIBLY_CONSISTENT") {
      const item = lineItems.find((li) => li.id === sr.itemId);
      const amount = item?.totalCost || 0;
      const severity = sr.classification === "INCONSISTENT_WITH_DESCRIPTION" ? (amount > 10000 ? "high" : "medium") : sr.classification === "REQUIRES_VERIFICATION" ? "medium" : "low";
      const label = sr.classification === "INCONSISTENT_WITH_DESCRIPTION" ? "Impact mismatch" : sr.classification === "REQUIRES_VERIFICATION" ? "Requires verification" : "Repair/replace ambiguity";
      findings.push({
        id: `F-SEM-${sr.itemId}`,
        type: "semantic",
        severity,
        description: `${label}: ${sr.reason} (₹${amount.toLocaleString("en-IN")}).`,
        amount,
        relatedItemIds: [sr.itemId],
        ruleId: sr.classification === "POSSIBLY_CONSISTENT" ? undefined : "SOP-MISMATCH",
        source: "AI",
      });
    }
  }

  return findings;
}
