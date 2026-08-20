import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadLocalEnv() {
  try {
    const text = await readFile(path.resolve(".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // Environment injection is preferred; .env.local is optional.
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value.replace(/\/+$/, "");
}

function requiredAny(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value.replace(/\/+$/, "");
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function openAiBase(endpoint) {
  if (/\/openai\/v1$/i.test(endpoint)) return endpoint;
  if (/\/openai$/i.test(endpoint)) return `${endpoint}/v1`;
  return `${endpoint}/openai/v1`;
}

async function loadChunks() {
  const source = await readFile(path.resolve("src/lib/rag/knowledgeData.ts"), "utf8");
  const marker = "export const knowledgeChunks: KnowledgeChunk[] = ";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Could not locate the pre-chunked knowledge corpus");
  const arrayStart = source.indexOf("[", start + marker.length);
  const arrayEnd = source.lastIndexOf("];");
  if (arrayStart < 0 || arrayEnd < arrayStart) throw new Error("Knowledge corpus is malformed");
  return JSON.parse(source.slice(arrayStart, arrayEnd + 1));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

await loadLocalEnv();
const openAiEndpoint = requiredAny("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_BASE_URL");
const openAiKey = required("AZURE_OPENAI_API_KEY");
const embeddingDeployment = required("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
const searchEndpoint = required("AZURE_SEARCH_ENDPOINT");
const searchAdminKey = required("AZURE_SEARCH_ADMIN_KEY");
const indexName = process.env.AZURE_SEARCH_INDEX?.trim() || "claimiq-knowledge";
const apiVersion = "2026-04-01";
const chunks = await loadChunks();

async function embed(inputs) {
  const payload = await fetchJson(`${openAiBase(openAiEndpoint)}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": openAiKey },
    body: JSON.stringify({ model: embeddingDeployment, input: inputs }),
  });
  return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

let firstVector;
try {
  firstVector = (await embed([chunks[0].content]))[0];
} catch (error) {
  console.warn(
    "Azure OpenAI embeddings are unavailable; seeding an Azure keyword index instead. " +
    "ClaimIQ will report AZURE_KEYWORD retrieval mode until a compatible vector index is seeded."
  );
  console.warn(error instanceof Error ? error.message : String(error));
}

const baseFields = [
  { name: "id", type: "Edm.String", key: true, filterable: true },
  { name: "documentCode", type: "Edm.String", filterable: true, facetable: true },
  { name: "documentType", type: "Edm.String", filterable: true, facetable: true },
  { name: "policyCode", type: "Edm.String", filterable: true },
  { name: "sectionTitle", type: "Edm.String", searchable: true },
  { name: "pageNumber", type: "Edm.Int32", filterable: true },
  { name: "ruleIds", type: "Collection(Edm.String)", filterable: true },
  { name: "content", type: "Edm.String", searchable: true },
];

const vectorField = firstVector
  ? {
      name: "contentVector",
      type: "Collection(Edm.Single)",
      searchable: true,
      dimensions: firstVector.length,
      vectorSearchProfile: "claimiq-vector-profile",
    }
  : null;
const indexUrl = `${searchEndpoint}/indexes/${encodeURIComponent(indexName)}?api-version=${apiVersion}`;
const existing = await fetch(indexUrl, { headers: { "api-key": searchAdminKey } });
if (existing.status === 404) {
  const indexDefinition = {
    name: indexName,
    fields: vectorField ? [...baseFields, vectorField] : baseFields,
  };
  if (vectorField) {
    indexDefinition.vectorSearch = {
      algorithms: [{ name: "claimiq-hnsw", kind: "hnsw" }],
      profiles: [{ name: "claimiq-vector-profile", algorithm: "claimiq-hnsw" }],
    };
  }
  await fetchJson(indexUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "api-key": searchAdminKey },
    body: JSON.stringify(indexDefinition),
  });
  console.log(
    `Created Azure AI Search index "${indexName}" in ${vectorField ? "hybrid vector/keyword" : "keyword"} mode.`
  );
} else if (!existing.ok) {
  throw new Error(`Could not inspect Azure AI Search index (${existing.status})`);
} else {
  const schema = await existing.json();
  const requiredFields = new Set(baseFields.map((field) => field.name));
  if (firstVector) requiredFields.add("contentVector");
  for (const field of schema.fields ?? []) requiredFields.delete(field.name);
  if (requiredFields.size > 0) {
    throw new Error(`Existing index is missing fields: ${[...requiredFields].join(", ")}. Create a compatible index explicitly before seeding.`);
  }
  console.log(`Using existing Azure AI Search index "${indexName}".`);
}

const documents = [];
for (let offset = 0; offset < chunks.length; offset += 16) {
  const batch = chunks.slice(offset, offset + 16);
  const vectors = firstVector
    ? offset === 0
      ? [firstVector, ...(await embed(batch.slice(1).map((chunk) => chunk.content)))]
      : await embed(batch.map((chunk) => chunk.content))
    : null;
  batch.forEach((chunk, index) => {
    documents.push({
      "@search.action": "mergeOrUpload",
      ...chunk,
      ...(vectors ? { contentVector: vectors[index] } : {}),
    });
  });
  console.log(
    `${vectors ? "Embedded" : "Prepared"} ${Math.min(offset + batch.length, chunks.length)}/${chunks.length} chunks.`
  );
}

for (let offset = 0; offset < documents.length; offset += 50) {
  const value = documents.slice(offset, offset + 50);
  await fetchJson(
    `${searchEndpoint}/indexes/${encodeURIComponent(indexName)}/docs/index?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": searchAdminKey },
      body: JSON.stringify({ value }),
    }
  );
}

console.log(
  `Seeded ${documents.length} policy/SOP chunks into "${indexName}" (${firstVector ? "AZURE_HYBRID" : "AZURE_KEYWORD"}).`
);
