// ClaimIQ — Core Type Definitions

export type AddOn =
  | "ZERO_DEPRECIATION"
  | "CONSUMABLES"
  | "ENGINE_PROTECT"
  | "INVOICE_GAP"
  | "TYRE_PROTECT"
  | "KEY_REPLACEMENT"
  | "ROADSIDE_ASSISTANCE";

export interface PolicySchedule {
  policyNumber: string;
  policyCode: "AD-COMP-01" | "AD-ELITE-02";
  policyStartDate: string;
  policyEndDate: string;
  idv: number;
  compulsoryDeductible: number;
  voluntaryDeductible: number;
  activeAddOns: AddOn[];
  odClaimsThisPolicyYear: number;
  originalInvoiceValue?: number;
  benefitUsage?: {
    engineProtectUsed?: number;
    tyreProtectUsed?: number;
    keyReplacementUsed?: number;
    rsaEventsUsed?: number;
  };
}

export interface ClaimInfo {
  claimNumber?: string;
  policyNumber?: string;
  lossDate?: string;
  accidentDescription?: string;
  primaryImpactLocation?: string;
  injuryInvolved?: boolean;
  thirdPartyInvolved?: boolean;
  policeReportRequired?: boolean;
}

export interface VehicleInfo {
  registration: string;
  make: string;
  model: string;
  variant: string;
  modelYear: number;
  engineCC: number;
  vehicleAgeYears: number;
  odometerKm?: number;
}

export interface GarageInfo {
  name: string;
  city: string;
  networkStatus: "network" | "non_network" | "unknown";
}

export interface RepairLineItem {
  id: string;
  rawDescription: string;
  normalizedDescription: string;
  quantity?: number;
  partCost?: number;
  labourCost?: number;
  paintCost?: number;
  totalCost?: number;
  category: "part" | "labour" | "paint" | "other";
  material:
    | "metal"
    | "plastic"
    | "glass"
    | "fiberglass"
    | "rubber"
    | "electrical"
    | "mechanical"
    | "paint"
    | "unknown";
  action: "repair" | "replace" | "paint" | "inspect" | "unknown";
  vehicleLocation?: string;
  sourceBlockIds: string[];
  confidence: "high" | "medium" | "low";
}

export interface MissingItem {
  field: string;
  description: string;
  required: boolean;
}

export interface SourceBlock {
  blockId: string;
  pageNumber: number;
  text: string;
  type: "paragraph" | "line" | "table_cell";
  /** Polygon coordinates normalized to the range 0..1. */
  polygon?: number[];
  rowIndex?: number;
  columnIndex?: number;
}

export interface DocumentExtraction {
  content: string;
  sourceBlocks: SourceBlock[];
  pageCount: number;
}

export interface IntegritySignal {
  category: string;
  description: string;
  material: boolean;
  confirmed: boolean;
  critical: boolean;
  resolved: boolean;
}

export interface StructuredClaim {
  claim: ClaimInfo;
  vehicle: VehicleInfo;
  garage: GarageInfo;
  estimate: {
    estimateNumber?: string;
    partsTotal: number;
    labourTotal: number;
    paintTotal: number;
    grandTotal: number;
  };
  lineItems: RepairLineItem[];
  missingInformation: MissingItem[];
}

export interface SemanticReviewResult {
  itemId: string;
  normalizedDescription: string;
  classification: "CONSISTENT" | "POSSIBLY_CONSISTENT" | "REQUIRES_VERIFICATION" | "INCONSISTENT_WITH_DESCRIPTION";
  reason: string;
}

export interface SettlementAdjustment {
  ruleId: string;
  description: string;
  amount: number;
  documentCode: string;
  clauseNumber: string;
  category: "depreciation" | "deductible" | "addon_cap" | "exclusion" | "non_covered";
}

export interface SettlementResult {
  workshopEstimate: number;
  indicativeAdmissibleSettlement: number;
  totalPolicyAdjustments: number;
  adjustments: SettlementAdjustment[];
  zeroDepApplied: boolean;
  consumablesCovered: number;
  ctlRatio: number;
  ctlStatus: "normal" | "ctl_watch" | "ctl_candidate";
}

export interface ReviewFinding {
  id: string;
  type: "duplicate" | "arithmetic" | "benchmark" | "semantic" | "identity" | "completeness" | "intensity";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  amount: number;
  relatedItemIds?: string[];
  ruleId?: string;
  source: "RULE" | "SYNTHETIC" | "AI";
}

export interface ReviewRiskResult {
  score: number;
  band: "Low" | "Moderate" | "High" | "Very High";
  drivers: { driver: string; weight: number; contribution: number; detail: string }[];
}

export type RouteType = "fast_track" | "desktop_review" | "specialist_review";

export interface RoutingResult {
  primaryRoute: RouteType;
  routeLabel: string;
  routeColor: "green" | "amber" | "red";
  reasons: string[];
  desktopTriggers: string[];
  specialistTriggers: string[];
  fastTrackEligible: boolean;
}

export interface SIUResult {
  referral: "not_required" | "recommended";
  reason: string;
  integrityConcerns: string[];
}

export interface ApprovalAuthorityResult {
  level: string;
  amountRange: string;
  ruleId: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: "SYSTEM" | "AZURE_DI" | "AZURE_OPENAI" | "RULE_ENGINE" | "USER";
  action: string;
  relatedRuleIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface HumanDecision {
  action: "accept" | "change_route" | "request_evidence" | "escalate_specialist" | "refer_siu";
  reasonCode?: string;
  comment?: string;
  timestamp: string;
}

export interface RAGAnswer {
  answer: string;
  calculation?: string;
  sources: { document: string; clause?: string; page?: number; ruleId?: string }[];
  evidenceFound: boolean;
  retrievalMode?: "RULE_LOOKUP" | "AZURE_HYBRID" | "AZURE_KEYWORD" | "LOCAL_KEYWORD";
  notice?: string;
}

export interface DemoClaim {
  claimId: string;
  label: string;
  purpose: string;
  expectedRoute: string;
  estimateImage: string;
  context: {
    policySchedule: PolicySchedule;
    claim: ClaimInfo;
    vehicle: VehicleInfo;
    garage: GarageInfo;
    documentsAvailable: Record<string, boolean>;
    integritySignals?: IntegritySignal[];
  };
  structuredClaim: StructuredClaim;
  semanticReview: SemanticReviewResult[];
  documentExtraction?: DocumentExtraction;
  aiMode: "LIVE" | "DEMO";
}

export interface PipelineStatus {
  mode: "LIVE" | "DEMO";
  documentIntelligence: "live" | "cached" | "unavailable";
  claimUnderstanding: "live" | "cached" | "unavailable";
  message: string;
}

export interface ClaimAnalysisResult {
  claim: DemoClaim;
  settlement: SettlementResult;
  reviewFindings: ReviewFinding[];
  reviewRisk: ReviewRiskResult;
  routing: RoutingResult;
  siu: SIUResult;
  approvalAuthority: ApprovalAuthorityResult;
  completeness: number;
  auditTrail: AuditEvent[];
  pipeline: PipelineStatus;
}
