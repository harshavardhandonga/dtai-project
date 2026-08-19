// Azure OpenAI grounded RAG answer generation.
// Per PRD §76: "Top relevant clauses → Azure OpenAI → Grounded answer"
// Per PRD §79: hallucination guardrail — if no relevant evidence was retrieved,
// the model must not use generic insurance knowledge to fill the gap.

import { azureConfig } from "./config";
import { isOpenAiReachable } from "./openai";
import type { RAGAnswer } from "@/lib/types";
import type { KnowledgeChunk } from "@/lib/rag/knowledgeData";

const API_VERSION = "2024-02-15-preview";

const docTitles: Record<string, string> = {
  "AD-COMP-01": "AsterDrive Comprehensive Private Car Policy",
  "AD-ELITE-02": "AsterDrive Elite Protect Private Car Policy",
  "CLM-MTR-01": "Motor Own-Damage Claims Handling SOP",
  "CLM-MTR-02": "Complex and High-Risk Motor Claims Review & SIU Escalation SOP",
};

const SYSTEM_PROMPT = `You are ClaimIQ's policy/SOP explanation assistant for Indian motor insurance claims.
You answer questions about claim decisions using ONLY the retrieved policy/SOP evidence provided to you.

Rules:
- Answer using ONLY the provided evidence. Never use generic insurance knowledge.
- If the evidence does not contain the answer, say: "No sufficiently relevant policy or SOP evidence was found. Human review is required."
- Keep answers concise (2-4 sentences).
- When explaining a deduction, include the calculation if the evidence supports it.
- Cite the source document, clause number, and rule ID where applicable.
- Do not make claims about coverage or policy terms not present in the evidence.`;

interface GroundedChunk {
  content: string;
  documentCode: string;
  clauseNumber?: string;
  pageNumber: number;
  ruleIds: string[];
}

function chatUrl(): string {
  return `${azureConfig.openaiEndpoint}/openai/deployments/${azureConfig.chatDeployment}/chat/completions?api-version=${API_VERSION}`;
}

/**
 * Generate a grounded answer from retrieved evidence using Azure OpenAI.
 * Returns null if the OpenAI endpoint is unreachable (caller falls back
 * to concatenating chunk content directly).
 */
export async function generateGroundedAnswer(
  question: string,
  chunks: GroundedChunk[]
): Promise<RAGAnswer | null> {
  if (!(await isOpenAiReachable())) return null;
  if (chunks.length === 0) {
    return {
      answer: "No sufficiently relevant policy or SOP evidence was found. Human review is required.",
      sources: [],
      evidenceFound: false,
    };
  }

  const evidence = chunks
    .map((c, i) => {
      const title = docTitles[c.documentCode] || c.documentCode;
      const clause = c.clauseNumber ? ` Clause ${c.clauseNumber}.` : "";
      const rules = c.ruleIds.length > 0 ? ` Rules: ${c.ruleIds.join(", ")}.` : "";
      const page = c.pageNumber ? ` Page ${c.pageNumber}.` : "";
      return `[Evidence ${i + 1}] Source: ${title}.${clause}${page}${rules}\n${c.content}`;
    })
    .join("\n\n");

  try {
    const res = await fetch(chatUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureConfig.openaiKey!,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question: ${question}\n\nRetrieved evidence:\n${evidence}\n\nAnswer the question using ONLY the evidence above.`,
          },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Grounded answer failed (${res.status}): ${txt.substring(0, 200)}`);
    }

    const data: any = await res.json();
    const answerText: string = data?.choices?.[0]?.message?.content?.trim() ?? "";

    return {
      answer: answerText,
      sources: chunks.slice(0, 3).map((c) => ({
        document: docTitles[c.documentCode] || c.documentCode,
        clause: c.clauseNumber,
        page: c.pageNumber,
        ruleId: c.ruleIds[0],
      })),
      evidenceFound: true,
    };
  } catch (err) {
    console.error("[ClaimIQ] Grounded answer generation failed:", err);
    return null;
  }
}
