# Reclaim — Collections Platform

Full-stack B2B debt-collections platform for New York businesses. Walks a creditor
end-to-end through pre-trial collections: case intake → AI document analysis → strategy
selection → demand letter → pre-filing notice → NY court form → default judgment →
settlement / payment plan. AI-generated documents are fact-checked against the case data
before they're shown, and members of an organization share the same cases.

> Self-help document preparation and public-records research — **not legal advice**.

## Stack
- **Frontend**: React + TypeScript + Vite + Tailwind + React Query
- **Backend**: Node.js + Express + TypeScript, Prisma + PostgreSQL
- **AI**: Anthropic Claude (`claude-sonnet-4-6`) — tool-based structured output + prompt caching
- **PDF**: Puppeteer (HTML→PDF) + pdf-lib (the official CIV-SC-70 form)
- **Storage**: pluggable — local disk (dev) or S3 / Cloudflare R2 (prod)
- **Hosting**: Railway

## Local development
```bash
# server
cd server && npm install && npx prisma generate && npm run dev   # http://localhost:3001
# client (separate terminal)
cd client && npm install && npm run dev                          # http://localhost:5173
# or, from the repo root:
npm install && npm run dev                                       # runs both concurrently
```
Copy `.env.example` → `server/.env` and fill it in. Health check: `/api/health`.

## Tests & CI
```bash
cd server && npm test     # vitest — legal math, venue resolver, document fact-checks
cd client && npm test     # vitest — statute-of-limitations math
```
GitHub Actions (`.github/workflows/ci.yml`) typechecks, builds, and tests both packages
on every push / PR.

## Deploy
Railway picks up `railway.toml` — builds client + server, runs `prisma db push`, and
starts the Node server. **For production set `STORAGE_DRIVER=s3`** (with a bucket) so
uploaded evidence survives redeploys; the default local-disk storage is ephemeral. All
env vars are documented in [`.env.example`](./.env.example).

## Documentation
- **[docs/SESSION_HANDOFF.md](./docs/SESSION_HANDOFF.md)** — start here when continuing in a new
  chat: current status and what is *confirmed* vs. *not yet verified*.
- **[HANDOFF.md](./HANDOFF.md)** — context document for a new session: architecture, data
  model, AI layer, route map, conventions index.
- **[docs/ENGINEERING.md](./docs/ENGINEERING.md)** — how this codebase is built and what's
  expected of changes (conventions, patterns, how to extend).
- **[docs/CHANGELOG.md](./docs/CHANGELOG.md)** — the audit-driven overhaul: what changed and why.
- **[docs/migrations/CASE_MODEL_NORMALIZATION.md](./docs/migrations/CASE_MODEL_NORMALIZATION.md)**
  — planned (deferred) schema normalization.
