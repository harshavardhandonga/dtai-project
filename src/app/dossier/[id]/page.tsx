import Link from "next/link";
import { getDemoClaim } from "@/lib/demo/claims";
import { analyzeClaim } from "@/lib/analysis";
import { SourceBadge, formatINR } from "@/components/ui/badge";
import { notFound } from "next/navigation";

export default function DossierPage({ params }: { params: { id: string } }) {
  const claim = getDemoClaim(params.id);
  if (!claim) notFound();

  const analysis = analyzeClaim(claim);
  const { settlement, reviewFindings, reviewRisk, routing, siu, approvalAuthority, completeness, auditTrail } = analysis;
  const amountUnderReview = reviewFindings.reduce((s, f) => s + f.amount, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold">C</span>
              <span className="font-semibold text-slate-900">ClaimIQ</span>
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-sm text-slate-600">Decision Dossier</span>
          </div>
          <Link href={`/claim/${params.id}`} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            ← Back to Workspace
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Decision Dossier</h1>
          <p className="text-slate-500">{claim.claimId} · {claim.label}</p>
        </div>

        {/* Claim Details */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Claim Details</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-slate-500">Vehicle</p><p className="font-medium">{claim.context.vehicle.make} {claim.context.vehicle.model} ({claim.context.vehicle.registration})</p></div>
            <div><p className="text-xs text-slate-500">Policy</p><p className="font-medium">{claim.context.policySchedule.policyCode} · {claim.context.policySchedule.policyNumber}</p></div>
            <div><p className="text-xs text-slate-500">IDV</p><p className="font-medium">{formatINR(claim.context.policySchedule.idv)}</p></div>
            <div><p className="text-xs text-slate-500">Garage</p><p className="font-medium">{claim.context.garage.name} ({claim.context.garage.networkStatus})</p></div>
            <div><p className="text-xs text-slate-500">Loss Date</p><p className="font-medium">{claim.context.claim.lossDate}</p></div>
            <div><p className="text-xs text-slate-500">Completeness</p><p className="font-medium">{completeness}%</p></div>
          </div>
        </section>

        {/* Settlement */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Indicative Settlement</h2>
            <SourceBadge type="RULE" />
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div><p className="text-xs text-slate-500">Workshop Estimate</p><p className="text-lg font-bold">{formatINR(settlement.workshopEstimate)}</p></div>
            <div><p className="text-xs text-slate-500">Policy Adjustments</p><p className="text-lg font-bold text-amber-600">−{formatINR(settlement.totalPolicyAdjustments)}</p></div>
            <div><p className="text-xs text-slate-500">Admissible Settlement</p><p className="text-lg font-bold text-brand-700">{formatINR(settlement.indicativeAdmissibleSettlement)}</p></div>
          </div>
          <div className="space-y-1">
            {settlement.adjustments.map((adj, i) => (
              <div key={i} className="flex justify-between text-sm py-1 border-b border-slate-50">
                <span className="text-slate-600">{adj.description} <span className="text-[10px] text-blue-600">{adj.ruleId}</span></span>
                <span className="text-red-600">−{formatINR(adj.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Review + Routing */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">Review Findings</h2>
              <SourceBadge type="RULE" />
            </div>
            <p className="text-sm text-slate-600 mb-2">Amount Under Review: <span className="font-semibold text-amber-600">{formatINR(amountUnderReview)}</span></p>
            <p className="text-sm text-slate-600">Review Risk: <span className="font-semibold">{reviewRisk.score}/100 ({reviewRisk.band})</span></p>
            <div className="mt-2 space-y-1">
              {reviewFindings.map((f) => (
                <p key={f.id} className="text-xs text-slate-500">• {f.description}</p>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">Routing & Authority</h2>
              <SourceBadge type="RULE" />
            </div>
            <div className="space-y-2 text-sm">
              <div><p className="text-xs text-slate-500">Primary Route</p><p className="font-medium">{routing.routeLabel}</p></div>
              <div><p className="text-xs text-slate-500">SIU Referral</p><p className={`font-medium ${siu.referral === "recommended" ? "text-red-600" : "text-green-600"}`}>{siu.referral === "recommended" ? "Recommended" : "Not Required"}</p></div>
              <div><p className="text-xs text-slate-500">Approval Authority</p><p className="font-medium">{approvalAuthority.level}</p></div>
            </div>
          </div>
        </section>

        {/* Audit Summary */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Audit Summary</h2>
          <div className="space-y-1">
            {auditTrail.map((evt) => (
              <div key={evt.id} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-slate-400 font-mono">{new Date(evt.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-[10px] px-1 rounded bg-slate-100 text-slate-500">{evt.actor}</span>
                <span className="text-slate-600">{evt.action}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="text-center text-xs text-slate-400 py-4">
          ClaimIQ Decision Dossier · Generated {new Date().toLocaleString("en-IN")} · <SourceBadge type={claim.aiMode === "LIVE" ? "LIVE" : "DEMO"} />
        </div>
      </main>
    </div>
  );
}
