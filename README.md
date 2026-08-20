# ClaimIQ

ClaimIQ is an AI-assisted motor own-damage claims workbench. Azure AI interprets documents and retrieves evidence; deterministic TypeScript rules calculate settlement, review risk, routing, SIU eligibility and approval authority. A human claims professional remains accountable for the final decision.

## What works

- Three source-aligned synthetic demos: Creta (Fast Track), Honda City (Desktop Review) and BMW (Specialist Review).
- Policy selector showing the material difference between standard depreciation and eligible Elite/Zero-Dep coverage.
- Deterministic settlement bridge, CTL status, estimate checks, transparent risk drivers, routing, SIU separation and authority bands.
- Bi-directional repair-row/document highlighting from preserved source blocks.
- Human decision controls with mandatory override reasons and audit events.
- Optional live PDF/PNG/JPG/JPEG intake using Azure Document Intelligence and Azure OpenAI.
- Policy/SOP RAG with exact rule lookup, Azure hybrid keyword/vector retrieval, grounded answer generation and a local pre-indexed fallback.
- Cached demo fallbacks when Azure is unavailable.

## Run with Docker / Base44

    docker compose -f docker-compose.base44.yml up -d --build

Open http://localhost:3000. The container serves Next.js internally on port 5173.

Base44 should inject secrets into /run/base44/app.env. .env.base44-defaults contains non-secret defaults only.

## Run locally

    pnpm install
    pnpm dev

Open http://localhost:5173.

Copy .env.example to .env.local only when testing live Azure services. .env.local is ignored by source control.

## Azure configuration

Required for live document analysis:

- AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
- AZURE_DOCUMENT_INTELLIGENCE_KEY
- AZURE_OPENAI_ENDPOINT (the original AZURE_OPENAI_BASE_URL name is also accepted)
- AZURE_OPENAI_API_KEY
- AZURE_OPENAI_CHAT_DEPLOYMENT

Required for live hybrid RAG:

- AZURE_OPENAI_EMBEDDING_DEPLOYMENT
- AZURE_SEARCH_ENDPOINT
- AZURE_SEARCH_QUERY_KEY
- AZURE_SEARCH_INDEX

The implementation uses Document Intelligence 2024-11-30, the Azure OpenAI v1 Responses/Embeddings APIs with strict JSON Schema plus Zod validation, and Azure AI Search 2026-04-01.

## Seed the Azure RAG index

Set AZURE_SEARCH_ADMIN_KEY in the local/injected environment, then run:

    pnpm rag:seed

The script creates claimiq-knowledge only when it does not already exist, generates embeddings in batches, and uploads the pre-chunked corpus. If the embedding service is unavailable, it safely creates and seeds an Azure keyword index so retrieval remains operational. It refuses to replace an incompatible existing index.

To upgrade a keyword-only index to hybrid vector retrieval after fixing the embedding service, delete the script-created `claimiq-knowledge` index in Azure AI Search and run `pnpm rag:seed` again. The seeder will recreate it with a vector field sized from the live embedding response.

Do not expose the admin key to browser code. The application runtime uses the query key.

## Verification

With the application already running:

    pnpm test:smoke

The smoke test verifies:

- the three required routing outcomes and source estimate totals;
- BMW technical findings without automatic SIU referral;
- policy-driven settlement differences;
- RAG rule/clause evidence;
- human override validation.

Production compilation:

    pnpm build

## Security and data

- Use synthetic claim documents only.
- Uploaded files are processed in memory and are not persisted.
- No API key is sent to the browser.
- Never commit .env.local or runtime secret files.
- If a key has ever been committed or shared in a build artifact, rotate it in Azure before deployment.
