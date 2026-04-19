# Reclaim — Collections Platform: Handoff Document
**Date:** April 19, 2026  
**Branch:** `claude/collections-platform-mvp-J862j`  
**Deployed at:** `https://getmoney.up.railway.app`  
**Repo:** `matthewmakh/pharmacy-voice-bot`  
**DB:** Railway PostgreSQL (get connection string from Railway dashboard)

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
├── client/                        # React frontend
│   └── src/
│       ├── pages/
│       │   ├── CaseDetail.tsx     # Main case UI (3200+ lines, 7 tabs)
│       │   ├── Dashboard.tsx
│       │   ├── NewCase.tsx
│       │   ├── Login.tsx
│       │   └── Register.tsx
│       ├── lib/
│       │   ├── api.ts             # All API calls
│       │   └── utils.ts
│       ├── types/index.ts         # TypeScript types (Case, Document, etc.)
│       └── components/
│           └── evidence/UploadZone.tsx
└── server/
    ├── prisma/schema.prisma       # DB schema
    └── src/
        ├── index.ts               # Express app entry point
        ├── middleware/auth.ts     # JWT auth
        ├── lib/prisma.ts
        ├── routes/
        │   ├── cases.ts           # All case routes (~1280 lines)
        │   ├── auth.ts            # Register/login/me
        │   └── documents.ts       # File upload + extraction
        └── services/
            ├── claude.ts          # All Claude AI functions (~2000 lines)
            ├── pdf.ts             # Puppeteer HTML→PDF + pdf-lib court form
            ├── acris.ts           # NYC property lookup
            ├── nycourts.ts        # NY court history lookup
            ├── nysEntity.ts       # NYS entity lookup
            ├── nysUCC.ts          # UCC filings lookup
            ├── nycECB.ts          # NYC ECB violations
            ├── pacer.ts           # Federal bankruptcy check
            ├── fileProcessor.ts   # PDF/image text extraction
            └── twoCaptcha.ts      # CAPTCHA solver for UCC
```

---

## Case Workflow & Status Flow

```
DRAFT → ASSEMBLING → ANALYZING → STRATEGY_PENDING → STRATEGY_SELECTED → GENERATING → READY → SENT → ESCALATING → RESOLVED/CLOSED
```

Each status maps to a phase:
- **DRAFT/ASSEMBLING**: Case created, documents being uploaded
- **ANALYZING**: Claude synthesizeCase() running
- **STRATEGY_PENDING**: Analysis done, user picks strategy
- **STRATEGY_SELECTED**: Strategy set, ready to generate demand letter
- **GENERATING**: Claude generating demand letter
- **READY**: Demand letter done
- **ESCALATING**: Pre-filing notice sent

---

## AI Functions in `server/src/services/claude.ts`

### Document Processing
- `analyzeDocument(text, filename, mimeType)` → classification, tags, facts

### Case Analysis
- `synthesizeCase(documents, userFacts)` → CaseSynthesis (strength, strategy, timeline, legal theory)
- `verifyCaseSynthesis(synthesis, documents, userFacts)` → CourtFormVerification ← **NEW: judge agent**

### Demand Letter
- `generateDemandLetter(caseData, strategy)` → DemandLetterResult
- `verifyDemandLetter(html, caseData)` → CourtFormVerification ← **NEW: judge agent**
- `retryDemandLetter(html, verification, caseData, strategy)` → DemandLetterResult ← **NEW**

### Pre-Filing Notice
- `generateFinalNotice(caseData, { demandLetterDate, courtName, filingDate })` → DemandLetterResult

### Court Form (3-pass pipeline)
- `generateCourtForm(caseData, track)` → CourtFormResult (track = 'commercial'|'civil'|'supreme')
- `verifyCourtForm(html, caseData)` → CourtFormVerification
- `retryCourtForm(html, verification, caseData, track, formType)` → CourtFormResult

### Default Judgment
- `generateDefaultJudgment(caseData)` → DemandLetterResult
- `verifyDefaultJudgment(html, caseData)` → CourtFormVerification ← **NEW: judge agent**
- `retryDefaultJudgment(html, verification, caseData)` → DemandLetterResult ← **NEW**

### Settlement & Payment Plan
- `generateStipulationOfSettlement(caseData)` → DemandLetterResult
- `verifySettlement(html, caseData)` → CourtFormVerification ← **NEW: judge agent**
- `retrySettlement(html, verification, caseData)` → DemandLetterResult ← **NEW**
- `generatePaymentPlanAgreement(caseData)` → DemandLetterResult
- `verifyPaymentPlan(html, caseData)` → CourtFormVerification ← **NEW: judge agent**
- `retryPaymentPlan(html, verification, caseData)` → DemandLetterResult ← **NEW**

### Affidavit of Service
- `generateAffidavitOfService(caseData)` → DemandLetterResult

### Strategy Assessment with Research
- `assessStrategyWithResearch(caseData, lookupResults)` → StrategyAssessment

---

## Verification Pipeline Pattern

Every document generation route now runs:
1. **Generate** the document
2. **Verify** with adversarial Claude call → `CourtFormVerification` (`overallStatus`: verified / review_needed / issues_found)
3. If `issues_found` → **Retry** with issues as context → **Verify again**
4. Store `xVerification` JSON on Case model
5. Return alongside document HTML

`VerificationPanel` component in `CaseDetail.tsx` renders the result below each document.

The `CourtFormVerification` type:
```typescript
{
  overallStatus: 'verified' | 'review_needed' | 'issues_found';
  checks: Array<{ field, status: 'ok'|'missing'|'mismatch'|'hallucinated', expected, found, note }>;
  summary: string;
  blankFields: string[];
  verifiedAt: string;
  didRetry?: boolean;
}
```

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

GET    /api/cases                          # list
POST   /api/cases                          # create
GET    /api/cases/:id                      # get one
PUT    /api/cases/:id                      # update
DELETE /api/cases/:id                      # delete one

POST   /api/cases/:id/analyze              # run AI synthesis
POST   /api/cases/:id/reset-analysis
POST   /api/cases/:id/set-strategy
POST   /api/cases/:id/generate             # demand letter
POST   /api/cases/:id/final-notice
POST   /api/cases/:id/court-form
POST   /api/cases/:id/default-judgment
POST   /api/cases/:id/generate-affidavit-of-service
POST   /api/cases/:id/generate-settlement
POST   /api/cases/:id/generate-payment-plan
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

POST   /api/cases/:id/actions              # log manual action
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

### Verification Results (JSON) ← NEW
`courtFormVerification, demandLetterVerification, caseAnalysisVerification, defaultJudgmentVerification, settlementVerification, paymentPlanVerification`

### Debtor Research (JSON)
`acrisResult, courtHistory, entityResult, uccResult, ecbResult, pacerResult`

---

## Important Implementation Details

### Outstanding Balance
Always `amountOwed - amountPaid`. All prompts, verification functions, and court forms use this, NOT `amountOwed`. This is enforced throughout.

### Court Track by Balance
- `< $10,000` → Commercial Claims Court (CIV-SC-70)
- `$10,000–$50,000` → Civil Court (Pro Se Summons & Complaint)
- `> $50,000` → Supreme Court (Summons with Notice)

### Startup Cleanup (server/src/index.ts)
On boot, cases stuck in `ANALYZING` or `GENERATING` are reset to `ASSEMBLING` (handles Railway restart mid-request).

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

---

## UI Structure (CaseDetail.tsx Tabs)

1. **Overview** — case details, party info, SOL calculator, missing info
2. **Evidence** — document upload, AI classification badges, preview
3. **Strategy** — AI analysis results, legal theory, debtor research lookups, strategy selector
4. **Letter** — demand letter generate/view/download/email + verification panel
5. **Escalation** — pre-filing notice, court form + verification, process server, affidavit, default judgment + verification, settlement + verification, payment plan + verification
6. **Filing** — NY court filing guide, NYSCEF instructions by track
7. **Timeline** — chronological action log

Key components in CaseDetail.tsx:
- `RotatingFact` — animated loader with elapsed timer + progress bar
- `InlineProgress` — compact progress bar for small cards
- `VerificationPanel` — renders CourtFormVerification result (shared across all documents)
- `RefineStrategyPanel` — shows "Refine Strategy with Research" button + results

---

## Known Issues / Pending Work

- **Schema migration pending**: The 5 new verification fields (`demandLetterVerification`, `caseAnalysisVerification`, `defaultJudgmentVerification`, `settlementVerification`, `paymentPlanVerification`) are in the Prisma schema and Prisma client is regenerated, but `prisma db push` has NOT been run against Railway DB yet. **Run this before testing new verification features:**
  ```bash
  # From server/ with Railway DATABASE_URL set:
  DATABASE_URL="postgresql://postgres:JCHIzHSSraaQfGlSYkSIXUVOFgLIkARX@shortline.proxy.rlwy.net:57411/railway" npx prisma db push
  ```

- **PACER account**: User needs to contact PACER support at (800) 676-6856 to enable PCL search privileges on account `tyenyllc`

- **UCC lookup**: Requires 2captcha API key for NYS UCC scraper

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
