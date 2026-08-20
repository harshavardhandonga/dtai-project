import Link from "next/link";
import { demoClaims } from "@/lib/demo/claims";
import { SourceBadge } from "@/components/ui/badge";
import { UploadEstimate } from "@/components/intake/UploadEstimate";
import { isDocumentIntelligenceConfigured, isOpenAiConfigured } from "@/lib/azure/config";

export default function IntakePage() {
  const liveConfigured = isDocumentIntelligenceConfigured() && isOpenAiConfigured();
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-lg">
              C
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">ClaimIQ</h1>
              <p className="text-xs text-slate-500">AI-Assisted Motor Claims Decision Workbench</p>
            </div>
          </div>
          <SourceBadge
            type={liveConfigured ? "LIVE" : "DEMO"}
            title={liveConfigured ? "Live Azure services configured" : "Demo mode — cached AI responses"}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Claim Intake</h2>
          <p className="text-slate-600">
            Select a demo claim to begin AI-assisted assessment. Each claim demonstrates a different routing outcome.
          </p>
        </div>

        <UploadEstimate />

        <div className="grid gap-5 md:grid-cols-3">
          {demoClaims.map((claim, idx) => {
            const colors = [
              { border: "border-green-200", bg: "bg-green-50", text: "text-green-700", label: "Fast Track" },
              { border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700", label: "Desktop Review" },
              { border: "border-red-200", bg: "bg-red-50", text: "text-red-700", label: "Specialist Review" },
            ];
            const c = colors[idx];

            return (
              <Link
                key={claim.claimId}
                href={`/claim/${claim.claimId}`}
                className={`group block rounded-xl border ${c.border} bg-white p-5 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${c.bg} ${c.text}`}>
                    {c.label}
                  </span>
                  <span className="text-xs text-slate-400">{claim.claimId}</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1">{claim.label}</h3>
                <p className="text-xs text-slate-500 mb-4">{claim.purpose}</p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Vehicle</dt>
                    <dd className="font-medium text-slate-700">{claim.context.vehicle.make} {claim.context.vehicle.model}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Policy</dt>
                    <dd className="font-medium text-slate-700">{claim.context.policySchedule.policyCode}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Garage</dt>
                    <dd className="font-medium text-slate-700">{claim.context.garage.networkStatus === "network" ? "Network" : "Non-network"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">IDV</dt>
                    <dd className="font-medium text-slate-700">₹{(claim.context.policySchedule.idv / 100000).toFixed(1)}L</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center gap-2 text-sm text-brand-600 font-medium group-hover:gap-3 transition-all">
                  Open workspace →
                </div>
              </Link>
            );
          })}
        </div>

        {/* Governance Panel */}
        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Governance</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500">AI Role</p>
              <p className="font-medium text-slate-700">Decision support</p>
            </div>
            <div>
              <p className="text-slate-500">Settlement</p>
              <p className="font-medium text-slate-700">Deterministic rules</p>
            </div>
            <div>
              <p className="text-slate-500">Policy Evidence</p>
              <p className="font-medium text-slate-700">RAG</p>
            </div>
            <div>
              <p className="text-slate-500">Risk Signals</p>
              <p className="font-medium text-slate-700">Rules + benchmarks + AI</p>
            </div>
            <div>
              <p className="text-slate-500">Final Authority</p>
              <p className="font-medium text-slate-700">Human claims personnel</p>
            </div>
            <div>
              <p className="text-slate-500">Training Data</p>
              <p className="font-medium text-slate-700">No custom model training</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
