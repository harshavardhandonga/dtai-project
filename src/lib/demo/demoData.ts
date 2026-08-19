import fs from "fs";
import path from "path";

// Maps demo claim IDs to their demo-data folder (source estimate image +
// context). Used by live Azure AI mode to read the real estimate document.
const SLUGS: Record<string, string> = {
  "CLM-CRETA-001": "creta",
  "CLM-HCITY-002": "honda-city",
  "CLM-BMW-003": "bmw",
};

export function getDemoSlug(claimId: string): string | undefined {
  return SLUGS[claimId];
}

/** Read the source estimate image for a demo claim, or null if unavailable. */
export function readDemoEstimate(claimId: string): Buffer | null {
  const slug = SLUGS[claimId];
  if (!slug) return null;
  const filePath = path.join(process.cwd(), "demo-data", slug, "estimate.png");
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}
