import { azureConfig, isDocumentIntelligenceConfigured } from "./config";
import type { DocumentExtraction, SourceBlock } from "@/lib/types";

const API_VERSION = "2024-11-30";

type Point = { x?: number; y?: number };

function normalizedPolygon(
  raw: unknown,
  width: number,
  height: number
): number[] | undefined {
  if (!Array.isArray(raw) || width <= 0 || height <= 0) return undefined;

  const values: number[] = [];
  if (raw.every((value) => typeof value === "number")) {
    for (let index = 0; index < raw.length; index += 2) {
      values.push(Number(raw[index]) / width, Number(raw[index + 1]) / height);
    }
  } else {
    for (const point of raw as Point[]) {
      if (typeof point?.x !== "number" || typeof point?.y !== "number") continue;
      values.push(point.x / width, point.y / height);
    }
  }

  return values.length >= 8
    ? values.map((value) => Math.max(0, Math.min(1, value)))
    : undefined;
}

function pageDimensions(pages: any[]): Map<number, { width: number; height: number }> {
  return new Map(
    pages.map((page: any, index: number) => [
      Number(page.pageNumber ?? index + 1),
      { width: Number(page.width ?? 1), height: Number(page.height ?? 1) },
    ])
  );
}

function regionBlock(
  block: any,
  blockId: string,
  type: SourceBlock["type"],
  dimensions: Map<number, { width: number; height: number }>,
  extras: Pick<SourceBlock, "rowIndex" | "columnIndex"> = {}
): SourceBlock | null {
  const region = block.boundingRegions?.[0];
  const pageNumber = Number(region?.pageNumber ?? block.pageNumber ?? 1);
  const page = dimensions.get(pageNumber) ?? { width: 1, height: 1 };
  const text = String(block.content ?? block.text ?? "").trim();
  if (!text) return null;
  return {
    blockId,
    pageNumber,
    text,
    type,
    polygon: normalizedPolygon(region?.polygon ?? block.polygon, page.width, page.height),
    ...extras,
  };
}

function toDocumentExtraction(data: any): DocumentExtraction {
  const result = data?.analyzeResult ?? {};
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const dimensions = pageDimensions(pages);
  const sourceBlocks: SourceBlock[] = [];

  for (const [index, paragraph] of (result.paragraphs ?? []).entries()) {
    const pageNumber = Number(paragraph.boundingRegions?.[0]?.pageNumber ?? 1);
    const block = regionBlock(
      paragraph,
      `P${pageNumber}-P${index + 1}`,
      "paragraph",
      dimensions
    );
    if (block) sourceBlocks.push(block);
  }

  for (const page of pages) {
    const pageNumber = Number(page.pageNumber ?? 1);
    for (const [index, line] of (page.lines ?? []).entries()) {
      const block = regionBlock(
        { ...line, pageNumber },
        `P${pageNumber}-L${index + 1}`,
        "line",
        dimensions
      );
      if (block) sourceBlocks.push(block);
    }
  }

  for (const [tableIndex, table] of (result.tables ?? []).entries()) {
    for (const cell of table.cells ?? []) {
      const pageNumber = Number(cell.boundingRegions?.[0]?.pageNumber ?? 1);
      const rowIndex = Number(cell.rowIndex ?? 0);
      const columnIndex = Number(cell.columnIndex ?? 0);
      const block = regionBlock(
        cell,
        `P${pageNumber}-T${tableIndex + 1}-R${rowIndex + 1}-C${columnIndex + 1}`,
        "table_cell",
        dimensions,
        { rowIndex, columnIndex }
      );
      if (block) sourceBlocks.push(block);
    }
  }

  const content = sourceBlocks
    .map((block) => `[${block.blockId}] ${block.text}`)
    .join("\n");

  return {
    content: content || String(result.content ?? "").trim(),
    sourceBlocks,
    pageCount: pages.length || 1,
  };
}

export async function extractDocument(
  documentBuffer: Buffer,
  contentType = "application/octet-stream"
): Promise<DocumentExtraction> {
  if (!isDocumentIntelligenceConfigured()) {
    throw new Error("Document Intelligence is not configured");
  }

  const url = `${azureConfig.diEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${API_VERSION}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureConfig.diKey!,
      "Content-Type": contentType,
    },
    body: documentBuffer,
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Document Intelligence analyze failed (${response.status}): ${detail}`);
  }

  const operationLocation = response.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Document Intelligence returned no operation-location header");
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const poll = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": azureConfig.diKey! },
    });
    if (!poll.ok) continue;

    const data = await poll.json();
    if (data.status === "succeeded") return toDocumentExtraction(data);
    if (data.status === "failed") {
      throw new Error("Document Intelligence analysis failed");
    }
  }

  throw new Error("Document Intelligence analysis timed out");
}
