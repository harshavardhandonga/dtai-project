// Policy & SOP Rule Registry — deterministic rule definitions

export interface RuleDefinition {
  ruleId: string;
  documentCode: string;
  documentType: "POLICY" | "SOP";
  clauseNumber: string;
  category: string;
  description: string;
  logic: unknown;
}

export const ruleRegistry: RuleDefinition[] = [
  // ── Policy A (AD-COMP-01) ──
  {
    ruleId: "PA-DEP-PLASTIC",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "4.1",
    category: "DEPRECIATION",
    description: "50% depreciation on rubber/nylon/plastic parts, tyres/tubes, batteries and airbags",
    logic: { type: "percentage", value: 0.50 },
  },
  {
    ruleId: "PA-DEP-FIBER",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "4.1",
    category: "DEPRECIATION",
    description: "30% depreciation on fiberglass components",
    logic: { type: "percentage", value: 0.30 },
  },
  {
    ruleId: "PA-DEP-GLASS",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "4.1",
    category: "DEPRECIATION",
    description: "Nil depreciation on glass parts",
    logic: { type: "percentage", value: 0.0 },
  },
  {
    ruleId: "PA-DEP-AGE",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "4.2",
    category: "DEPRECIATION",
    description: "Age-based depreciation on other (metal/wooden) parts",
    logic: {
      type: "age_schedule",
      schedule: [
        { maxAge: 0.5, rate: 0.0 },
        { maxAge: 1, rate: 0.05 },
        { maxAge: 2, rate: 0.10 },
        { maxAge: 3, rate: 0.15 },
        { maxAge: 4, rate: 0.25 },
        { maxAge: 5, rate: 0.35 },
        { maxAge: 10, rate: 0.40 },
        { maxAge: Infinity, rate: 0.50 },
      ],
    },
  },
  {
    ruleId: "PA-PAINT",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "4.3",
    category: "DEPRECIATION",
    description: "50% depreciation on paint material component; consolidated paint = 25% material",
    logic: { type: "paint", materialFraction: 0.25, depreciationRate: 0.50 },
  },
  {
    ruleId: "PA-CTL",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "5.1",
    category: "TOTAL_LOSS",
    description: "CTL when aggregate reasonable repair cost exceeds 75% of IDV",
    logic: { type: "threshold", threshold: 0.75 },
  },
  {
    ruleId: "PA-DED",
    documentCode: "AD-COMP-01",
    documentType: "POLICY",
    clauseNumber: "2.4",
    category: "DEDUCTIBLE",
    description: "Compulsory deductible per own-damage event as per Schedule",
    logic: { type: "deductible" },
  },

  // ── Policy B (AD-ELITE-02) ──
  {
    ruleId: "PB-ZD-LIMIT",
    documentCode: "AD-ELITE-02",
    documentType: "POLICY",
    clauseNumber: "4.2",
    category: "ZERO_DEPRECIATION",
    description: "Zero Depreciation for first two admissible partial-loss claims, subject to active coverage",
    logic: { type: "zero_dep", maxClaims: 2 },
  },
  {
    ruleId: "PB-CONS",
    documentCode: "AD-ELITE-02",
    documentType: "POLICY",
    clauseNumber: "5.1",
    category: "CONSUMABLES",
    description: "Consumables Protect — eligible consumables up to ₹15,000 per claim",
    logic: { type: "cap", value: 15000 },
  },
  {
    ruleId: "PB-ENG",
    documentCode: "AD-ELITE-02",
    documentType: "POLICY",
    clauseNumber: "6.1",
    category: "ENGINE_PROTECT",
    description: "Engine & Gearbox Protect — cap ₹1,50,000 per policy year",
    logic: { type: "cap", value: 150000 },
  },
  {
    ruleId: "PB-CTL",
    documentCode: "AD-ELITE-02",
    documentType: "POLICY",
    clauseNumber: "9.3",
    category: "TOTAL_LOSS",
    description: "CTL trigger above 75% of IDV",
    logic: { type: "threshold", threshold: 0.75 },
  },
  {
    ruleId: "PB-DED",
    documentCode: "AD-ELITE-02",
    documentType: "POLICY",
    clauseNumber: "12.1",
    category: "DEDUCTIBLE",
    description: "Compulsory deductible per own-damage event as per Schedule",
    logic: { type: "deductible" },
  },

  // ── SOP A (CLM-MTR-01) ──
  {
    ruleId: "SOP-FT",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "7.1",
    category: "FAST_TRACK",
    description: "Fast Track: settlement ≤₹60k, risk <30, completeness ≥90%, no desktop/specialist trigger",
    logic: { type: "fast_track", maxSettlement: 60000, maxRisk: 30, minCompleteness: 90 },
  },
  {
    ruleId: "SOP-DR",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "8.1",
    category: "DESKTOP_REVIEW",
    description: "Desktop Review: risk 30–59, estimate/IDV >15%, non-network labour >30% above benchmark, etc.",
    logic: { type: "desktop_review" },
  },
  {
    ruleId: "SOP-ARITH",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "5.4",
    category: "ARITHMETIC",
    description: "Arithmetic anomaly: reconciliation differs >₹5,000 OR >2%",
    logic: { type: "arithmetic", amountThreshold: 5000, percentThreshold: 0.02 },
  },
  {
    ruleId: "SOP-DUP",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "5.5",
    category: "DUPLICATE",
    description: "Duplicate/near-duplicate lines changing gross estimate >₹10,000 → specialist review",
    logic: { type: "duplicate", amountThreshold: 10000 },
  },
  {
    ruleId: "SOP-AUTH",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "3.2",
    category: "APPROVAL_AUTHORITY",
    description: "Approval bands: ≤₹1.5L Claims Officer, ₹1.5L–₹5L Claims Manager, >₹5L Senior Authority",
    logic: {
      type: "approval_bands",
      bands: [
        { max: 150000, level: "Claims Officer" },
        { max: 500000, level: "Claims Manager" },
        { max: Infinity, level: "Senior Claims Authority" },
      ],
    },
  },
  {
    ruleId: "SOP-OVERRIDE",
    documentCode: "CLM-MTR-01",
    documentType: "SOP",
    clauseNumber: "11.1",
    category: "HUMAN_OVERRIDE",
    description: "Human override requires reason code and optional comment",
    logic: { type: "override" },
  },

  // ── SOP B (CLM-MTR-02) ──
  {
    ruleId: "SOP-SP",
    documentCode: "CLM-MTR-02",
    documentType: "SOP",
    clauseNumber: "3.1",
    category: "SPECIALIST_REVIEW",
    description: "Specialist Review: risk ≥60, settlement >₹2.5L, repair/IDV ≥60%, structural, airbag, fire, flood, mismatch, duplicate",
    logic: { type: "specialist_review" },
  },
  {
    ruleId: "SOP-CTL-WATCH",
    documentCode: "CLM-MTR-02",
    documentType: "SOP",
    clauseNumber: "4.2",
    category: "CTL_WATCH",
    description: "Internal CTL warning at 60% of IDV; CTL candidate above 75%",
    logic: { type: "ctl_watch", watchThreshold: 0.60, candidateThreshold: 0.75 },
  },
  {
    ruleId: "SOP-SIU",
    documentCode: "CLM-MTR-02",
    documentType: "SOP",
    clauseNumber: "8.1",
    category: "SIU_REFERRAL",
    description: "SIU referral: one confirmed critical integrity trigger OR ≥2 independent unresolved material concerns",
    logic: { type: "siu" },
  },
  {
    ruleId: "SOP-MISMATCH",
    documentCode: "CLM-MTR-02",
    documentType: "SOP",
    clauseNumber: "5.2",
    category: "SEMANTIC_MISMATCH",
    description: "Impact mismatch: single ≤₹10k desktop, >₹10k specialist, safety-critical specialist, multiple geographic specialist",
    logic: { type: "mismatch" },
  },
];

export function getRule(ruleId: string): RuleDefinition | undefined {
  return ruleRegistry.find((r) => r.ruleId === ruleId);
}
