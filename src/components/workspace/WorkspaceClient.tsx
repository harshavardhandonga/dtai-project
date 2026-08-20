"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { ClaimAnalysisResult, RAGAnswer } from "@/lib/types";
import { SourceBadge, Card, CardHeader, formatINR } from "@/components/ui/badge";

function polygonBox(polygon?: number[]) {
  if (!polygon || polygon.length < 8) return null;
  const xs = polygon.filter((_, index) => index % 2 === 0);
  const ys = polygon.filter((_, index) => index % 2 === 1);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

export function WorkspaceClient({ claimId }: { claimId: string }) {
  const [analysis, setAnalysis] = useState<ClaimAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [ragOpen, setRagOpen] = useState(false);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragAnswer, setRagAnswer] = useState<RAGAnswer | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [decisionRecorded, setDecisionRecorded] = useState(false);
  const [extraAudit, setExtraAudit] = useState<{ timestamp: string; action: string }[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<"AD-COMP-01" | "AD-ELITE-02" | "">("");
  const [requestError, setRequestError] = useState("");
  const [decisionError, setDecisionError] = useState("");

  const loadAnalysis = useCallback(async (policyCode?: "AD-COMP-01" | "AD-ELITE-02") => {
    setLoading(true);
    setRequestError("");
    try {
      if (claimId === "uploaded") {
        const stored = sessionStorage.getItem("claimiq-upload-analysis");
        if (!stored) throw new Error("The uploaded analysis is no longer available. Return to Claim Intake and upload it again.");
        const data = JSON.parse(stored) as ClaimAnalysisResult;
        setAnalysis(data);
        setSelectedPolicy(data.claim.context.policySchedule.policyCode);
        return;
      }
      const response = await fetch("/api/claim/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, policyCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Claim analysis failed");
      setAnalysis(data);
      setSelectedPolicy(data.claim.context.policySchedule.policyCode);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Claim analysis failed");
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const askRAG = useCallback(async () => {
    if (!ragQuestion.trim()) return;
    setRagLoading(true);
    setRagAnswer(null);
    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: ragQuestion,
          claimId: analysis?.claim.claimId || claimId,
          policyCode: selectedPolicy || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "RAG query failed");
      setRagAnswer(data);
    } catch {
      setRagAnswer({ answer: "RAG query failed. Please try again.", sources: [], evidenceFound: false });
    }
    setRagLoading(false);
  }, [ragQuestion, claimId, selectedPolicy, analysis?.claim.claimId]);

  const recordDecision = useCallback(async () => {
    if (!decision) return;
    setDecisionError("");
    try {
      const response = await fetch("/api/human/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, action: decision, reasonCode, comment }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Decision could not be recorded");
      setDecisionRecorded(true);
      setExtraAudit((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          action: `Human decision: ${decision}${reasonCode ? ` (${reasonCode})` : ""}${comment ? ` — ${comment}` : ""}`,
        },
      ]);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "Decision could not be recorded");
    }
  }, [decision, reasonCode, comment, claimId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-3" />
          <p className="text-slate-500 text-sm">Analyzing claim…</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load claim analysis.</p>
          {requestError && <p className="text-sm text-slate-500 mt-1">{requestError}</p>}
          <button onClick={() => void loadAnalysis()} className="mt-3 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { claim, settlement, reviewFindings, reviewRisk, routing, siu, approvalAuthority, completeness, auditTrail } = analysis;
  const lineItems = claim.structuredClaim.lineItems;
  const amountUnderReview = reviewFindings.reduce((s, f) => s + f.amount, 0);
  const highlightedBlockIds = new Set(
    lineItems.find((item) => item.id === highlightedItemId)?.sourceBlockIds ?? []
  );
  const sourceBlocks = claim.documentExtraction?.sourceBlocks ?? [];
  const isPdfDocument = claim.estimateImage.startsWith("data:application/pdf");
  const missingItems = [
    ...claim.structuredClaim.missingInformation,
    ...Object.entries(claim.context.documentsAvailable)
      .filter(([, available]) => !available)
      .map(([field]) => ({
        field,
        description: `${field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase())} is not available.`,
        required: ["workshopEstimate", "accidentNarrative", "vehicleRegistration", "policyConfirmation"].includes(field),
      })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.field === item.field) === index);

  const routeColors: Record<string, string> = {
    green: "bg-green-100 text-green-700 border-green-300",
    amber: "bg-amber-100 text-amber-700 border-amber-300",
    red: "bg-red-100 text-red-700 border-red-300",
  };

  const riskColors: Record<string, string> = {
    Low: "text-green-600",
    Moderate: "text-amber-600",
    High: "text-red-600",
    "Very High": "text-red-700",
  };

  const suggestedQuestions = [
    "Why was depreciation applied?",
    "Why is this item under review?",
    "Why was Specialist Review triggered?",
    "Does this claim satisfy SIU conditions?",
    "Who must approve the claim?",
    "Which policy rule drove this deduction?",
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-700">
              <span className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold">C</span>
              <span className="font-semibold text-slate-900">ClaimIQ</span>
            </Link>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <p className="text-sm font-semibold text-slate-900">{claim.claimId}</p>
              <p className="text-xs text-slate-500">{claim.context.vehicle.make} {claim.context.vehicle.model} · {claim.context.vehicle.registration}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SourceBadge type={claim.aiMode === "LIVE" ? "LIVE" : "DEMO"} />
            {claimId !== "uploaded" && (
              <Link href={`/dossier/${claim.claimId}`} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                View Dossier →
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 py-4 flex gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${
            analysis.pipeline.mode === "LIVE"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-slate-100 border-slate-200 text-slate-700"
          }`}>
            <div>
              <p className="font-semibold">
                {analysis.pipeline.mode === "LIVE" ? "Live Azure pipeline" : "Resilient demo pipeline"}
              </p>
              <p className="text-xs mt-0.5">{analysis.pipeline.message}</p>
            </div>
            <span className="text-[10px] font-semibold whitespace-nowrap">
              DI: {analysis.pipeline.documentIntelligence} · AI: {analysis.pipeline.claimUnderstanding}
            </span>
          </div>

          {/* Claim Header */}
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
              <div>
                <label htmlFor="policy-selector" className="text-xs text-slate-500">Active Policy</label>
                <select
                  id="policy-selector"
                  value={selectedPolicy}
                  disabled={claimId === "uploaded"}
                  onChange={(event) => {
                    const policyCode = event.target.value as "AD-COMP-01" | "AD-ELITE-02";
                    setSelectedPolicy(policyCode);
                    void loadAnalysis(policyCode);
                  }}
                  className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
                >
                  <option value="AD-COMP-01">AD-COMP-01</option>
                  <option value="AD-ELITE-02">AD-ELITE-02</option>
                </select>
              </div>
              <div><p className="text-xs text-slate-500">IDV</p><p className="font-semibold text-slate-800">{formatINR(claim.context.policySchedule.idv)}</p></div>
              <div><p className="text-xs text-slate-500">Deductible</p><p className="font-semibold text-slate-800">{formatINR(claim.context.policySchedule.compulsoryDeductible)}</p></div>
              <div><p className="text-xs text-slate-500">Garage</p><p className="font-semibold text-slate-800">{claim.context.garage.name}</p></div>
              <div><p className="text-xs text-slate-500">Network</p><p className="font-semibold text-slate-800 capitalize">{claim.context.garage.networkStatus.replace("_", "-")}</p></div>
              <div><p className="text-xs text-slate-500">Completeness</p><p className="font-semibold text-slate-800">{completeness}%</p></div>
            </div>
            {claim.context.policySchedule.activeAddOns.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500">Active add-ons:</span>
                {claim.context.policySchedule.activeAddOns.map((a) => (
                  <span key={a} className="text-xs px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">{a.replace(/_/g, " ")}</span>
                ))}
                {claim.context.policySchedule.activeAddOns.includes("ZERO_DEPRECIATION") && (
                  <span className="text-xs text-slate-500">· Zero Dep: {claim.context.policySchedule.odClaimsThisPolicyYear}/2 claims used</span>
                )}
              </div>
            )}
          </Card>

          {/* Document Viewer + Repair Table */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Document Viewer */}
            <Card>
              <CardHeader title="Document Viewer — Workshop Estimate" badge={<SourceBadge type="AI" title="Azure Document Intelligence" />} />
              <div className="p-3 max-h-[500px] overflow-auto bg-slate-50">
                <div className="relative">
                  {isPdfDocument ? (
                    <iframe
                      src={claim.estimateImage}
                      title="Uploaded workshop estimate"
                      className="h-[470px] w-full rounded border border-slate-200 bg-white"
                    />
                  ) : (
                    <img
                      src={claim.estimateImage}
                      alt="Workshop Estimate"
                      className="block w-full rounded border border-slate-200"
                    />
                  )}
                  {!isPdfDocument && sourceBlocks.map((block) => {
                    const box = polygonBox(block.polygon);
                    if (!box) return null;
                    const item = lineItems.find((line) => line.sourceBlockIds.includes(block.blockId));
                    if (!item) return null;
                    const active = highlightedBlockIds.has(block.blockId);
                    return (
                      <button
                        key={block.blockId}
                        type="button"
                        aria-label={`Highlight ${item.normalizedDescription}`}
                        title={block.text}
                        onClick={() => setHighlightedItemId(item.id)}
                        className={`absolute border transition-colors ${
                          active
                            ? "border-brand-600 bg-brand-400/25 ring-1 ring-brand-500"
                            : "border-transparent bg-transparent hover:border-brand-400 hover:bg-brand-200/15"
                        }`}
                        style={{
                          left: `${box.left * 100}%`,
                          top: `${box.top * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                        }}
                      />
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Select a repair row or highlighted source region to trace evidence in both directions.
                </p>
              </div>
            </Card>

            {/* Repair Table */}
            <Card>
              <CardHeader
                title={`Extracted Repair Table (${lineItems.length} lines)`}
                badge={<SourceBadge type="AI" title="Azure OpenAI claim understanding" />}
              />
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">#</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Description</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Material</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Action</th>
                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Part</th>
                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Labour</th>
                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Paint</th>
                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Total</th>
                      <th className="text-center px-2 py-2 font-semibold text-slate-600">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr
                        key={item.id}
                        onClick={() => setHighlightedItemId(highlightedItemId === item.id ? null : item.id)}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${
                          highlightedItemId === item.id ? "bg-brand-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-1.5 text-slate-700">{item.normalizedDescription}</td>
                        <td className="px-2 py-1.5 capitalize text-slate-600">{item.material}</td>
                        <td className="px-2 py-1.5 capitalize text-slate-600">{item.action}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700">{item.partCost ? formatINR(item.partCost) : "—"}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700">{item.labourCost ? formatINR(item.labourCost) : "—"}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700">{item.paintCost ? formatINR(item.paintCost) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-slate-800">{formatINR(item.totalCost || 0)}</td>
                        <td className="px-2 py-1.5 text-center">
                          <span className={`px-1 py-0.5 rounded text-[10px] ${
                            item.confidence === "high" ? "bg-green-100 text-green-600" :
                            item.confidence === "medium" ? "bg-amber-100 text-amber-600" :
                            "bg-red-100 text-red-600"
                          }`}>{item.confidence}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr className="font-semibold">
                      <td colSpan={4} className="px-2 py-2 text-slate-700">Totals</td>
                      <td className="px-2 py-2 text-right text-slate-800">{formatINR(claim.structuredClaim.estimate.partsTotal)}</td>
                      <td className="px-2 py-2 text-right text-slate-800">{formatINR(claim.structuredClaim.estimate.labourTotal)}</td>
                      <td className="px-2 py-2 text-right text-slate-800">{formatINR(claim.structuredClaim.estimate.paintTotal)}</td>
                      <td className="px-2 py-2 text-right text-slate-900">{formatINR(claim.structuredClaim.estimate.grandTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Document Completeness & Missing Information" badge={<SourceBadge type="RULE" />} />
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full ${completeness >= 90 ? "bg-green-500" : completeness >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${completeness}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-800">{completeness}%</span>
              </div>
              {missingItems.length === 0 ? (
                <p className="text-sm text-green-700">All required and conditional demo evidence is available.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-2">
                  {missingItems.map((item) => (
                    <div key={item.field} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-amber-900">{item.description}</p>
                        <span className="text-[10px] uppercase font-semibold text-amber-700">
                          {item.required ? "Required" : "Conditional"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Settlement + CTL */}
          <Card>
            <CardHeader title="Policy-Aware Settlement Engine" badge={<SourceBadge type="RULE" title="Deterministic rule engine" />} />
            <div className="p-4">
              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500 mb-1">Workshop Estimate</p>
                  <p className="text-xl font-bold text-slate-900">{formatINR(settlement.workshopEstimate)}</p>
                </div>
                <div className="rounded-lg bg-brand-50 p-3">
                  <p className="text-xs text-brand-600 mb-1">Indicative Admissible Settlement</p>
                  <p className="text-xl font-bold text-brand-700">{formatINR(settlement.indicativeAdmissibleSettlement)}</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="text-xs text-amber-600 mb-1">Policy Adjustments</p>
                  <p className="text-xl font-bold text-amber-700">−{formatINR(settlement.totalPolicyAdjustments)}</p>
                </div>
              </div>

              {/* Settlement Bridge */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">Settlement Bridge</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm py-1 border-b border-slate-100">
                    <span className="text-slate-600">Workshop estimate</span>
                    <span className="font-medium text-slate-800">{formatINR(settlement.workshopEstimate)}</span>
                  </div>
                  {settlement.adjustments.map((adj, i) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-100">
                      <span className="text-slate-600 flex items-center gap-2">
                        {adj.description}
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{adj.ruleId}</span>
                      </span>
                      <span className="font-medium text-red-600">−{formatINR(adj.amount)}</span>
                    </div>
                  ))}
                  {settlement.zeroDepApplied && (
                    <div className="flex justify-between text-sm py-1 border-b border-slate-100">
                      <span className="text-slate-600 flex items-center gap-2">
                        Zero Depreciation applied (waived)
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">PB-ZD-LIMIT</span>
                      </span>
                      <span className="font-medium text-green-600">₹0</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm py-2 font-semibold">
                    <span className="text-slate-800">Indicative settlement</span>
                    <span className="text-brand-700">{formatINR(settlement.indicativeAdmissibleSettlement)}</span>
                  </div>
                </div>
              </div>

              {/* CTL Status */}
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-slate-500">Repair Cost / IDV: </span>
                  <span className="font-semibold text-slate-800">{(settlement.ctlRatio * 100).toFixed(0)}%</span>
                </div>
                {settlement.ctlStatus === "ctl_watch" && (
                  <span className="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs font-semibold">⚠ CTL Watch (≥60%)</span>
                )}
                {settlement.ctlStatus === "ctl_candidate" && (
                  <span className="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-semibold">🔴 CTL Candidate (&gt;75%)</span>
                )}
                {settlement.ctlStatus === "normal" && (
                  <span className="px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-semibold">Normal partial-loss</span>
                )}
              </div>
            </div>
          </Card>

          {/* Estimate Review + Risk */}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader title="Intelligent Estimate Review — Findings" badge={<div className="flex gap-1">{reviewFindings.some(f => f.source === "RULE") && <SourceBadge type="RULE" />}{reviewFindings.some(f => f.source === "SYNTHETIC") && <SourceBadge type="SYNTHETIC" />}{reviewFindings.some(f => f.source === "AI") && <SourceBadge type="AI" />}</div>} />
              <div className="p-3 space-y-2 max-h-[400px] overflow-auto">
                {reviewFindings.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">No review findings. All checks passed.</p>
                ) : (
                  reviewFindings.map((f) => (
                    <div key={f.id} className={`rounded-lg border p-3 text-sm ${
                      f.severity === "critical" ? "border-red-300 bg-red-50" :
                      f.severity === "high" ? "border-red-200 bg-red-50/50" :
                      f.severity === "medium" ? "border-amber-200 bg-amber-50/50" :
                      "border-slate-200 bg-slate-50"
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-semibold uppercase ${f.severity === "high" || f.severity === "critical" ? "text-red-600" : f.severity === "medium" ? "text-amber-600" : "text-slate-500"}`}>{f.severity}</span>
                            <span className="text-[10px] text-slate-400 uppercase">{f.type}</span>
                            <SourceBadge type={f.source as "AI" | "RULE" | "SYNTHETIC"} />
                            {f.ruleId && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{f.ruleId}</span>}
                          </div>
                          <p className="text-slate-700">{f.description}</p>
                        </div>
                        {f.amount > 0 && (
                          <span className="text-sm font-medium text-amber-600 whitespace-nowrap">{formatINR(f.amount)}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Amount Requiring Verification (does NOT reduce settlement)</span>
                  <span className="font-semibold text-amber-600">{formatINR(amountUnderReview)}</span>
                </div>
              </div>
            </Card>

            {/* Review Risk */}
            <Card>
              <CardHeader title="Review Risk Score" badge={<SourceBadge type="RULE" />} />
              <div className="p-4">
                <div className="text-center mb-4">
                  <p className={`text-4xl font-bold ${riskColors[reviewRisk.band]}`}>{reviewRisk.score}</p>
                  <p className="text-sm text-slate-500">/ 100</p>
                  <p className={`text-sm font-semibold ${riskColors[reviewRisk.band]}`}>{reviewRisk.band}</p>
                  <p className="text-[10px] text-slate-400 mt-1">Internal measure — NOT a fraud probability</p>
                </div>
                <div className="space-y-2">
                  {reviewRisk.drivers.map((d, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-slate-600">{d.driver}</span>
                        <span className="font-medium text-slate-700">+{d.contribution}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-400 rounded-full" style={{ width: `${(d.contribution / d.weight) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Routing + SIU + Authority */}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader title="Claims Routing" badge={<SourceBadge type="RULE" />} />
              <div className="p-4">
                <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${routeColors[routing.routeColor]} mb-3`}>
                  <span className="font-semibold">{routing.routeLabel}</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Key Reasons</p>
                  {routing.reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-slate-600">
                      <span className="text-slate-400 mt-0.5">•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
                {routing.specialistTriggers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-red-600 mb-1">Specialist Triggers</p>
                    {routing.specialistTriggers.map((t, i) => <p key={i} className="text-xs text-slate-600">• {t}</p>)}
                  </div>
                )}
                {routing.desktopTriggers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-amber-600 mb-1">Desktop Triggers</p>
                    {routing.desktopTriggers.map((t, i) => <p key={i} className="text-xs text-slate-600">• {t}</p>)}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="SIU Referral Decision" badge={<SourceBadge type="RULE" />} />
              <div className="p-4">
                <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border mb-3 ${
                  siu.referral === "recommended" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"
                }`}>
                  <span className="font-semibold">{siu.referral === "recommended" ? "Recommended" : "Not Required"}</span>
                </div>
                <p className="text-sm text-slate-600">{siu.reason}</p>
                {siu.integrityConcerns.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 mb-1">Integrity Concerns</p>
                    {siu.integrityConcerns.map((c, i) => <p key={i} className="text-xs text-slate-600">• {c}</p>)}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Required Approval Authority" badge={<SourceBadge type="RULE" />} />
              <div className="p-4">
                <p className="text-lg font-bold text-slate-800 mb-1">{approvalAuthority.level}</p>
                <p className="text-sm text-slate-500 mb-3">{approvalAuthority.amountRange}</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between p-2 rounded bg-slate-50">
                    <span>Claims Officer</span><span className="text-slate-500">≤ ₹1.5L</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-slate-50">
                    <span>Claims Manager</span><span className="text-slate-500">₹1.5L–₹5L</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-slate-50">
                    <span>Senior Claims Authority</span><span className="text-slate-500">&gt; ₹5L</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2">Rule: {approvalAuthority.ruleId} · SOP CLM-MTR-01 §3.2</p>
              </div>
            </Card>
          </div>

          {/* Human Decision */}
          <Card>
            <CardHeader title="Human Decision" badge={<SourceBadge type="HUMAN" />} />
            <div className="p-4">
              {decisionRecorded ? (
                <div className="text-center py-6">
                  <div className="inline-flex items-center gap-2 text-green-600 font-semibold mb-2">
                    <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">✓</span>
                    Decision Recorded
                  </div>
                  <p className="text-sm text-slate-500">{extraAudit[extraAudit.length - 1]?.action}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {[
                      { val: "accept", label: "Accept Recommendation" },
                      { val: "change_route", label: "Change Route" },
                      { val: "request_evidence", label: "Request Additional Evidence" },
                      { val: "escalate_specialist", label: "Escalate to Specialist" },
                      { val: "refer_siu", label: "Refer to SIU" },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => setDecision(opt.val)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          decision === opt.val
                            ? "bg-brand-600 text-white border-brand-600"
                            : "bg-white text-slate-700 border-slate-200 hover:border-brand-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {decision && decision !== "accept" && (
                    <div className="space-y-2">
                      <select
                        value={reasonCode}
                        onChange={(e) => setReasonCode(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                      >
                        <option value="">Select reason code…</option>
                        <option value="H01">H01 — Additional physical inspection</option>
                        <option value="H02">H02 — Policy interpretation</option>
                        <option value="H03">H03 — Repair methodology</option>
                        <option value="H04">H04 — Customer evidence</option>
                        <option value="H05">H05 — Escalation concern</option>
                        <option value="H06">H06 — Data correction</option>
                      </select>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Optional comment…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                        rows={2}
                      />
                    </div>
                  )}
                  {decisionError && (
                    <p className="text-sm text-red-600">{decisionError}</p>
                  )}
                  <button
                    onClick={recordDecision}
                    disabled={!decision || (decision !== "accept" && !reasonCode)}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-700"
                  >
                    Record Decision
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Audit Timeline */}
          <Card>
            <CardHeader title="Audit Timeline" badge={<SourceBadge type="RULE" />} />
            <div className="p-4">
              <div className="space-y-2">
                {auditTrail.map((evt) => (
                  <div key={evt.id} className="flex items-start gap-3 text-sm">
                    <span className="text-xs text-slate-400 font-mono whitespace-nowrap mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${
                      evt.actor === "AZURE_DI" || evt.actor === "AZURE_OPENAI" ? "bg-purple-100 text-purple-600" :
                      evt.actor === "RULE_ENGINE" ? "bg-blue-100 text-blue-600" :
                      evt.actor === "USER" ? "bg-green-100 text-green-600" :
                      "bg-slate-100 text-slate-500"
                    }`}>{evt.actor}</span>
                    <span className="text-slate-700">{evt.action}</span>
                  </div>
                ))}
                {extraAudit.map((evt, i) => (
                  <div key={`extra-${i}`} className="flex items-start gap-3 text-sm">
                    <span className="text-xs text-slate-400 font-mono whitespace-nowrap mt-0.5">
                      {new Date(evt.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-green-100 text-green-600 whitespace-nowrap">USER</span>
                    <span className="text-slate-700">{evt.action}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Decision Summary Rail */}
        <div className="w-72 flex-shrink-0 hidden xl:block">
          <div className="sticky top-20">
            <Card className="p-4 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2">Decision Summary</h3>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Settlement</p>
                <p className="text-lg font-bold text-brand-700">{formatINR(settlement.indicativeAdmissibleSettlement)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Under Review</p>
                <p className="text-lg font-bold text-amber-600">{formatINR(amountUnderReview)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Review Risk</p>
                <p className={`text-lg font-bold ${riskColors[reviewRisk.band]}`}>{reviewRisk.score} / 100</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Route</p>
                <p className="text-sm font-semibold text-slate-800">{routing.routeLabel}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">SIU</p>
                <p className={`text-sm font-semibold ${siu.referral === "recommended" ? "text-red-600" : "text-green-600"}`}>
                  {siu.referral === "recommended" ? "Recommended" : "No"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Authority</p>
                <p className="text-sm font-semibold text-slate-800">{approvalAuthority.level}</p>
              </div>
              <button
                onClick={() => setRagOpen(true)}
                className="w-full mt-2 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
              >
                Ask ClaimIQ
              </button>
            </Card>
          </div>
        </div>
      </div>

      {/* RAG Drawer */}
      {ragOpen && (
        <div className="fixed inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setRagOpen(false)} />
          <div className="relative w-full max-w-md bg-white shadow-xl h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Ask ClaimIQ</h3>
                <SourceBadge type="RAG" />
              </div>
              <button onClick={() => setRagOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-2">Suggested questions:</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedQuestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => { setRagQuestion(q); }}
                      className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 border border-slate-200"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              {ragAnswer && (
                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase text-indigo-600">
                      {ragAnswer.retrievalMode?.replace(/_/g, " ") || "Retrieved evidence"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{ragAnswer.answer}</p>
                  {ragAnswer.notice && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                      {ragAnswer.notice}
                    </p>
                  )}
                  {ragAnswer.calculation && (
                    <div className="text-xs text-slate-600 bg-white rounded p-2 border border-slate-100">
                      <p className="font-semibold mb-1">Calculation</p>
                      <pre className="whitespace-pre-wrap font-sans">{ragAnswer.calculation}</pre>
                    </div>
                  )}
                  {ragAnswer.evidenceFound && ragAnswer.sources.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-1">Evidence</p>
                      {ragAnswer.sources.map((s, i) => (
                        <div key={i} className="text-xs text-slate-600">
                          <span className="font-medium">{s.document}</span>
                          {s.clause && <span> · Clause {s.clause}</span>}
                          {s.page && <span> · Page {s.page}</span>}
                          {s.ruleId && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{s.ruleId}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {!ragAnswer.evidenceFound && (
                    <p className="text-xs text-amber-600 font-medium">No sufficiently relevant policy or SOP evidence was found. Human review is required.</p>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-2">
              <input
                type="text"
                value={ragQuestion}
                onChange={(e) => setRagQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askRAG()}
                placeholder="Ask a policy or routing question…"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm"
              />
              <button
                onClick={askRAG}
                disabled={ragLoading || !ragQuestion.trim()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-700"
              >
                {ragLoading ? "…" : "Ask"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Ask button */}
      <button
        onClick={() => setRagOpen(true)}
        className="xl:hidden fixed bottom-4 right-4 px-4 py-3 rounded-full bg-brand-600 text-white text-sm font-medium shadow-lg z-10"
      >
        Ask ClaimIQ
      </button>
    </div>
  );
}
