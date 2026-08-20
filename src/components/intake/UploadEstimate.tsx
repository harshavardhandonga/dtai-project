"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { SourceBadge } from "@/components/ui/badge";
import type { ClaimAnalysisResult } from "@/lib/types";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function UploadEstimate() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [claimId, setClaimId] = useState("CLM-CRETA-001");
  const [policyCode, setPolicyCode] = useState("AD-COMP-01");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("claimId", claimId);
      form.set("policyCode", policyCode);
      const response = await fetch("/api/claim/analyze-document", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Document analysis failed");

      const documentUrl = await readAsDataUrl(file);
      const analysis = data as ClaimAnalysisResult;
      analysis.claim.estimateImage = documentUrl;
      sessionStorage.setItem("claimiq-upload-analysis", JSON.stringify(analysis));
      router.push("/claim/uploaded");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-200 bg-white p-5 shadow-sm mb-8">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-slate-900">Analyze a synthetic workshop estimate</h3>
          <p className="text-sm text-slate-500 mt-1">
            PDF, PNG, JPG or JPEG up to 3 MB. The selected demo context supplies trusted policy, vehicle and garage data.
          </p>
        </div>
        <SourceBadge type="LIVE" title="Uses the live Azure pipeline when configured" />
      </div>
      <div className="grid md:grid-cols-[1.5fr_1fr_1fr_auto] gap-3 items-end">
        <label className="text-xs text-slate-600">
          Workshop estimate
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Synthetic claim context
          <select value={claimId} onChange={(event) => setClaimId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="CLM-CRETA-001">Creta / Fast Track</option>
            <option value="CLM-HCITY-002">Honda / Desktop</option>
            <option value="CLM-BMW-003">BMW / Specialist</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Active policy
          <select value={policyCode} onChange={(event) => setPolicyCode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="AD-COMP-01">AD-COMP-01</option>
            <option value="AD-ELITE-02">AD-ELITE-02</option>
          </select>
        </label>
        <button disabled={!file || loading} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Use synthetic documents only. Files are processed in memory and are not persisted.</p>
      {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
    </form>
  );
}

