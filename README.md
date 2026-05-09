# Reclaim — NY B2B Collections Platform

An AI-powered platform that takes a NY B2B collections case from intake through pre-trial workflow, then hands off cleanly to a partner attorney. Acts like a real NY collections lawyer — not a generic AI wrapper.

**Repo name** is `pharmacy-voice-bot` for historical reasons (the repo started as a different project). The current product is **Reclaim**.

---

## What it does

| Stage | What the platform handles |
|---|---|
| Intake | Case + parties + claim + evidence upload, AI synthesis, SOL check, counterclaim risk model |
| Strategy | Cause-of-action analysis (breach / account stated / quantum meruit), pre-judgment interest @ 9%, court routing by amount |
| Investigation | 6 debtor-research scrapers: ACRIS (NYC property), NY Courts, NYS Entity, NYS UCC, NYC ECB, PACER |
| Demand | AI-drafted demand letter + pre-filing notice, certified mail (Lob), tracked email (Resend), e-signature (Dropbox Sign) |
| Collect | Debtor magic-link portal (pay / propose plan / dispute), Stripe Connect escrow with 12% recovery fee, BullMQ follow-up cadences |
| File | Default judgment, NYSCEF / EDDS / Commercial Claims — paid via InfoTrack, or DIY walkthrough |
| Serve | Proof.com process service + RON notary, SCRA non-military affidavit |
| Hand off | Partner-attorney portal with full case package + draft post-judgment toolkit (info subpoena, restraining notice, executions) |

Every generated document is run through an adversarial "judge agent" verification + auto-retry.

---

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind, React Query, React Router 7
- **Backend:** Express + TypeScript, Prisma + PostgreSQL, Puppeteer for PDF, BullMQ + Redis for jobs
- **AI:** Anthropic Claude (Sonnet 4.6 for case analysis, doc generation, judge verification)
- **Vendors:** Lob (mail), Resend (email), Dropbox Sign (e-sig), Stripe Connect (escrow), Proof.com (notary + process serve), InfoTrack (e-filing)
- **Deploy:** Railway (single service, monorepo, nixpacks)

---

## Run locally

```bash
# 1. Install deps
cd server && npm install
cd ../client && npm install

# 2. Set up env
cp .env.example .env
# Fill in DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET, vendor keys

# 3. Push schema
cd server && npx prisma db push && npx prisma generate

# 4. Start (from repo root)
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

---

## Project layout

```
client/src/
  pages/
    Dashboard.tsx, NewCase.tsx, Login.tsx, Register.tsx
    DebtorPortal.tsx        — public magic-link portal at /respond/:token
    AttorneyPortal.tsx      — public magic-link portal at /attorney/:token
    PayoutSettings.tsx      — Stripe Connect onboarding
    WalkthroughPage.tsx     — DIY court filing wizard
    case-detail/            — overview, strategy, evidence, letter, escalation, timeline, filing guide

server/src/
  routes/
    auth.ts, cases.ts, documents.ts
    portal.ts        — debtor portal API (no auth, magic link)
    attorney.ts      — attorney portal API (no auth, magic link)
    handoff.ts       — partner attorney handoff
    walkthrough.ts   — DIY filing state machine
    payouts.ts       — Stripe Connect onboarding
    webhooks.ts      — Lob, Resend, Dropbox Sign, Stripe, Proof, InfoTrack
  services/
    claude.ts        — AI doc generation + judge verification
    pdf.ts           — Puppeteer PDF rendering
    lob.ts, resend.ts, dropboxSign.ts, stripe.ts, proof.ts, infoTrack.ts
    postJudgmentDocs.ts  — info subpoena, restraining notice, executions
    acris.ts, nycourts.ts, nysEntity.ts, nysUCC.ts, nycECB.ts, pacer.ts  — debtor research scrapers
  jobs/
    followUpScheduler.ts   — BullMQ per-strategy cadences
```

---

## Branches

- **`main`** — stable / production
- **`dev`** — integration branch (merge feature work here before promoting to main)
- **`hardening`** — current feature branch; see `HARDENING.md` on that branch for the gap list closing the lawyer-judgment gap (intake hardening, collectibility score, leverage map, confession of judgment, SOL watchdog, etc.)

---

## Active docs

- **[`AUDIT.md`](./AUDIT.md)** — Legal workflow audit + business plan (3-phase roadmap, gap analysis, pricing model)
- **[`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md)** — Locked vendor + scope decisions from the audit review
- **[`PHASE_A_TEST_PLAN.md`](./PHASE_A_TEST_PLAN.md)** — End-to-end test runbook for the send/sign/collect flow
- **`HARDENING.md`** (on `hardening` branch) — Next build queue: closing the lawyer-judgment gap

---

## Pricing model

| Revenue line | Price | When earned |
|---|---|---|
| Pro subscription | $79/mo | Always |
| Recovery fee | 12% of collected | Debtor pays via portal (Stripe escrow) |
| Filing service | $200 + court fees | User picks paid filing path |
| Notary / process serve | Cost + handling | Per transaction (Proof.com) |
| Attorney referral | 20% of contingency | Case hands off to partner attorney |
