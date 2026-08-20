import type { DemoClaim, PolicySchedule } from "@/lib/types";

export type SupportedPolicyCode = PolicySchedule["policyCode"];

export function applyPolicyVariant(
  claim: DemoClaim,
  policyCode?: SupportedPolicyCode
): DemoClaim {
  if (!policyCode || claim.context.policySchedule.policyCode === policyCode) return claim;

  const isElite = policyCode === "AD-ELITE-02";
  const policySchedule: PolicySchedule = {
    ...claim.context.policySchedule,
    policyCode,
    policyNumber: isElite
      ? `ELITE-${claim.claimId.replace(/[^A-Z0-9]/gi, "")}`
      : `COMP-${claim.claimId.replace(/[^A-Z0-9]/gi, "")}`,
    compulsoryDeductible: claim.context.vehicle.engineCC > 1500 ? 2000 : 1000,
    voluntaryDeductible: 0,
    activeAddOns: isElite
      ? ["ZERO_DEPRECIATION", "CONSUMABLES", "ENGINE_PROTECT"]
      : [],
    odClaimsThisPolicyYear: 0,
  };

  return {
    ...claim,
    context: {
      ...claim.context,
      policySchedule,
    },
  };
}
