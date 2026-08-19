import type { DemoClaim, RAGAnswer } from "@/lib/types";
import { localSearch, retrieveByRuleId } from "./localSearch";
import { isLiveMode } from "@/lib/azure/config";
import { azureSearch, azureSearchByRuleId } from "@/lib/azure/search";
import { generateGroundedAnswer } from "@/lib/azure/ragAnswer";
import { getRule } from "@/lib/rules/ruleRegistry";

const docTitles: Record<string, string> = {
  "AD-COMP-01": "AsterDrive Comprehensive Private Car Policy",
  "AD-ELITE-02": "AsterDrive Elite Protect Private Car Policy",
  "CLM-MTR-01": "Motor Own-Damage Claims Handling SOP",
  "CLM-MTR-02": "Complex and High-Risk Motor Claims Review & SIU Escalation SOP",
};

function extractRuleIdFromQuestion(question: string): string | null {
  const rulePattern = /\b(PA-[A-Z]+(?:-[A-Z]+)*|PB-[A-Z]+(?:-[A-Z]+)*|SOP-[A-Z]+(?:-[A-Z]+)*)\b/;
  const match = question.toUpperCase().match(rulePattern);
  return match ? match[0] : null;
}

function isRoutingQuestion(question: string): boolean {
  const routingKeywords = ["route", "routing", "fast track", "desktop", "specialist", "escalat", "siu", "review", "approve", "authority", "approval"];
  return routingKeywords.some((k) => question.toLowerCase().includes(k));
}

export async function answerQuestion(question: string, claim?: DemoClaim): Promise<RAGAnswer> {
  // Mode B: exact rule lookup (PRD §74 — preferred when explaining a specific rule)
  const ruleId = extractRuleIdFromQuestion(question);
  if (ruleId) {
    const rule = getRule(ruleId);
    if (rule) {
      let chunks;
      if (isLiveMode()) {
        try {
          chunks = await azureSearchByRuleId(ruleId, {
            documentType: rule.documentType === "POLICY" ? "motor_policy" : "claims_sop",
            topK: 3,
          });
        } catch (err) {
          console.error("[ClaimIQ] Azure Search by ruleId failed, falling back:", err);
          chunks = retrieveByRuleId(ruleId).map((chunk) => ({ chunk, score: 1 }));
        }
      } else {
        chunks = retrieveByRuleId(ruleId).map((chunk) => ({ chunk, score: 1 }));
      }

      if (chunks.length > 0) {
        // Try grounded answer via Azure OpenAI
        const grounded = await generateGroundedAnswer(question, chunks.map((c) => c.chunk));
        if (grounded) return grounded;

        // Fallback: deterministic answer from rule registry + chunk content
        const bestChunk = chunks[0];
        return {
          answer: `${rule.description}. ${bestChunk.chunk.content.substring(0, 500)}...`,
          calculation: undefined,
          sources: chunks.slice(0, 3).map((c) => ({
            document: docTitles[c.chunk.documentCode] || c.chunk.documentCode,
            clause: c.chunk.clauseNumber || (c.chunk.ruleIds.includes(ruleId) ? rule.clauseNumber : undefined),
            page: c.chunk.pageNumber,
            ruleId,
          })),
          evidenceFound: true,
        };
      }
    }
  }

  // Mode A: hybrid keyword + vector retrieval (PRD §74)
  const routing = isRoutingQuestion(question);
  const documentType = routing ? "claims_sop" : "motor_policy";
  const policyCode = claim?.context.policySchedule.policyCode;

  const searchOptions = {
    documentType,
    policyCode: routing ? undefined : policyCode,
    topK: 5,
  };

  let results;
  if (isLiveMode()) {
    try {
      results = await azureSearch(question, searchOptions);
    } catch (err) {
      console.error("[ClaimIQ] Azure AI Search failed, falling back to local search:", err);
      results = localSearch(question, searchOptions);
    }
  } else {
    results = localSearch(question, searchOptions);
  }

  if (results.length === 0) {
    return {
      answer: "No sufficiently relevant policy or SOP evidence was found. Human review is required.",
      sources: [],
      evidenceFound: false,
    };
  }

  // Try grounded answer via Azure OpenAI (PRD §76)
  const grounded = await generateGroundedAnswer(question, results.map((r) => r.chunk));
  if (grounded) return grounded;

  // Fallback: concatenate retrieved chunk content as the answer
  const topChunks = results.slice(0, 3);
  const answerText = topChunks
    .map((r) => r.chunk.content.substring(0, 600))
    .join("\n\n");

  const relevantRuleIds = [...new Set(topChunks.flatMap((r) => r.chunk.ruleIds))].slice(0, 3);

  return {
    answer: answerText.substring(0, 1500),
    sources: topChunks.map((r) => ({
      document: docTitles[r.chunk.documentCode] || r.chunk.documentCode,
      clause: r.chunk.clauseNumber,
      page: r.chunk.pageNumber,
      ruleId: r.chunk.ruleIds.find((rid) => relevantRuleIds.includes(rid)),
    })),
    evidenceFound: true,
  };
}

export async function answerWithCalculation(
  question: string,
  claim: DemoClaim,
  settlement: { adjustments: { ruleId: string; description: string; amount: number; documentCode: string; clauseNumber: string; category: string }[] }
): Promise<RAGAnswer> {
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("depreciation")) {
    const depAdjustments = settlement.adjustments.filter((a) => a.category === "depreciation");
    if (depAdjustments.length > 0) {
      const total = depAdjustments.reduce((s, a) => s + a.amount, 0);
      const baseAnswer = await answerQuestion(question, claim);
      return {
        ...baseAnswer,
        calculation: `Total depreciation deductions: ₹${total.toLocaleString("en-IN")}\n` +
          depAdjustments.map((a) => `  ${a.description}: -₹${a.amount.toLocaleString("en-IN")} [${a.ruleId}]`).join("\n"),
      };
    }
  }

  if (lowerQ.includes("deductible")) {
    const dedAdjustments = settlement.adjustments.filter((a) => a.category === "deductible");
    if (dedAdjustments.length > 0) {
      const baseAnswer = await answerQuestion(question, claim);
      return {
        ...baseAnswer,
        calculation: dedAdjustments.map((a) => `${a.description}`).join("\n"),
      };
    }
  }

  return answerQuestion(question, claim);
}
