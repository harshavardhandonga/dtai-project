import type { DemoClaim, RAGAnswer } from "@/lib/types";
import { localSearch, retrieveByRuleId } from "./localSearch";
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

export function answerQuestion(question: string, claim?: DemoClaim): RAGAnswer {
  // Mode B: exact rule lookup
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

  // Mode A: hybrid keyword + vector (local fallback)
  const routing = isRoutingQuestion(question);
  const documentType = routing ? "claims_sop" : "motor_policy";
  const policyCode = claim?.context.policySchedule.policyCode;

  const results = localSearch(question, {
    documentType,
    policyCode: routing ? undefined : policyCode,
    topK: 5,
  });

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

export function answerWithCalculation(
  question: string,
  claim: DemoClaim,
  settlement: { adjustments: { ruleId: string; description: string; amount: number; documentCode: string; clauseNumber: string }[] }
): RAGAnswer {
  // Check if asking about a specific adjustment
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("depreciation")) {
    const depAdjustments = settlement.adjustments.filter((a) => a.category === "depreciation");
    if (depAdjustments.length > 0) {
      const total = depAdjustments.reduce((s, a) => s + a.amount, 0);
      const baseAnswer = answerQuestion(question, claim);
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
      const baseAnswer = answerQuestion(question, claim);
      return {
        ...baseAnswer,
        calculation: dedAdjustments.map((a) => `${a.description}`).join("\n"),
      };
    }
  }

  return answerQuestion(question, claim);
}
