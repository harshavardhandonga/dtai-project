import type { DemoClaim, RAGAnswer } from "@/lib/types";
import { localSearch, retrieveByRuleId } from "./localSearch";
import { isLiveMode } from "@/lib/azure/config";
import { azureSearch } from "@/lib/azure/search";
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
  // Mode B: exact rule lookup (deterministic — uses the local rule registry)
  const ruleId = extractRuleIdFromQuestion(question);
  if (ruleId) {
    const rule = getRule(ruleId);
    const chunks = retrieveByRuleId(ruleId);
    if (rule && chunks.length > 0) {
      const bestChunk = chunks[0];
      return {
        answer: `${rule.description}. ${bestChunk.content.substring(0, 500)}...`,
        calculation: undefined,
        sources: chunks.slice(0, 3).map((c) => ({
          document: docTitles[c.documentCode] || c.documentCode,
          clause: c.ruleIds.includes(ruleId) ? rule.clauseNumber : undefined,
          page: c.pageNumber,
          ruleId,
        })),
        evidenceFound: true,
      };
    }
  }

  // Mode A: hybrid keyword + vector retrieval.
  // Live mode queries Azure AI Search; on any error it falls back to the
  // local keyword index so RAG always returns an answer.
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

  // Build answer from top chunks
  const topChunks = results.slice(0, 3);
  const answerText = topChunks
    .map((r) => r.chunk.content.substring(0, 600))
    .join("\n\n");

  // Extract relevant rule IDs from chunks
  const relevantRuleIds = [...new Set(topChunks.flatMap((r) => r.chunk.ruleIds))].slice(0, 3);

  return {
    answer: answerText.substring(0, 1500),
    sources: topChunks.map((r) => ({
      document: docTitles[r.chunk.documentCode] || r.chunk.documentCode,
      clause: undefined,
      page: r.chunk.pageNumber,
      ruleId: r.chunk.ruleIds.find((rid) => relevantRuleIds.includes(rid)),
    })),
    evidenceFound: true,
  };
}

export async function answerWithCalculation(
  question: string,
  claim: DemoClaim,
  settlement: { adjustments: { ruleId: string; description: string; amount: number; documentCode: string; clauseNumber: string }[] }
): Promise<RAGAnswer> {
  // Check if asking about a specific adjustment
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
