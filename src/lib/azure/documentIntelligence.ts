import { azureConfig } from "./config";

// Azure Document Intelligence — prebuilt-layout model (text + tables).
// API version 2023-07-31 (GA, broadly compatible with the /formrecognizer path).
const API_VERSION = "2023-07-31";

/**
 * Send an estimate image to Document Intelligence and return the extracted
 * text (full read content plus tables rendered as pipe-delimited rows) that
 * the OpenAI structuring step consumes.
 */
export async function extractDocument(imageBuffer: Buffer): Promise<string> {
  const url = `${azureConfig.diEndpoint}/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureConfig.diKey!,
      "Content-Type": "application/octet-stream",
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Document Intelligence analyze failed (${res.status}): ${txt}`);
  }

  const operationLocation = res.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Document Intelligence returned no operation-location header");
  }

  // Poll the long-running operation until it completes.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": azureConfig.diKey! },
    });
    if (!poll.ok) continue;
    const data: any = await poll.json();

    if (data.status === "succeeded") {
      const ar = data.analyzeResult || {};
      const lines: string[] = [];
      if (ar.content) lines.push(ar.content);
      if (Array.isArray(ar.tables)) {
        for (const table of ar.tables) {
          lines.push("\n[TABLE]");
          for (const row of table.rows || []) {
            const cells = (row.cells || []).map((c: any) => (c.content || "").trim());
            lines.push(cells.join(" | "));
          }
        }
      }
      return lines.join("\n").trim();
    }
    if (data.status === "failed") {
      throw new Error("Document Intelligence analysis failed");
    }
    // still running — keep polling
  }
  throw new Error("Document Intelligence analysis timed out");
}
