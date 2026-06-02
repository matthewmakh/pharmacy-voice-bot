# Reclaim — Collections Platform: Handoff Document

**Branch:** `claude/relaxed-ptolemy-otAGB`
**Repo:** `matthewmakh/pharmacy-voice-bot`
**DB:** Railway PostgreSQL (connection string from the Railway dashboard)

> This is the start-here context document for a new session. For the *why* behind how
> the code is built, see [`docs/ENGINEERING.md`](./docs/ENGINEERING.md); for the recent
> overhaul, [`docs/CHANGELOG.md`](./docs/CHANGELOG.md). Check `git log` for the latest.

---

## What this app is

A B2B debt-collections platform for New York businesses. It walks a creditor through the
pre-trial workflow: **case intake → AI document analysis → strategy → demand letter →
pre-filing notice → NY court form → default judgment → settlement / payment plan**, with
debtor public-records research feeding the strategy. AI-generated documents are
**fact-checked in code** against the case data (party names, amounts, dates) before being
shown, and **organizations** let a team share the same cases.

It is self-help document preparation + research, **not legal advice** (a disclaimer gate
and footer make this explicit — relevant to unauthorized-practice-of-law risk).

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + React Query |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma (PostgreSQL) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) — tool-based structured output + prompt caching |
| PDF | Puppeteer (HTML→PDF, shared browser), pdf-lib (official CIV-SC-70) |
| Storage | pluggable: local disk (dev) or S3 / Cloudflare R2 (prod) |
| Tests/CI | vitest + GitHub Actions |
| Hosting | Railway |

---

## Backend layout (`server/src/`)

```
index.ts                 # Express app: helmet/CSP, rate limits, routers, static client,
                         #   startup cleanup (stuck jobs) + org backfill
middleware/
  auth.ts                # JWT: session token (header) vs short-lived 'dl' download token (URL-safe)
  orgs.ts                # loadOrgs → req.orgIds (membership scope)
  upload.ts              # multer (temp disk staging)
lib/
  prisma.ts
  anthropic.ts           # shared Claude client + generateJSON (tool output) / generateHTML
                         #   (both prompt-cache the system block and throw on truncation)
  legal.ts               # NY constants + outstandingBalance / trackForAmount / formatMoney
  county.ts              # ZIP→county venue resolver (no silent Queens default)
  storage.ts             # Storage interface: LocalStorage | S3Storage (STORAGE_DRIVER)
  org.ts                 # ensurePersonalOrg / userOrgIds / primaryOrgId / caseInScope
routes/
  auth.ts                # register (creates personal org) / login / me / download-token
  orgs.ts                # list orgs, members, invite, remove, rename
  cases.ts               # all case routes (intake, analyze, generate, lookups, PDFs, actions)
  documents.ts           # upload + extraction + view/download + reanalyze (org-scoped)
services/
  claude.ts              # generate*/synthesize/analyze/extractIntake/assessStrategy/verifyCaseSynthesis
  verify.ts              # verifyDocumentFacts (deterministic) + reviseDocument (one shared LLM fixer)
  pdf.ts                 # fillCIVSC70 (pdf-lib) + htmlToPDF (shared Puppeteer + timeouts)
  fileProcessor.ts       # extractText: text/.docx(mammoth)/PDF(pdf-parse→Claude fallback)/image(vision)
  acris/nycourts/nysEntity/nysUCC/nycECB/pacer/twoCaptcha.ts   # debtor-research integrations
```

Frontend lives in `client/src/` (pages, `case-detail/` tabs, `components/ui` primitives).
Notable additions: `components/ErrorBoundary.tsx`, `components/DisclaimerGate.tsx`,
`pages/Team.tsx`, `case-detail/shared/PdfDownloadButton.tsx`.

---

## Data model (`server/prisma/schema.prisma`)

- **User** — `email`, `passwordHash`, `name`, `memberships`.
- **Organization** — `name`, `memberships`, `cases`. Every user gets a personal org.
- **Membership** — `userId`, `organizationId`, `role` (`OWNER`/`ADMIN`/`MEMBER`), unique per pair.
- **Case** — facts (parties, claim amounts/dates, `status`, `strategy`), `userId` (creator),
  **`organizationId`** (owning org → visibility), AI analysis JSON, generated-document
  HTML/text columns, six `*Verification` JSON blobs, six research-result JSON blobs +
  `lookupMeta` (per-lookup `{status, fetchedAt, error?}`).
- **Document** — uploaded evidence. `path` holds an **opaque storage key** (not a filesystem
  path). `analysisError` drives the failed/retry UI state.
- **CaseAction** — timeline entries (`type`, `status`, `metadata`).

> `Case` is still a large "god object" (documents + research inline). A safe, staged plan
> to normalize it is in [`docs/migrations/CASE_MODEL_NORMALIZATION.md`](./docs/migrations/CASE_MODEL_NORMALIZATION.md)
> — deliberately deferred (it's a destructive migration).

### Multi-tenancy & access scoping
Case and document routes scope by **organization membership**, not a single user:
`requireAuth` → `loadOrgs` sets `req.orgIds`, and queries filter on
`organizationId: { in: req.orgIds }`. Reads use `findFirst`; writes use an explicit
`caseInScope(...)` guard (or `deleteMany`) — we never rely on list-filters in
`update`/`delete` where-clauses. New cases are created in the user's `primaryOrgId`.
An idempotent **startup backfill** in `index.ts` provisions orgs for pre-existing users
and assigns legacy cases to their creator's org (additive — no data loss).

---

## Status flow & background jobs

```
DRAFT → ASSEMBLING → ANALYZING → STRATEGY_PENDING → STRATEGY_SELECTED → GENERATING
      → READY → SENT → AWAITING_RESPONSE → ESCALATING → RESOLVED / CLOSED
```

These routes are **fire-and-forget**: set status, return immediately, finish in the
background. The case page polls (`refetchInterval: 3000`) while busy or a lookup is running.

| Route | Background fn | Status during | On error |
|---|---|---|---|
| `POST /:id/analyze` | `analyzeCaseInBackground` | `ANALYZING` | → `ASSEMBLING` |
| `POST /:id/generate` | `generateLetterInBackground` | `GENERATING` | → `STRATEGY_SELECTED` |
| `POST /:id/final-notice` | `generateFinalNoticeInBackground` | `GENERATING` | → prior status |
| `POST /:id/court-form` | `generateCourtFormInBackground` | `GENERATING` | → prior status |
| `POST /:id/default-judgment` | `generateDefaultJudgmentInBackground` | `GENERATING` | → prior status |
| `POST /:id/generate-settlement` | `generateSettlementInBackground` | `GENERATING` | → prior status |
| `POST /:id/generate-payment-plan` | `generatePaymentPlanInBackground` | `GENERATING` | → prior status |
| `POST /:caseId/documents` | `analyzeDocumentInBackground` (per doc) | — | sets `analysisError` |
| `POST /:id/lookups/:key` | `runLookupInBackground` | `lookupMeta[key]=running` | `lookupMeta[key]=error` |

A per-case in-memory **job lock** (+ a busy-status check) makes generation idempotent
under double-clicks (second request → `409`). Startup cleanup resets cases stuck in
`ANALYZING`/`GENERATING` after a crash/restart.

---

## AI layer (`services/claude.ts` + `services/verify.ts`)

All JSON responses come back through a **forced tool call** (`generateJSON`, guaranteed
parseable); raw-HTML documents use `generateHTML`. Both cache the static system block and
**throw on `max_tokens`** (no silently-truncated legal documents). Dates render in
**America/New_York**.

- `analyzeDocument(text, filename, mime)` → classification/tags/facts (per uploaded doc).
- `extractIntakeFromDocuments(docs)` → `{ fields, documentSummary, clarifyingQuestions }`
  — the evidence-drop intake. Returns a plain-language summary and 2–5 guided questions.
- `synthesizeCase(docs, userFacts)` → `CaseSynthesis` (strength, theory, timeline, missing
  info, recommended strategy).
- `verifyCaseSynthesis(...)` → flag-only grounding check (the one remaining LLM "reviewer";
  case analysis is subjective).
- `generateDemandLetter` / `generateFinalNotice` / `generateCourtForm` (commercial/civil/
  supreme; injects the resolved county/courthouse) / `generateDefaultJudgment` /
  `generateStipulationOfSettlement` / `generatePaymentPlanAgreement` / `generateAffidavitOfService`.
- `assessStrategyWithResearch(caseData, lookupResults)` → strategy recommendation.

### Verification = deterministic, not LLM-on-LLM
`verifyDocumentFacts(kind, html, caseData)` (in `verify.ts`) checks **in code** that the
right party names, the correct amount (outstanding balance, or full debt for a settlement),
and the invoice number actually appear in the generated HTML, and counts `[UNKNOWN]`
placeholders. Returns the same `CourtFormVerification` shape the UI renders
(`verified`/`review_needed`/`issues_found`). If `issues_found`, the route calls
`reviseDocument(...)` — **one** shared LLM correction pass — then re-checks. This replaced
six `verify*` + five `retry*` LLM functions that were unreliable and contradicted
themselves (they flagged the injected courthouse address as "hallucinated").

---

## Debtor research lookups

Triggered by `POST /api/cases/:id/lookups/:key` (key ∈ `acris | courts | entity | ucc |
ecb | pacer`), run in the background, persist the result to the matching `Case` field, and
record status in `lookupMeta`. The Strategy tab's `LookupCard` reads result + status from
the case (so they survive refresh) and polls while running. `assess-strategy` reasons over
the persisted results. Backends: `acris.ts`, `nycourts.ts`, `nysEntity.ts`, `nysUCC.ts`
(2captcha), `nycECB.ts`, `pacer.ts`.

---

## Route reference

```
POST   /api/auth/register            # also creates the user's personal org
POST   /api/auth/login
GET    /api/auth/me
GET    /api/auth/download-token       # short-lived (10m) token for file/PDF URLs

GET    /api/orgs                      # my orgs (role + member count)
GET    /api/orgs/:id/members
POST   /api/orgs/:id/invite           # add an existing user by email (OWNER/ADMIN)
DELETE /api/orgs/:id/members/:userId
PATCH  /api/orgs/:id                  # rename (OWNER)

GET    /api/cases                     # list (org-scoped, ?limit/&offset)
POST   /api/cases                     # create
POST   /api/cases/draft               # empty DRAFT (attach docs before submit)
POST   /api/cases/:id/submit-draft
POST   /api/cases/:id/autofill        # extract intake fields + questions from docs
GET    /api/cases/:id                 # get one
PATCH  /api/cases/:id                 # update
DELETE /api/cases/:id

POST   /api/cases/:id/analyze | reset-analysis | strategy
POST   /api/cases/:id/generate | final-notice | court-form | default-judgment
POST   /api/cases/:id/generate-affidavit-of-service | generate-settlement | generate-payment-plan
POST   /api/cases/:id/assess-strategy
POST   /api/cases/:id/lookups/:key
POST   /api/cases/:id/actions

GET    /api/cases/:id/{demand-letter|final-notice|court-form|default-judgment|affidavit-of-service|settlement|payment-plan}-pdf

POST   /api/cases/:caseId/documents | DELETE /:docId | POST /:docId/reanalyze
GET    /api/cases/:caseId/documents/:docId/{view|download}
```

File/PDF endpoints are fetched as **authenticated blobs** (Authorization header) on the
client — no token in the URL. View serves `inline` only for PDFs/images (else forced
download, with `nosniff`).

---

## Implementation notes

- **Outstanding balance** = `max(0, amountOwed − amountPaid)` — see `legal.ts`
  `outstandingBalance()`. Used in prompts, the deterministic checker, and PDFs.
- **Court track by balance**: ≤ $10k → Commercial Claims (CIV-SC-70); $10k–$50k → Civil
  Court; > $50k → Supreme Court (`legal.ts` `trackForAmount()`).
- **Venue**: `county.ts` resolves county from the debtor's ZIP (Manhattan ZIPs no longer
  fall through to Queens); out-of-NYC addresses are flagged, not silently defaulted.
- **SOL**: `client/.../shared/sol.ts` — `solForCase(caseData)` runs 6 years (CPLR §213) from
  the later of the payment-due date or the most recent acknowledgment/partial payment
  (GOL §17-101/§17-107), consistent with the generated settlement/payment-plan language.
- **Payments**: a partial `PAYMENT_RECEIVED` does **not** resolve the case; only one that
  clears the balance does. `amountPaid` uses an atomic increment.
- **Storage**: `STORAGE_DRIVER=local` is ephemeral; production must set `s3` (see env vars).
  `Document.path` is the storage key.
- **Auth**: session JWT is header-only; a separate 10-minute `dl`-scoped token exists but
  the client uses header-authenticated blob fetches instead.

---

## Environment variables

```
DATABASE_URL          — PostgreSQL connection string
JWT_SECRET            — JWT signing secret (REQUIRED in production — server refuses to boot without it)
ANTHROPIC_API_KEY     — Claude API key
NODE_ENV              — production
STORAGE_DRIVER        — 'local' (ephemeral!) or 's3' — use 's3' in production
S3_BUCKET / S3_REGION / S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY  — when STORAGE_DRIVER=s3 (S3_ENDPOINT for Cloudflare R2)
CAPTCHA_API_KEY       — 2captcha.com key for the NYS UCC lookup  (code reads CAPTCHA_API_KEY, not TWO_CAPTCHA_API_KEY)
PACER_USERNAME/PACER_PASSWORD — federal bankruptcy lookup
NYC_OPEN_DATA_TOKEN   — reduces rate limiting on ACRIS/ECB  (code reads NYC_OPEN_DATA_TOKEN)
UCC_PORTAL_URL / ECB_DATASET_ID — optional overrides if those portals change
```

Optional integrations degrade gracefully when unset. See [`.env.example`](./.env.example).

---

## Known issues / pending

- **S3 not yet enabled** — durable storage is implemented; production must set
  `STORAGE_DRIVER=s3` + bucket vars or uploads are lost on redeploy.
- **`Case` god-object** — normalization is planned but deferred:
  [`docs/migrations/CASE_MODEL_NORMALIZATION.md`](./docs/migrations/CASE_MODEL_NORMALIZATION.md).
- **PACER**: account `tyenyllc` needs PCL search privileges (PACER support (800) 676-6856);
  the scraper does not paginate (first page of results only).
- **UPL posture** is a product/legal decision, only partially mitigated in code (disclaimer
  gate + footer).
- **Org invites** require the invitee to already have a Reclaim account (no email-send infra).

## DB access (direct)
```bash
psql "$DATABASE_URL"   # connection string from Railway → PostgreSQL → Connect
```
