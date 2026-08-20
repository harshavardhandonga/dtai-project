import type { DemoClaim, RAGAnswer } from "@/lib/types";
import { localSearch, retrieveByRuleId, type LocalSearchResult } from "./localSearch";
import { isOpenAiConfigured, isSearchConfigured } from "@/lib/azure/config";
import { azureSearch } from "@/lib/azure/search";
import { generateGroundedRagAnswer, isOpenAiReachable } from "@/lib/azure/openai";
import { getRule } from "@/lib/rules/ruleRegistry";
import { analyzeClaim } from "@/lib/analysis";

const docTitles: Record<string, string> = {
  "AD-COMP-01": "AsterDrive Comprehensive Private Car Policy",
  "AD-ELITE-02": "AsterDrive Elite Protect Private Car Policy",
  "CLM-MTR-01": "Motor Own-Damage Claims Handling SOP",
  "CLM-MTR-02": "Complex and High-Risk Motor Claims Review & SIU Escalation SOP",
};

function extractRuleIdFromQuestion(question: string): string | null {
  const match = question.toUpperCase().match(/\b(?:PA|PB|SOP|SOPB)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/);
  return match?.[0] ?? null;
}

function isRoutingQuestion(question: string): boolean {
  const keywords = [
    "route", "routing", "fast track", "desktop", "specialist", "escalat",
    "siu", "review", "approve", "authority", "approval",
  ];
  const normalized = question.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function sourceForResult(result: LocalSearchResult, preferredRuleId?: string) {
  const ruleId =
    (preferredRuleId && result.chunk.ruleIds.includes(preferredRuleId)
      ? preferredRuleId
      : result.chunk.ruleIds.find((id) => getRule(id))) ?? result.chunk.ruleIds[0];
  const rule = ruleId ? getRule(ruleId) : undefined;
  return {
    document: docTitles[result.chunk.documentCode] || result.chunk.documentCode,
    clause: rule?.clauseNumber,
    page: result.chunk.pageNumber || undefined,
    ruleId,
  };
}

function uniqueSources(results: LocalSearchResult[], preferredRuleId?: string) {
  const seen = new Set<string>();
  return results
    .map((result) => sourceForResult(result, preferredRuleId))
    .filter((source) => {
      const key = `${source.document}|${source.clause ?? ""}|${source.page ?? ""}|${source.ruleId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function readableExcerpt(content: string): string {
  return content
    .replace(/CLAIMIQ DEMO INSURANCE[^\n]*\n?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function exactRuleAnswer(ruleId: string): RAGAnswer | null {
  const rule = getRule(ruleId);
  const chunks = retrieveByRuleId(ruleId).slice(0, 3);
  if (!rule || chunks.length === 0) return null;
  const results = chunks.map((chunk, index) => ({ chunk, score: 1 - index * 0.1 }));
  return {
    answer: rule.description,
    sources: uniqueSources(results, ruleId),
    evidenceFound: true,
    retrievalMode: "RULE_LOOKUP",
  };
}

function applicationExplanation(question: string, claim: DemoClaim): RAGAnswer | null {
  const normalized = question.toLowerCase();
  const analysis = analyzeClaim(claim);

  if (/(escalat|specialist|fast track|route|routing)/.test(normalized)) {
    const ruleId = analysis.routing.primaryRoute === "specialist_review"
      ? "SOP-SP"
      : analysis.routing.primaryRoute === "fast_track"
        ? "SOP-FT"
        : "SOP-DR";
    const evidence = exactRuleAnswer(ruleId);
    return {
      answer: `ClaimIQ recommended ${analysis.routing.routeLabel}. ${analysis.routing.reasons.join("; ")}.`,
      sources: evidence?.sources ?? [],
      evidenceFound: !!evidence,
      retrievalMode: "RULE_LOOKUP",
    };
  }

  if (/\bsiu\b|investigat/.test(normalized)) {
    const evidence = exactRuleAnswer("SOP-SIU");
    return {
      answer: `${analysis.siu.referral === "recommended" ? "SIU referral is recommended." : "SIU referral is not currently required."} ${analysis.siu.reason}`,
      sources: evidence?.sources ?? [],
      evidenceFound: !!evidence,
      retrievalMode: "RULE_LOOKUP",
    };
  }

  if (/(approve|approval|authority|authoriz)/.test(normalized)) {
    const evidence = exactRuleAnswer("SOP-AUTH");
    return {
      answer: `${analysis.approvalAuthority.level} approval is required for the indicative settlement band ${analysis.approvalAuthority.amountRange}.`,
      sources: evidence?.sources ?? [],
      evidenceFound: !!evidence,
      retrievalMode: "RULE_LOOKUP",
    };
  }

  if (/under review|verification|review finding/.test(normalized)) {
    const materialFindings = analysis.reviewFindings.filter((finding) => finding.amount > 0);
    const ruleId = materialFindings.find((finding) => finding.ruleId)?.ruleId ?? "SOP-MISMATCH";
    const evidence = exactRuleAnswer(ruleId);
    return {
      answer: materialFindings.length > 0
        ? `The amount under review is driven by: ${materialFindings.map((finding) => finding.description).join(" ")} These signals do not automatically reduce settlement.`
        : "No amount is currently marked for verification.",
      sources: evidence?.sources ?? [],
      evidenceFound: !!evidence,
      retrievalMode: "RULE_LOOKUP",
    };
  }

  return null;
}

export async function answerQuestion(question: string, claim?: DemoClaim): Promise<RAGAnswer> {
  const explicitRuleId = extractRuleIdFromQuestion(question);
  if (explicitRuleId) {
    const exact = exactRuleAnswer(explicitRuleId);
    if (exact) return exact;
  }
  if (claim) {
    const explanation = applicationExplanation(question, claim);
    if (explanation) return explanation;
  }

  const routing = isRoutingQuestion(question);
  const options = {
    documentType: routing ? "claims_sop" : "motor_policy",
    policyCode: routing ? undefined : claim?.context.policySchedule.policyCode,
    topK: 5,
  };

  let results: LocalSearchResult[] = [];
  let retrievalMode: NonNullable<RAGAnswer["retrievalMode"]> = "LOCAL_KEYWORD";
  let notice: string | undefined;

  if (isSearchConfigured()) {
    try {
      const azure = await azureSearch(question, options);
      results = azure.results;
      retrievalMode = azure.mode;
    } catch (error) {
      console.error("[ClaimIQ] Azure AI Search failed, using local index:", error);
      results = localSearch(question, options);
      notice = "Azure retrieval was unavailable; the pre-indexed local knowledge corpus was used.";
    }
  } else {
    results = localSearch(question, options);
  }

  if (results.length === 0) {
    return {
      answer: "No sufficiently relevant policy or SOP evidence was found. Human review is required.",
      sources: [],
      evidenceFound: false,
      retrievalMode,
      notice,
    };
  }

  const topResults = results.slice(0, 5);
  let answer = readableExcerpt(topResults[0].chunk.content);
  let evidenceResults = topResults.slice(0, 3);

  if (retrievalMode.startsWith("AZURE") && isOpenAiConfigured()) {
    if (await isOpenAiReachable()) {
      try {
        const grounded = await generateGroundedRagAnswer(question, topResults);
        answer = grounded.answer;
        const usedIds = new Set(grounded.usedChunkIds);
        const selected = topResults.filter((result) => usedIds.has(result.chunk.id));
        if (selected.length > 0) evidenceResults = selected;
      } catch (error) {
        console.error("[ClaimIQ] Grounded RAG generation failed; using retrieved excerpt:", error);
        notice = "Retrieved evidence is shown directly because grounded answer generation was unavailable.";
      }
    } else {
      notice = "Azure Search evidence is shown directly because Azure OpenAI generation is unavailable.";
    }
  }

  return {
    answer,
    sources: uniqueSources(evidenceResults),
    evidenceFound: true,
    retrievalMode,
    notice,
  };
}

export async function answerWithCalculation(
  question: string,
  claim: DemoClaim,
  settlement: {
    adjustments: {
      ruleId: string;
      description: string;
      amount: number;
      documentCode: string;
      clauseNumber: string;
      category: string;
    }[];
  }
): Promise<RAGAnswer> {
  const normalized = question.toLowerCase();
  const category = normalized.includes("depreciation")
    ? "depreciation"
    : normalized.includes("deductible")
      ? "deductible"
      : null;

  if (!category) return answerQuestion(question, claim);

  const adjustments = settlement.adjustments.filter((adjustment) => adjustment.category === category);
  if (adjustments.length === 0) {
    return {
      answer: `No ${category} adjustment was applied to this claim under the active policy schedule.`,
      sources: [],
      evidenceFound: true,
      retrievalMode: "RULE_LOOKUP",
    };
  }

  const total = adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const ruleIds = [...new Set(adjustments.map((adjustment) => adjustment.ruleId))];
  const ruleSources = ruleIds.map((ruleId) => {
    const adjustment = adjustments.find((item) => item.ruleId === ruleId)!;
    const rule = getRule(ruleId);
    const chunk = retrieveByRuleId(ruleId)[0];
    return {
      document: docTitles[adjustment.documentCode] || adjustment.documentCode,
      clause: rule?.clauseNumber || adjustment.clauseNumber,
      page: chunk?.pageNumber,
      ruleId,
    };
  });

  return {
    answer: `ClaimIQ applied ${category} using the active policy's encoded rules. These are policy adjustments, not review signals.`,
    calculation:
      `Total ${category}: ₹${total.toLocaleString("en-IN")}\n` +
      adjustments
        .map((adjustment) =>
          `  ${adjustment.description}: -₹${adjustment.amount.toLocaleString("en-IN")} [${adjustment.ruleId}]`
        )
        .join("\n"),
    sources: ruleSources,
    evidenceFound: true,
    retrievalMode: "RULE_LOOKUP",
  };
}
