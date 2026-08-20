import assert from "node:assert/strict";

const baseUrl = process.env.CLAIMIQ_BASE_URL || "http://localhost:5173";

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

const scenarios = [
  ["CLM-CRETA-001", "fast_track", 41064],
  ["CLM-HCITY-002", "desktop_review", 123664],
  ["CLM-BMW-003", "specialist_review", 458784],
];

for (const [claimId, expectedRoute, expectedEstimate] of scenarios) {
  const { response, data } = await post("/api/claim/analyze", { claimId });
  assert.equal(response.status, 200, `${claimId} should analyze`);
  assert.equal(data.routing.primaryRoute, expectedRoute, `${claimId} route`);
  assert.equal(data.settlement.workshopEstimate, expectedEstimate, `${claimId} estimate`);
}

const bmw = (await post("/api/claim/analyze", { claimId: "CLM-BMW-003" })).data;
assert.equal(bmw.siu.referral, "not_required", "technical BMW findings must not auto-trigger SIU");
assert.ok(bmw.reviewFindings.some((finding) => finding.type === "arithmetic"));
assert.ok(bmw.reviewFindings.some((finding) => finding.type === "duplicate"));
assert.ok(bmw.reviewFindings.some((finding) => finding.type === "semantic"));

const cretaStandard = (await post("/api/claim/analyze", {
  claimId: "CLM-CRETA-001",
  policyCode: "AD-COMP-01",
})).data;
const cretaElite = (await post("/api/claim/analyze", {
  claimId: "CLM-CRETA-001",
  policyCode: "AD-ELITE-02",
})).data;
assert.ok(
  cretaElite.settlement.indicativeAdmissibleSettlement >
    cretaStandard.settlement.indicativeAdmissibleSettlement,
  "Policy B should materially change settlement"
);
assert.equal(cretaElite.settlement.zeroDepApplied, true);

const rag = (await post("/api/rag/query", {
  question: "Why was depreciation applied?",
  claimId: "CLM-CRETA-001",
  policyCode: "AD-COMP-01",
})).data;
assert.equal(rag.evidenceFound, true);
assert.ok(rag.sources.some((source) => source.ruleId === "PA-DEP-PLASTIC" && source.clause));
assert.ok(rag.sources.some((source) => source.ruleId === "PA-PAINT" && source.clause));

const invalidDecision = await post("/api/human/decision", {
  claimId: "CLM-BMW-003",
  action: "change_route",
});
assert.equal(invalidDecision.response.status, 400, "override reason is mandatory");

const validDecision = await post("/api/human/decision", {
  claimId: "CLM-BMW-003",
  action: "change_route",
  reasonCode: "H03",
});
assert.equal(validDecision.response.status, 200);
assert.equal(validDecision.data.success, true);

console.log("ClaimIQ smoke tests passed.");

