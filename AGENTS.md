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
Set these secrets (via the Base44 secrets dashboard — values are in Config.docx):
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`
- `AZURE_OPENAI_API_KEY`
- `AZURE_SEARCH_QUERY_KEY`

Also set the corresponding `_ENDPOINT` env vars. When present and `DEMO_MODE=false`,
the app calls live Azure services instead of using cached responses.

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
