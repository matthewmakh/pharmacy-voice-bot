# Reclaim — Collections Platform

Full-stack B2B debt-collections workflow for New York businesses. Walks a user end-to-end through pre-trial collections: case intake → AI document analysis → strategy selection → demand letter → pre-filing notice → NY court form generation → default judgment → settlement / payment plan. Every AI-generated document is verified by an adversarial Claude agent and auto-corrected if issues are found.

## Stack
- **Frontend**: React + TypeScript + Vite + Tailwind + React Query
- **Backend**: Node.js + Express + TypeScript, Prisma + PostgreSQL
- **AI**: Anthropic Claude (`claude-sonnet-4-6`)
- **PDF**: Puppeteer (HTML→PDF) + pdf-lib (court forms)
- **Hosting**: Railway

## Local development
```bash
# from repo root
npm install           # installs root + runs postinstall build
npm run dev           # runs server + client concurrently
```

Client: http://localhost:5173 · Server: http://localhost:3001 · Health: http://localhost:3001/api/health

## Deploy
Railway picks up `railway.toml` — builds client + server, runs `prisma db push`, starts the Node server. Required env vars are listed in `HANDOFF.md`.

## Further reading
See **[HANDOFF.md](./HANDOFF.md)** for the full context document: directory structure, AI function reference, Case model schema, verification pipeline, route map, and known issues.
