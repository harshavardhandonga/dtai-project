import type { DemoClaim, DocumentExtraction, SourceBlock } from "@/lib/types";

const geometry: Record<string, { firstRowTop: number; rowHeight: number }> = {
  "CLM-CRETA-001": { firstRowTop: 0.441, rowHeight: 0.0276 },
  "CLM-HCITY-002": { firstRowTop: 0.456, rowHeight: 0.0234 },
  "CLM-BMW-003": { firstRowTop: 0.348, rowHeight: 0.0242 },
};

export function getDemoDocumentExtraction(claim: DemoClaim): DocumentExtraction {
  const layout = geometry[claim.claimId] ?? { firstRowTop: 0.4, rowHeight: 0.03 };
  const sourceBlocks: SourceBlock[] = [];
  const seen = new Set<string>();

  claim.structuredClaim.lineItems.forEach((item, index) => {
    const top = layout.firstRowTop + index * layout.rowHeight;
    const bottom = top + layout.rowHeight;
    for (const blockId of item.sourceBlockIds) {
      if (seen.has(blockId)) continue;
      seen.add(blockId);
      sourceBlocks.push({
        blockId,
        pageNumber: 1,
        text: item.rawDescription,
        type: "table_cell",
        rowIndex: index + 1,
        polygon: [0.03, top, 0.97, top, 0.97, bottom, 0.03, bottom],
      });
    }
  });

  return {
    content: sourceBlocks.map((block) => `[${block.blockId}] ${block.text}`).join("\n"),
    sourceBlocks,
    pageCount: 1,
  };
}

