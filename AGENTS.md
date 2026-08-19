# ClaimIQ — Base44 Dev Environment

## What this is
ClaimIQ is an AI-assisted motor insurance claims decision workbench (DTAI capstone project).
The repo originally contained only a PRD, Azure config, demo data, and knowledge PDFs.
The application was built from the PRD into a Next.js 14 app.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Validation**: Zod
- **Business logic**: Deterministic TypeScript rule engine (no DB)
- **AI**: Azure Document Intelligence + Azure OpenAI (optional — app runs in DEMO_MODE without them)
- **RAG**: Azure AI Search (optional — falls back to local keyword search over pre-chunked knowledge)

## Running
```bash
docker compose -f docker-compose.base44.yml up -d --build
```
The app serves on port 3000. First boot runs `npm install` then `next dev` (~30-60s).

## Demo Mode
By default `DEMO_MODE=true` (set in `.env.base44-defaults`). All three demo claims
(Creta → Fast Track, Honda City → Desktop Review, BMW → Specialist Review) work fully
with cached AI responses and deterministic rule engines — no Azure credentials needed.

## Enabling Live Azure AI
Live mode auto-activates whenever `AZURE_OPENAI_API_KEY` is present (delivered via
the Base44 secrets platform to `/run/base44/app.env`). No flag to flip — provide
the key and the workbench switches from cached demo responses to live Azure.

Secrets (values in Config.docx):
- `AZURE_DOCUMENT_INTELLIGENCE_KEY` — Document Intelligence (estimate OCR/extraction)
- `AZURE_OPENAI_API_KEY` — Azure OpenAI (claim structuring + semantic review)
- `AZURE_SEARCH_QUERY_KEY` — Azure AI Search (live RAG retrieval; optional)

Non-secret endpoints are pre-filled in `.env.base44-defaults` (from Config.docx):
`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_OPENAI_ENDPOINT`, `AZURE_SEARCH_ENDPOINT`,
plus the chat/embedding deployment names and search index.

### Live pipeline
- `POST /api/claim/analyze` — when live: reads the claim's source estimate image
  (`demo-data/<slug>/estimate.png`), runs **Document Intelligence** (`prebuilt-layout`)
  to extract text+tables, then **Azure OpenAI** (`claimiq-chat`) to produce the
  `StructuredClaim` (line items, estimate totals, missing info) and `SemanticReview`.
  The trusted claim context (policy/vehicle/garage) is reused; only the AI-derived
  fields are replaced. The deterministic rule engines then run unchanged. On any
  Azure failure it falls back to the cached demo claim so the UI always renders.
- `POST /api/rag/query` — when live: queries **Azure AI Search** (`claimiq-knowledge`
  index, full-text). On any error/empty result it falls back to the local keyword
  index, so RAG always answers.

### Reachability guard
`isOpenAiReachable()` (in `src/lib/azure/openai.ts`) probes the OpenAI endpoint
before the slow Document Intelligence step. A dead/unprovisioned OpenAI host
returns an HTML 404; the probe detects this and skips straight to the demo
fallback (cached for 60s), so a broken OpenAI endpoint never makes claim loads slow.

## Architecture
- `src/lib/rules/` — deterministic rule engines (settlement, review risk, routing, authority)
- `src/lib/demo/` — three demo claims with line items and cached AI responses
- `src/lib/rag/` — knowledge corpus (chunked from 4 policy/SOP PDFs) + local search
- `src/lib/benchmarks/` — synthetic repair benchmarks
- `src/app/api/` — API routes for each pipeline stage
- `src/app/` — three screens: Intake, Workspace, Dossier

## Key Design Principles (from PRD)
- Rules before AI; AI interprets, code calculates
- Review signals are NOT deductions (don't auto-reduce settlement)
- Specialist review ≠ SIU referral
- RAG explains; it does not decide
- Humans remain accountable
