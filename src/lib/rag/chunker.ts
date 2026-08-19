// Section/clause-aware knowledge chunker.
// Re-processes the page-level knowledgeChunks into finer-grained chunks
// (~400-800 tokens) that carry clause-specific rule IDs, per the PRD:
//   "Prefer section, clause, paragraph rather than arbitrary character splitting.
//    Metadata must preserve document, clause, page, rule IDs."

import { knowledgeChunks, type KnowledgeChunk } from "./knowledgeData";
import { ruleRegistry } from "@/lib/rules/ruleRegistry";

// Build a lookup: documentCode → clauseNumber → ruleId[]
const clauseRuleMap: Record<string, Record<string, string[]>> = {};
for (const rule of ruleRegistry) {
  const doc = rule.documentCode;
  if (!clauseRuleMap[doc]) clauseRuleMap[doc] = {};
  if (!clauseRuleMap[doc][rule.clauseNumber]) clauseRuleMap[doc][rule.clauseNumber] = [];
  clauseRuleMap[doc][rule.clauseNumber].push(rule.ruleId);
}

// Rough token estimate (~4 chars per token for English text).
const TARGET_MIN_CHARS = 1200; // ~300 tokens
const TARGET_MAX_CHARS = 3200; // ~800 tokens

// Matches clause/section headers like "4.1", "12.3", "A", or "Appendix A"
const CLAUSE_SPLIT_RE = /(?=\n(?:\d+(?:\.\d+)*\s+[A-Z]|\d+\.\d+\s|Appendix\s+[A-Z]))/;

function extractClauseNumber(text: string, documentCode: string): string | null {
  const rules = clauseRuleMap[documentCode];
  if (!rules) return null;

  // Try to find a clause number at the start of the text (e.g., "4.1 ...")
  const match = text.match(/^\s*(\d+(?:\.\d+)*)\s/);
  if (match) {
    const clause = match[1];
    if (rules[clause]) return clause;
  }

  // Try any clause number mentioned in the first 200 chars
  const head = text.substring(0, 200);
  for (const clause of Object.keys(rules)) {
    if (head.includes(clause + " ") || head.includes(clause + "\t")) {
      return clause;
    }
  }
  return null;
}

function getRuleIdsForChunk(
  documentCode: string,
  clauseNumber: string | null,
  content: string
): string[] {
  const rules = clauseRuleMap[documentCode];
  if (!rules) return [];

  const ids = new Set<string>();

  // Rule IDs from the matched clause
  if (clauseNumber && rules[clauseNumber]) {
    rules[clauseNumber].forEach((id) => ids.add(id));
  }

  // Also check for rule IDs mentioned directly in the content
  for (const clause of Object.keys(rules)) {
    // If the chunk references this clause number, include its rules
    if (content.includes(`${clause} `) || content.includes(`clause ${clause}`)) {
      rules[clause].forEach((id) => ids.add(id));
    }
  }

  // Check for explicit rule ID mentions (e.g., "PA-DEP-PLASTIC")
  const ruleIdPattern = /\b(PA-[A-Z]+(?:-[A-Z]+)*|PB-[A-Z]+(?:-[A-Z]+)*|SOP-[A-Z]+(?:-[A-Z]+)*)\b/g;
  const mentioned = content.match(ruleIdPattern);
  if (mentioned) {
    mentioned.forEach((id) => ids.add(id.toUpperCase()));
  }

  return [...ids];
}

/**
 * Merge short fragments that fall below the minimum target size into the
 * preceding chunk, so we don't create tiny shards.
 */
function mergeShortChunks(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  const merged: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    if (last && last.content.length < TARGET_MIN_CHARS) {
      // Merge into previous
      merged[merged.length - 1] = {
        ...last,
        content: last.content + "\n" + chunk.content,
        ruleIds: [...new Set([...last.ruleIds, ...chunk.ruleIds])],
      };
    } else {
      merged.push(chunk);
    }
  }
  // Final pass: if the last chunk is tiny, merge it back too
  if (merged.length > 1 && merged[merged.length - 1].content.length < TARGET_MIN_CHARS) {
    const last = merged.pop()!;
    const prev = merged[merged.length - 1];
    merged[merged.length - 1] = {
      ...prev,
      content: prev.content + "\n" + last.content,
      ruleIds: [...new Set([...prev.ruleIds, ...last.ruleIds])],
    };
  }
  return merged;
}

/**
 * Split a chunk that exceeds the max target size into smaller pieces at
 * paragraph boundaries.
 */
function splitOversized(chunk: KnowledgeChunk): KnowledgeChunk[] {
  if (chunk.content.length <= TARGET_MAX_CHARS) return [chunk];

  const paragraphs = chunk.content.split(/\n\n+/);
  const result: KnowledgeChunk[] = [];
  let current = "";
  let partIdx = 0;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > TARGET_MAX_CHARS && current.length >= TARGET_MIN_CHARS) {
      const clause = extractClauseNumber(current, chunk.documentCode);
      result.push({
        ...chunk,
        id: `${chunk.id}-s${partIdx}`,
        content: current.trim(),
        clauseNumber: clause || undefined,
        ruleIds: getRuleIdsForChunk(chunk.documentCode, clause, current),
      });
      partIdx++;
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim()) {
    const clause = extractClauseNumber(current, chunk.documentCode);
    result.push({
      ...chunk,
      id: `${chunk.id}-s${partIdx}`,
      content: current.trim(),
      clauseNumber: clause || undefined,
      ruleIds: getRuleIdsForChunk(chunk.documentCode, clause, current),
    });
  }

  return result;
}

/**
 * Re-chunk the knowledge corpus into clause-aware, ~400-800 token chunks
 * with clause-specific rule IDs.
 */
export function chunkKnowledge(): KnowledgeChunk[] {
  const result: KnowledgeChunk[] = [];

  for (const source of knowledgeChunks) {
    // Split the page-level chunk by clause/section boundaries
    const sections = source.content
      .split(CLAUSE_SPLIT_RE)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let sectionIdx = 0;
    for (const section of sections) {
      const clause = extractClauseNumber(section, source.documentCode);
      const chunk: KnowledgeChunk = {
        id: `${source.id}-c${sectionIdx}`,
        documentCode: source.documentCode,
        documentVersion: "1.0",
        documentType: source.documentType,
        policyCode: source.policyCode,
        sectionTitle: source.sectionTitle,
        clauseNumber: clause || undefined,
        pageNumber: source.pageNumber,
        ruleIds: getRuleIdsForChunk(source.documentCode, clause, section),
        content: section,
      };

      // Split oversized chunks
      const parts = splitOversized(chunk);
      result.push(...parts);
      sectionIdx++;
    }
  }

  return mergeShortChunks(result);
}
