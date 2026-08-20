import type { DemoClaim, SettlementResult, SettlementAdjustment, RepairLineItem } from "@/lib/types";
import { getRule } from "./ruleRegistry";

function getAgeDepreciationRate(vehicleAgeYears: number): number {
  const rule = getRule("PA-DEP-AGE");
  if (!rule) return 0;
  const schedule = (rule.logic as { schedule: { maxAge: number; rate: number }[] }).schedule;
  for (const entry of schedule) {
    if (vehicleAgeYears <= entry.maxAge) return entry.rate;
  }
  return 0.5;
}

function getMaterialDepreciationRate(material: string): { rate: number; ruleId: string } | null {
  switch (material) {
    case "plastic":
    case "rubber":
      return { rate: 0.5, ruleId: "PA-DEP-PLASTIC" };
    case "fiberglass":
      return { rate: 0.3, ruleId: "PA-DEP-FIBER" };
    case "glass":
      return { rate: 0.0, ruleId: "PA-DEP-GLASS" };
    default:
      return null; // metal/other → age-based
  }
}

export function calculateSettlement(claim: DemoClaim): SettlementResult {
  const { structuredClaim, context } = claim;
  const schedule = context.policySchedule;
  const lineItems = structuredClaim.lineItems;
  const workshopEstimate = structuredClaim.estimate.grandTotal;

  // Determine Zero Dep eligibility
  const hasZeroDep = schedule.activeAddOns.includes("ZERO_DEPRECIATION");
  const zeroDepActive =
    hasZeroDep &&
    schedule.odClaimsThisPolicyYear < 2; // first two admissible claims

  const adjustments: SettlementAdjustment[] = [];

  // ── Depreciation ──
  for (const item of lineItems) {
    if (item.category === "other") continue; // consumables handled separately

    // Part depreciation
    if (item.partCost && item.partCost > 0 && item.category === "part") {
      const matDep = getMaterialDepreciationRate(item.material);
      let depRate: number;
      let ruleId: string;
      let desc: string;

      if (matDep) {
        depRate = matDep.rate;
        ruleId = matDep.ruleId;
        desc = `${item.material} depreciation (${depRate * 100}%) on ${item.normalizedDescription}`;
      } else {
        // Age-based for metal/other
        depRate = getAgeDepreciationRate(schedule.policyCode === "AD-ELITE-02" ? context.vehicle.vehicleAgeYears : context.vehicle.vehicleAgeYears);
        ruleId = "PA-DEP-AGE";
        desc = `Age depreciation (${depRate * 100}%) on ${item.normalizedDescription}`;
      }

      if (zeroDepActive) {
        // Zero Dep waives depreciation — no adjustment
        continue;
      }

      const deduction = Math.round(item.partCost * depRate);
      if (deduction > 0) {
        const rule = getRule(ruleId);
        adjustments.push({
          ruleId,
          description: desc,
          amount: deduction,
          documentCode: rule?.documentCode || schedule.policyCode,
          clauseNumber: rule?.clauseNumber || "",
          category: "depreciation",
        });
      }
    }

    // Paint material depreciation
    if (item.paintCost && item.paintCost > 0 && !zeroDepActive) {
      const paintRule = getRule("PA-PAINT");
      const paintLogic = paintRule?.logic as { materialFraction: number; depreciationRate: number };
      const materialAmount = Math.round(item.paintCost * paintLogic.materialFraction);
      const deduction = Math.round(materialAmount * paintLogic.depreciationRate);
      if (deduction > 0) {
        adjustments.push({
          ruleId: "PA-PAINT",
          description: `Paint material depreciation (50% of 25% material) on ${item.normalizedDescription}`,
          amount: deduction,
          documentCode: paintRule?.documentCode || schedule.policyCode,
          clauseNumber: paintRule?.clauseNumber || "4.3",
          category: "depreciation",
        });
      }
    }
  }

  // ── Consumables (Policy B) ──
  let consumablesCovered = 0;
  const hasConsumables = schedule.activeAddOns.includes("CONSUMABLES");
  const consumablesItem = lineItems.find((li) => li.category === "other" && li.rawDescription.toLowerCase().includes("consumable"));
  if (consumablesItem && consumablesItem.partCost && hasConsumables) {
    const consRule = getRule("PB-CONS");
    const cap = (consRule?.logic as { value: number }).value;
    consumablesCovered = Math.min(consumablesItem.partCost, cap);
    // If consumables exceed cap, the excess is a policy adjustment
    if (consumablesItem.partCost > cap) {
      adjustments.push({
        ruleId: "PB-CONS",
        description: `Consumables cap exceeded — ₹${cap.toLocaleString("en-IN")} limit, excess ₹${(consumablesItem.partCost - cap).toLocaleString("en-IN")} not covered`,
        amount: consumablesItem.partCost - cap,
        documentCode: "AD-ELITE-02",
        clauseNumber: "5.1",
        category: "addon_cap",
      });
    }
  } else if (consumablesItem && consumablesItem.partCost && !hasConsumables) {
    // Consumables not covered by policy
    adjustments.push({
      ruleId: "PA-DED",
      description: `Consumables not covered (no Consumables Protect add-on) — ₹${consumablesItem.partCost.toLocaleString("en-IN")}`,
      amount: consumablesItem.partCost,
      documentCode: schedule.policyCode,
      clauseNumber: "8.1",
      category: "non_covered",
    });
  }

  // ── Deductible ──
  const totalDeductible = schedule.compulsoryDeductible + schedule.voluntaryDeductible;
  if (totalDeductible > 0) {
    const dedRule = getRule(schedule.policyCode === "AD-ELITE-02" ? "PB-DED" : "PA-DED");
    adjustments.push({
      ruleId: schedule.policyCode === "AD-ELITE-02" ? "PB-DED" : "PA-DED",
      description: `Compulsory deductible ₹${totalDeductible.toLocaleString("en-IN")}`,
      amount: totalDeductible,
      documentCode: dedRule?.documentCode || schedule.policyCode,
      clauseNumber: dedRule?.clauseNumber || "",
      category: "deductible",
    });
  }

  const totalPolicyAdjustments = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const indicativeAdmissibleSettlement = Math.max(0, workshopEstimate - totalPolicyAdjustments);

  // ── CTL ──
  const ctlRatio = workshopEstimate / schedule.idv;
  let ctlStatus: SettlementResult["ctlStatus"] = "normal";
  if (ctlRatio > 0.75) ctlStatus = "ctl_candidate";
  else if (ctlRatio >= 0.6) ctlStatus = "ctl_watch";

  return {
    workshopEstimate,
    indicativeAdmissibleSettlement,
    totalPolicyAdjustments,
    adjustments,
    zeroDepApplied: zeroDepActive,
    consumablesCovered,
    ctlRatio,
    ctlStatus,
  };
}
