# Reclaim — Collections Platform: Handoff Document
**Last updated:** April 24, 2026  
**Branch:** `claude/refresh-frontend-design-wW79w` (merged from `claude/collections-platform-mvp-J862j`)  
**Deployed at:** `https://getmoney.up.railway.app`  
**Repo:** `matthewmakh/pharmacy-voice-bot`  
**DB:** Railway PostgreSQL (get connection string from Railway dashboard)

> **Note:** Changes made in parallel threads not visible to this session may not be reflected here. Check `git log` for the full picture.

---

## What This App Is

A full-stack B2B debt collections platform for New York businesses. It walks a user through the entire pre-trial collections workflow: case intake → AI document analysis → strategy selection → demand letter → pre-filing notice → court form generation → default judgment → settlement/payment plan. Every AI-generated document is automatically verified by an adversarial Claude agent and auto-corrected if issues are found.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + React Query |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma (PostgreSQL) |
| AI | Anthropic Claude API (claude-sonnet-4-6) |
| PDF | Puppeteer (HTML→PDF), pdf-lib (court forms) |
| Hosting | Railway (server + DB + static) |

---

## Directory Structure

```
pharmacy-voice-bot/
├── client/                                # React frontend
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx              # Cases list + stats
│       │   ├── NewCase.tsx                # 4-step intake form
│       │   ├── Login.tsx / Register.tsx
│       │   └── case-detail/               # Split case UI (was CaseDetail.tsx, 3,181 lines)
│       │       ├── index.tsx              # Shell: header, StatusPill, TabBar, routes tabs
│       │       ├── OverviewTab.tsx        # Key #s, parties, dates, SOL, evidence, missing info
│       │       ├── EvidenceTab.tsx        # Upload + list + preview modal + retry for analysisError docs
│       │       ├── StrategyTab.tsx        # AI assessment + strategy selector
│       │       ├── LetterTab.tsx          # Demand letter generate/view/email
│       │       ├── EscalationTab.tsx      # Composes 6 sub-document panels below
│       │       ├── FilingGuideTab.tsx     # NY court filing guide (per-track)
│       │       ├── TimelineTab.tsx        # Chronological action log
│       │       ├── shared/
│       │       │   ├── VerificationPanel.tsx   # Renders CourtFormVerification below each doc
│       │       │   ├── RotatingFact.tsx        # Animated loader + 35 legal tips
│       │       │   ├── InlineProgress.tsx      # Compact progress bar for small cards
│       │       │   ├── sol.ts                  # computeSOL() — NY CPLR §213 6-yr calc
│       │       │   ├── openHtmlInTab.ts        # Blob-URL viewer for generated HTML
│       │       │   └── actions.ts              # ACTION_TYPE_OPTIONS + ACTION_ICONS
│       │       ├── strategy/
│       │       │   ├── LookupCard.tsx          # Shared wrapper for all 6 lookup cards
│       │       │   ├── AcrisLookup.tsx         # NYC property (acris.ts backend)
│       │       │   ├── CourtHistoryLookup.tsx  # NYC civil court history
│       │       │   ├── NysEntityLookup.tsx     # NYS DOS entity search
│       │       │   ├── UccLookup.tsx           # NYS UCC filings (2captcha)
│       │       │   ├── EcbLookup.tsx           # NYC code violations
│       │       │   ├── PacerLookup.tsx         # Federal bankruptcy
│       │       │   ├── RefineStrategyPanel.tsx # "Refine with research" → assessStrategy
│       │       │   └── lookupTypes.ts          # Shared TS types for lookup results
│       │       ├── escalation/
│       │       │   ├── PreFilingNotice.tsx
│       │       │   ├── CourtFormPanel.tsx
│       │       │   ├── ProcessServerPanel.tsx  # Includes "Log Service Initiated" modal
│       │       │   ├── AffidavitPanel.tsx
│       │       │   ├── DefaultJudgmentPanel.tsx
│       │       │   ├── SettlementPanel.tsx     # Settlement + Payment Plan (side-by-side)
│       │       │   └── DocumentActions.tsx     # Shared View / Download / Regenerate button row
│       │       └── filing/
│       │           └── filingSteps.tsx         # Per-track (commercial/civil/supreme) step content
│       ├── components/
│       │   ├── evidence/UploadZone.tsx
│       │   ├── layout/{Layout,Sidebar}.tsx
│       │   └── ui/                        # Reusable primitives (NEW)
│       │       ├── Badge.tsx              # <Badge tone="neutral|info|success|warning|danger">
│       │       ├── StatusPill.tsx         # CaseStatus → Badge
│       │       ├── Alert.tsx              # <Alert tone title>...</Alert>
│       │       ├── SectionCard.tsx        # Card with collapsible/defaultOpen + title/action
│       │       ├── EmptyState.tsx         # Icon + title + description + CTA
│       │       └── TabBar.tsx             # Horizontal tabs with icons
│       ├── contexts/AuthContext.tsx
│       ├── lib/{api.ts,utils.ts}          # api.ts includes reanalyzeDocument() for failed-analysis retries
│       ├── types/index.ts                 # TypeScript types (Case, Document w/ analysisError, etc.)
│       └── index.css                      # @layer components: .btn, .card, .input, .divider, .kbd-label, etc.
└── server/
    ├── prisma/schema.prisma               # DB schema
    └── src/
        ├── index.ts                       # Express app entry point
        ├── middleware/auth.ts             # JWT auth
        ├── lib/prisma.ts
        ├── routes/
        │   ├── cases.ts                   # All case routes (~1280 lines, incl. background /analyze and /generate)
        │   ├── auth.ts                    # Register/login/me
        │   └── documents.ts               # File upload + extraction + reanalyze
        └── services/
            ├── claude.ts                  # All Claude AI functions (~2000 lines)
            ├── pdf.ts                     # Puppeteer HTML→PDF + pdf-lib court form
            ├── acris.ts                   # NYC property lookup
            ├── nycourts.ts                # NY court history lookup
            ├── nysEntity.ts               # NYS entity lookup
            ├── nysUCC.ts                  # UCC filings lookup
            ├── nycECB.ts                  # NYC ECB violations
            ├── pacer.ts                   # Federal bankruptcy check
            ├── fileProcessor.ts           # PDF/image text extraction
            └── twoCaptcha.ts              # CAPTCHA solver for UCC
```

### Frontend design system (April 19, 2026 refresh)

- **Color palette is a 4-tone semantic system** (neutral / info / success / warning / danger). Every status chip, badge, and alert maps to one of these tones — no more 9-color rainbow.
- **Source of truth for tones** lives in `client/src/components/ui/Badge.tsx`. Consumers use `<StatusPill>`, `<Badge tone="">`, `<Alert tone="">` — never raw `bg-*-100 text-*-700` combos.
- **Tone maps** in `client/src/lib/utils.ts`: `STATUS_TONES`, `DOC_CLASSIFICATION_TONES`, `STRENGTH_TONES` (replaced the old `*_COLORS` string maps).
- **Dense sections are collapsible** via `<SectionCard collapsible defaultOpen>` — Overview (dates/evidence/missing), Strategy (research/risk), Escalation (each sub-document), FilingGuide (every reference section).
- **No new dependencies** — still React + Tailwind + Lucide. No shadcn / Radix / Headless UI.

---

## Case Workflow & Status Flow

```
DRAFT → ASSEMBLING → ANALYZING → STRATEGY_PENDING → STRATEGY_SELECTED → GENERATING → READY → SENT → ESCALATING → RESOLVED/CLOSED
```

Each status maps to a phase:
- **DRAFT/ASSEMBLING**: Case created, documents being uploaded
- **ANALYZING**: `synthesizeCase()` running in background
- **STRATEGY_PENDING**: Analysis done, user picks strategy
- **STRATEGY_SELECTED**: Strategy set, ready to generate demand letter
- **GENERATING**: Demand letter, settlement, or payment plan generating in background
- **READY**: Demand letter done
- **ESCALATING**: Pre-filing notice sent

**Important:** `GENERATING` is now used by 3 routes — demand letter, settlement, and payment plan. All three run as background jobs and the frontend polls at 3s intervals while `status === 'GENERATING'`.

---

## Background Processing Architecture

The following routes are **fire-and-forget** — they set status, return immediately, and complete work in a background async function. The frontend polls via `refetchInterval: 3000` when status is `ANALYZING` or `GENERATING`.

| Route | Background fn | Status during | Resets to on error |
|---|---|---|---|
| `POST /:id/analyze` | `analyzeCaseInBackground()` | `ANALYZING` | `ASSEMBLING` |
| `POST /:id/generate` | `generateLetterInBackground()` | `GENERATING` | `STRATEGY_SELECTED` |
| `POST /:id/generate-settlement` | `generateSettlementInBackground()` | `GENERATING` | prior status |
| `POST /:id/generate-payment-plan` | `generatePaymentPlanInBackground()` | `GENERATING` | prior status |

Document analysis (`analyzeDocumentInBackground()` in `documents.ts`) has always been fire-and-forget.

If the server restarts mid-background-job, the startup cleanup in `index.ts` resets stuck `ANALYZING`/`GENERATING` cases to `ASSEMBLING`.

---

## AI Functions in `server/src/services/claude.ts`

### Document Processing
- `analyzeDocument(text, filename, mimeType)` → classification, tags, facts
  - Text cap: **15,000 chars** (was 8,000)
  - Extracts 4 new boolean fields: `isSignedOrExecuted`, `disputedByDebtor`, `lateFeesMentioned`, `partialPaymentEvidence`
  - Tag definitions included in prompt for accuracy
  - Retries once (10s pause) before marking `analysisError: true`

### Case Analysis
- `synthesizeCase(documents, userFacts)` → CaseSynthesis (strength, strategy, timeline, legal theory)
- `verifyCaseSynthesis(synthesis, documents, userFacts)` → CourtFormVerification — **flag-only, no retry**
  - Note: passes only `classification/supportsTags/summary` to verifier (NOT full extractedFacts) to avoid truncation; max_tokens 4096

### Demand Letter
- `generateDemandLetter(caseData, strategy)` → DemandLetterResult
- `verifyDemandLetter(html, caseData)` → CourtFormVerification
- `retryDemandLetter(html, verification, caseData, strategy)` → DemandLetterResult

### Pre-Filing Notice
- `generateFinalNotice(caseData, { demandLetterDate, courtName, filingDate })` → DemandLetterResult

### Court Form (3-pass pipeline)
- `generateCourtForm(caseData, track)` → CourtFormResult (track = 'commercial'|'civil'|'supreme')
- `verifyCourtForm(html, caseData)` → CourtFormVerification
- `retryCourtForm(html, verification, caseData, track, formType)` → CourtFormResult

### Default Judgment
- `generateDefaultJudgment(caseData)` → DemandLetterResult (raw HTML, no JSON wrapper)
- `verifyDefaultJudgment(html, caseData)` → CourtFormVerification
- `retryDefaultJudgment(html, verification, caseData)` → DemandLetterResult

### Settlement & Payment Plan
- `generateStipulationOfSettlement(caseData)` → DemandLetterResult (raw HTML, 8192 tokens)
- `verifySettlement(html, caseData)` → CourtFormVerification
- `retrySettlement(html, verification, caseData)` → DemandLetterResult (raw HTML, 8192 tokens)
- `generatePaymentPlanAgreement(caseData)` → DemandLetterResult (raw HTML, 8192 tokens)
- `verifyPaymentPlan(html, caseData)` → CourtFormVerification
- `retryPaymentPlan(html, verification, caseData)` → DemandLetterResult (raw HTML, 8192 tokens)

**Settlement/payment plan use raw HTML output** (not JSON-wrapped text+html) to avoid truncation at token limits.

### Affidavit of Service
- `generateAffidavitOfService(caseData)` → DemandLetterResult

### Strategy Assessment with Research
- `assessStrategyWithResearch(caseData, lookupResults)` → StrategyAssessment

---

## Verification Pipeline Pattern

Every document generation route runs:
1. **Generate** the document (background, post-fire-and-forget return)
2. **Verify** with adversarial Claude call → `CourtFormVerification` (`overallStatus`: verified / review_needed / issues_found)
3. If `issues_found` → **Retry** with issues as context → **Verify again**
4. Store `xVerification` JSON on Case model
5. Frontend polls and renders `<VerificationPanel>` below each document

`VerificationPanel` component in `CaseDetail.tsx` is a shared component used across all documents.

The `CourtFormVerification` / `DocumentVerification` type:
```typescript
{
  overallStatus: 'verified' | 'review_needed' | 'issues_found';
  checks: Array<{ field, status: 'ok'|'missing'|'mismatch'|'hallucinated', expected, found, note }>;
  summary: string;
  blankFields: string[];
  verifiedAt: string;
  didRetry?: boolean;
  generationFailed?: boolean;
}
```

Case analysis (`verifyCaseSynthesis`) is **flag-only** — no retry, result shown before user selects strategy.

---

## Document Analysis — Failed State Handling

Documents go through 3 possible states:
- `classification === null && !analysisError` → **Pending** (spinner, polling active)
- `analysisError === true` → **Failed** (red badge + Retry button, polling stops)
- `classification !== null` → **Classified** (colored badge)

`analyzeDocumentInBackground()` retries once after 10s on failure. On second failure, sets `analysisError: true` on the Document record.

`POST /api/cases/:caseId/documents/:docId/reanalyze` — re-triggers analysis for a failed document. Resets `analysisError: false, classification: null` then fires background analysis.

---

## Debtor Research Lookups (Strategy Tab)

All persisted to DB after running (survive page refresh):

| Button | Service | DB field |
|---|---|---|
| ACRIS Property | `acris.ts` | `acrisResult` |
| Court History | `nycourts.ts` | `courtHistory` |
| NYS Entity | `nysEntity.ts` | `entityResult` |
| UCC Filings | `nysUCC.ts` (2captcha) | `uccResult` |
| ECB Violations | `nycECB.ts` | `ecbResult` |
| PACER Bankruptcy | `pacer.ts` | `pacerResult` |

After running lookups, user can click **Refine Strategy with Research** → calls `assessStrategyWithResearch()`.

---

## Key Route Reference

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/cases                                      # list
POST   /api/cases                                      # create
GET    /api/cases/:id                                  # get one
PUT    /api/cases/:id                                  # update
DELETE /api/cases/:id                                  # delete one

POST   /api/cases/:id/analyze                          # fire-and-forget AI synthesis
POST   /api/cases/:id/reset-analysis
POST   /api/cases/:id/set-strategy
POST   /api/cases/:id/generate                         # fire-and-forget demand letter
POST   /api/cases/:id/final-notice
POST   /api/cases/:id/court-form
POST   /api/cases/:id/default-judgment
POST   /api/cases/:id/generate-affidavit-of-service
POST   /api/cases/:id/generate-settlement              # fire-and-forget
POST   /api/cases/:id/generate-payment-plan            # fire-and-forget
POST   /api/cases/:id/assess-strategy

GET    /api/cases/:id/demand-letter-pdf
GET    /api/cases/:id/final-notice-pdf
GET    /api/cases/:id/court-form-pdf
GET    /api/cases/:id/default-judgment-pdf
GET    /api/cases/:id/settlement-pdf
GET    /api/cases/:id/payment-plan-pdf

GET    /api/cases/:id/acris
GET    /api/cases/:id/courts
GET    /api/cases/:id/entity
GET    /api/cases/:id/ucc
GET    /api/cases/:id/ecb
GET    /api/cases/:id/pacer

POST   /api/cases/:caseId/documents                          # upload (fire-and-forget analysis)
DELETE /api/cases/:caseId/documents/:docId
POST   /api/cases/:caseId/documents/:docId/reanalyze         # re-trigger failed analysis
GET    /api/cases/:caseId/documents/:docId/view
GET    /api/cases/:caseId/documents/:docId/download

POST   /api/cases/:id/actions                          # log manual action
```

---

## Case Model Fields (Prisma Schema)

### Core
`id, status, strategy, title, userId`

### Parties
`claimantName, claimantBusiness, claimantAddress, claimantEmail, claimantPhone`  
`debtorName, debtorBusiness, debtorAddress, debtorEmail, debtorPhone, debtorEntityType`

### Claim
`amountOwed (Decimal), amountPaid (Decimal), serviceDescription, agreementDate, serviceStartDate, serviceEndDate, invoiceDate, paymentDueDate, hasWrittenContract, invoiceNumber, industry, notes`

### AI Analysis (JSON)
`extractedFacts, caseTimeline, evidenceSummary, missingInfo, caseStrength, caseAssessment, caseSummary`

### Generated Documents (HTML + Text)
`demandLetter, demandLetterHtml`  
`finalNotice, finalNoticeHtml`  
`filingPacket, filingPacketHtml, courtFormType, courtFormInstructions`  
`defaultJudgment, defaultJudgmentHtml`  
`affidavitOfServiceHtml, settlementHtml, paymentPlanHtml`

### Verification Results (JSON)
`courtFormVerification, demandLetterVerification, caseAnalysisVerification, defaultJudgmentVerification, settlementVerification, paymentPlanVerification`

### Debtor Research (JSON)
`acrisResult, courtHistory, entityResult, uccResult, ecbResult, pacerResult`

### Document Model
`analysisError Boolean @default(false)` — set to true after 2 failed analysis attempts; triggers "Analysis failed" badge + Retry button in UI instead of infinite spinner.

---

## Important Implementation Details

### Outstanding Balance
Always `amountOwed - amountPaid`. All prompts, verification functions, and court forms use this, NOT `amountOwed`. This is enforced throughout.

### Court Track by Balance
- `< $10,000` → Commercial Claims Court (CIV-SC-70)
- `$10,000–$50,000` → Civil Court (Pro Se Summons & Complaint)
- `> $50,000` → Supreme Court (Summons with Notice)

### Startup Cleanup (server/src/index.ts)
On boot, cases stuck in `ANALYZING` or `GENERATING` are reset to `ASSEMBLING` (handles Railway restart mid-background-job).

### PDF Generation (server/src/services/pdf.ts)
Uses Puppeteer with container-safe flags:
```
--no-sandbox, --disable-setuid-sandbox, --disable-dev-shm-usage, --disable-gpu, --disable-extensions, --single-process
```

### Login Email
Case-insensitive lookup using `findFirst` with `mode: 'insensitive'`. Emails are normalized to lowercase on registration.

### Pre-Filing Notice
`generateFinalNotice()` takes a context object: `{ demandLetterDate, courtName, filingDate }`. The route derives these from the case's action history and computes `filingDate = today + 7 days`.

### View vs Download
- **View**: blob URL (`openHtmlInTab()` utility in CaseDetail.tsx) — no server call
- **Download PDF**: calls Puppeteer endpoint on server

### Settlement / Payment Plan Token Limits
Both use raw HTML output (not JSON-wrapped) with `max_tokens: 8192`. The JSON approach caused truncation on long documents. If you ever switch back to JSON, the parse failure fallback was rendering raw Claude output as the document body.

### Frontend Polling
`refetchInterval` in `CaseDetail.tsx` polls every 3 seconds when:
- `status === 'ANALYZING'` or `'GENERATING'`
- Any document has `classification === null && !analysisError`

Returns `false` (no polling) otherwise.

---

## UI Structure (case-detail/ tabs)

Lives in `client/src/pages/case-detail/`. The shell is `index.tsx` (routes the active tab). Each tab is its own file. Composition order inside each tab uses `<SectionCard>` from `components/ui/` — most sections are collapsible and open by default only when relevant data exists.

1. **Overview** (`OverviewTab.tsx`) — key numbers (mobile-responsive stat cards), pre-judgment interest (CPLR §5001, wraps gracefully on small screens), inline edit form (~25 fields), parties, key dates + SOL, evidence summary, missing info (both legacy string and `MissingInfoItem` with impact/consequence/workaround).
2. **Evidence** (`EvidenceTab.tsx`) — upload zone, flat doc list with classification `<Badge>` (3 states: analyzing / failed-with-retry-button / classified), preview modal (image/PDF inline), delete, reanalyze.
3. **Strategy** (`StrategyTab.tsx`) — disclaimer alert, AI strength badge, legal theory elements, risk & enforcement (counterclaim risk + entity path + SOL + strategy reasoning as Alerts), **Debtor Research** SectionCard containing 6 lookup cards (one file each under `strategy/`), analysis verification panel, `RefineStrategyPanel`, 3-card strategy selector.
4. **Letter** (`LetterTab.tsx`) — generate / copy / email / view / download PDF / regenerate + verification panel + rendered HTML preview.
5. **Escalation** (`EscalationTab.tsx`) — composes 6 collapsible panels from `escalation/`: `PreFilingNotice`, `CourtFormPanel`, `ProcessServerPanel` (with "Log Service Initiated" modal and auto-computed deadline cards), `AffidavitPanel` (only after service logged), `DefaultJudgmentPanel` (only after answer deadline passes), `SettlementPanel` (Stipulation + Payment Plan side-by-side, fire-and-forget generation — continues in background if browser closed). Each generated doc gets its own verification panel when present.
6. **Filing** (`FilingGuideTab.tsx`) — court routing card with SOL, thresholds reference, pre-filing checklist, per-track step-by-step from `filing/filingSteps.tsx`, service best-practices, 8-row deadline tracker, common mistakes, enforcement tools, NYC marshal directory, attorney disclaimer.
7. **Timeline** (`TimelineTab.tsx`) — log-action form (payment amount appears only when `PAYMENT_RECEIVED`), reverse-chronological action list.

Reusable pieces (all in `case-detail/shared/`):
- `RotatingFact` — animated loader with elapsed timer + progress bar + 35 rotating NY-collections tips (used during every AI-generation wait state).
- `InlineProgress` — compact progress bar for the small side-by-side settlement/payment-plan cards (45s estimate).
- `VerificationPanel` — renders `DocumentVerification` for the 6 verified document types (case analysis, demand letter, court form, default judgment, settlement, payment plan). Pre-filing notice and affidavit do **not** have verification pipelines on the backend.
- `sol.ts` — `computeSOL()` and `SOL_STATUS_TONE` mapping. Shared across Overview, Strategy, FilingGuide.
- `openHtmlInTab()` — blob-URL viewer for generated HTML (no server roundtrip).
- `actions.ts` — `ACTION_TYPE_OPTIONS` + `ACTION_ICONS` for the Timeline tab.

---

## Known Issues / Pending Work

- **PACER account**: User needs to contact PACER support at (800) 676-6856 to enable PCL search privileges on account `tyenyllc`

- **UCC lookup**: Requires 2captcha API key for NYS UCC scraper

- **Schema migrations**: `analysisError` column on Document and all 5 verification fields on Case are in the schema. The production DB already has them deployed; the preview Railway service uses a separate DB that `prisma db push` provisions on first boot.

- **Frontend refresh — browser QA partially done**: The April 19 2026 refactor (commits `f65f1ef` + `18f6547` + follow-ups) passed `tsc --noEmit`, `npm run build`, and a smoke test against the Vite dev server (every key file served with HTTP 200, no transform errors). Audited for 1:1 functional parity against the pre-change commit `d18f3d9`. Login page confirmed rendering in the live preview Railway deploy. Remaining walk-through: Dashboard → open a case → every tab (Overview, Evidence, Strategy, Letter, Escalation, Filing, Timeline) in each status (DRAFT, STRATEGY_PENDING, READY, ESCALATING). Confirm `RotatingFact` appears during analyze/generate waits and `VerificationPanel` appears below each generated document.

---

## Environment Variables (Railway)

```
DATABASE_URL          — PostgreSQL connection string
JWT_SECRET            — JWT signing secret
ANTHROPIC_API_KEY     — Claude API key
TWO_CAPTCHA_API_KEY   — For UCC lookup CAPTCHA
PACER_USERNAME        — tyenyllc
PACER_PASSWORD        — (set in Railway)
NYC_OPEN_DATA_APP_TOKEN — Reduces rate limiting on ACRIS/ECB
NODE_ENV              — production
```

---

## DB Access (Direct)

Get the connection string from Railway dashboard → PostgreSQL service → Connect tab.

```bash
psql YOUR_RAILWAY_DATABASE_URL
```
