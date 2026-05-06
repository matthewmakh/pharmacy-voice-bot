# IMPLEMENTATION_NOTES.md — Locked Decisions from Audit Review

This file captures the decisions made during review of `AUDIT.md`. It is the
source of truth for the build going forward. When `AUDIT.md` and this file
disagree, **this file wins** — `AUDIT.md` is the original survey, this is what
we actually decided to build.

Companion to: `AUDIT.md` (the underlying survey of the lawyer's workflow + gap
analysis).

---

## 1. Product scope (locked — narrower than AUDIT.md)

**Pre-trial only, then hand off.**

The product takes a B2B collections case from intake up to the moment court
proceedings begin. At that point the case is handed off to a partner attorney.
Reclaim earns a referral fee on the handoff.

| Phase of workflow | In product? | Notes |
|---|---|---|
| Intake & engagement letter | Yes | Existing |
| Investigation (NYS Entity, ACRIS, UCC, ECB, court history) | Yes | Existing |
| Demand letter (mailed + emailed) | Yes | Phase A |
| Settlement / payment plan with e-sign | Yes | Phase A |
| Debtor portal (pay / propose / dispute) | Yes | Phase A |
| Auto follow-up cadence | Yes | Phase A |
| Pre-filing notice | Yes | Phase A |
| Court form generation (summons + complaint) | Yes | Existing |
| **NYSCEF / EDDS / in-person filing** | **Dual flow** | Phase B — paid via InfoTrack ($200 markup) **or** free DIY walkthrough |
| Process service (affidavit-grade) | Yes | Phase B — Proof.com |
| SCRA non-military affidavit | Yes | Phase B — DOD portal lookup |
| §3215(g)(3) additional notice mailings | Yes | Phase B — Proof Serve |
| **Default judgment** | Yes (procedural) | Phase B — generate + walk user through filing OR include in handoff |
| **Defendant files an answer / appears** | **Hand off** | Trigger attorney handoff flow |
| Trial / motion practice | **Out of scope** | Partner attorney handles |
| Post-judgment enforcement (info subpoena, restraining notice, executions, marshal dispatch) | **Generated as handoff package only** | Not customer-facing flows; given to attorney as draft docs |
| Self-represent path | Opt-in secondary CTA | With warnings; same draft docs available |

This scope change drops what was originally Phase C (customer-facing
enforcement). The product is cleaner, faster to ship, and lower regulatory
risk.

---

## 2. Vendor decisions (locked)

| Capability | Vendor | Rationale |
|---|---|---|
| Certified mail RRR | **Lob** | API + tracking webhooks, ~$8/letter |
| Tracked email | **Resend** | $20/mo for 50k emails, shared `mail.reclaim.legal` domain v1 |
| E-signature | **Adobe Sign** (with Dropbox Sign fallback) | User already has Adobe Sign — see action item below |
| Escrow / payments | **Stripe Connect** | Charges-only flow, debtor pays → Reclaim escrow → 12% fee → ACH to claimant |
| Notary (RON) + Process serving + Identity verification | **Proof.com** (single vendor) | One API, one billing relationship. RON via Proof Notarize, process serve via Proof Serve (developer.proofserve.com, 1,300+ servers, NY DCWP-licensed coverage). Per-transaction pricing, no setup minimums. |
| NYSCEF / EDDS e-filing | **InfoTrack** | OCA-accredited; building NYSCEF ourselves is not realistic (no public API, year+ accreditation, ToS exposure) |
| Job queue / scheduler | **BullMQ on Redis** | Railway-friendly |
| PDF rendering | **Puppeteer** (existing) | Already in `server/src/services/pdf.ts` |
| SCRA lookup | **DOD SCRA portal** (free) | No vendor needed |

### Action item: confirm Adobe Sign API tier

Adobe Sign API access requires the **Adobe Acrobat Sign Solutions** tier. The
consumer Acrobat Sign bundled with Acrobat Pro **does NOT** include API access.

**Before Phase A starts, confirm the user's Adobe account.** If it's the
consumer/Acrobat Pro tier, options are:

1. Upgrade to Solutions (~$25/seat/mo + transaction fees), or
2. Fall back to **Dropbox Sign** (~$30/mo, simpler API, same outcome)

### Proof.com sales-call verifications

Before signing the Proof contract:

- Confirm **Proof Serve API is GA** (not beta)
- Confirm **NY/NYC SLA with DCWP-licensed servers** (NYC requires licensed servers)
- Confirm **IDV is exposed as a standalone API endpoint**, not only bundled inside the notarization flow

If any of these fail, the fallback is split-vendor: Proof for notary +
**ABC Legal** for process service. We'd lose the consolidation benefit but
keep the workflow.

---

## 3. NYSCEF dual-flow offering (locked)

The user picks between two paths at the moment of filing:

### Paid path — $200 markup over court fees

- Reclaim files via InfoTrack (~$25 to InfoTrack + court fees)
- ~$175 margin per filing
- Zero user friction; user just clicks "File for me"
- Available for: NYSCEF (Supreme Court), EDDS (Civil Court pro se)

### Free path — DIY walkthrough

- Reclaim prepares a fully compliant PDF/A bundle (text-searchable, no JS,
  flat layers)
- Step-by-step walkthrough hand-holds the user through their own NYSCEF/EDDS
  account upload
- For Commercial Claims: printable bundle + in-person filing checklist
  (no e-filing exists for Commercial Claims)

Both flows show side-by-side at the filing moment. The user picks.

---

## 4. Attorney handoff flow (NEW major feature, Phase B)

Triggered by:

- Defendant files an answer
- User clicks "Hand off to attorney"
- 28+ days post-demand with no resolution (auto-prompt)

**Package contents** (everything bundled, delivered as a secure portal link
or zip + email):

- Full case file (parties, claim, dates, amounts, status timeline)
- All generated documents (demand, pre-filing notice, court forms, settlement
  attempts, default judgment package if applicable)
- Investigation results (ACRIS, NYS Entity, UCC, ECB, court history, PACER)
- Communication history with debtor (email opens, mail tracking, portal
  interactions)
- **Draft post-judgment toolkit** — info subpoena (CPLR §5224), restraining
  notice (§5222), property execution (§5230), income execution (§5231),
  marshal/sheriff request packet
- Judgment-interest tracker (calculated to current date, accrual rate, totals)

**Reclaim earns a referral fee** — target: **20% of attorney's contingency**
on the case. Aligns Reclaim's incentives with the partner attorney's success.

**Self-represent opt-in** — for users who prefer to continue alone past court
start, the same draft docs are available, with full disclaimers and warnings.
Not the recommended path; secondary CTA only.

---

## 5. Phase A — 3-week sprint (locked, ready to start)

Goal: by end of week 3, money flows through the product and Reclaim takes its
first cut.

| # | Feature | Vendor | Days |
|---|---|---|---|
| 1 | Lob certified mail (demand + pre-filing notice) | Lob | 2-3 |
| 2 | Resend tracked email | Resend | 2-3 |
| 3 | E-sign settlement + payment plan | Adobe Sign or Dropbox Sign | 2 |
| 4 | Stripe Connect escrow (debtor pays → 12% fee → ACH) | Stripe | 4-5 |
| 5 | Defendant response portal (magic link, 30-day token) | — | 4-5 |
| 6 | Auto follow-up cadence (BullMQ, per-strategy 0/7/14/21) | — | 3-4 |

**After Phase A:** ~60% of cases settle on the demand letter. 12% recovery
fee on each. First revenue line proven.

**Input needed from user before sprint starts:**

- Adobe Sign account tier confirmation (see §2)
- API keys / accounts: Lob, Resend, Stripe Connect, (Adobe Sign or Dropbox Sign)
- Sender domain DNS access for `mail.reclaim.legal` SPF/DKIM/DMARC
- Partner attorney name + contact (for week-3 handoff testing)

---

## 6. Phase B — File, Serve, Hand Off (6–10 weeks after Phase A)

| # | Feature | Vendor |
|---|---|---|
| 7 | Notary (RON) for affidavits/verifications | Proof.com |
| 8 | Process service with affidavit-of-service return | Proof Serve |
| 9 | Paid NYSCEF / EDDS filing ($200 markup) | InfoTrack |
| 10 | Free DIY filing walkthroughs (NYSCEF / EDDS / Commercial Claims) | — |
| 11 | SCRA non-military affidavit | DOD portal (free) |
| 12 | §3215(g)(3) additional notice mailings | Proof Serve |
| 13 | Default judgment package (generate + file or hand off) | InfoTrack or DIY |
| 14 | **Attorney handoff flow** | — |
| 15 | Self-represent opt-in path | — |

---

## 7. Pricing model — final (5 revenue lines)

| Revenue line | Price | When earned |
|---|---|---|
| Pro subscription | $79 / mo | Always |
| Recovery fee (escrow) | 12% of collected | When debtor pays via portal |
| Filing service (paid path) | $200 + court fees | When user picks paid filing |
| Notary / process serve passthrough | Cost + handling | Per transaction |
| Attorney referral fee | 20% of attorney contingency | When case hands off |

All revenue tied to customer outcomes. No fees on losing cases. Subscription
covers the dashboard + investigation tools.

---

## 8. Technical inventory (what to build, by file)

These are not new tasks for this turn — this is a reference list for the
sprint kickoff.

### Backend

- **New services** — `server/src/services/`:
  - `lob.ts` — certified mail send + tracking webhooks
  - `resend.ts` — tracked email send + open/click webhooks
  - `adobeSign.ts` (or `dropboxSign.ts` fallback) — agreement creation + completion webhook
  - `stripe.ts` — Stripe Connect escrow + payouts
  - `proof.ts` — notary (RON) + process service (Proof Serve) wrapper
  - `infoTrack.ts` — NYSCEF / EDDS filing (Phase B)
  - `attorneyHandoff.ts` — package builder + delivery (Phase B)

- **Routes** — `server/src/routes/cases.ts` adds:
  - `/send-demand`, `/send-final-notice`
  - `/sign-settlement`, `/sign-payment-plan`
  - `/dispatch-server`, `/file-court`
  - `/handoff-attorney`

- **Schema** — `server/prisma/schema.prisma`:
  - New fields on Case: `demandLetterMailedAt`, `mailTrackingNumber`,
    `mailDeliveredAt`, `eSignAgreementId`, `escrowPaymentIntentId`,
    `processServerJobId`, `nyscefIndexNumber`, `attorneyHandoffStatus`,
    `attorneyHandoffAt`, `informationSubpoenaHtml`, `restrainingNoticeHtml`,
    `propertyExecutionHtml`, `incomeExecutionHtml`
  - New ActionType enum values: `DEMAND_LETTER_MAILED`,
    `DEMAND_LETTER_DELIVERED`, `EMAIL_OPENED`, `SETTLEMENT_PROPOSED`,
    `DISPUTE_FILED`, `PORTAL_VIEWED`, `PAYMENT_VIA_PORTAL`,
    `ATTORNEY_HANDOFF_INITIATED`

- **Jobs** — `server/src/jobs/`:
  - `followUpScheduler.ts` — BullMQ scheduler with per-strategy cadence

- **Existing** — `server/src/services/claude.ts`:
  - Add doc generators for info subpoena (CPLR §5224), restraining notice
    (§5222), property/income executions (§5230/§5231) — used only by attorney
    handoff package, not customer-facing

### Frontend

- **Modified pages** — `client/src/pages/case-detail/`:
  - `EscalationTab.tsx` — gains "Send" / "Sign" / "Pay filing fee" /
    "Hand off to attorney" buttons (currently view-only)
  - `escalation/SettlementPanel.tsx` — gains "Send for e-signature" button

- **New pages** — `client/src/pages/`:
  - `debtor-portal/[token].tsx` — debtor magic-link landing (pay / propose /
    dispute)
  - `case-detail/HandoffTab.tsx` — attorney handoff status + package preview

---

## 9. Open items requiring user input

1. **Adobe Sign account tier** — Solutions (API access) or Acrobat Pro (no API)?
2. **Partner attorney contact** — for handoff flow testing in Phase B
3. **Proof.com sales call** — schedule before Phase B kickoff to verify
   Proof Serve GA + NY DCWP coverage + standalone IDV endpoint
4. **API keys / accounts** for Phase A: Lob, Resend, Stripe Connect, e-sign provider
5. **Sender domain** — DNS access for `mail.reclaim.legal` SPF/DKIM/DMARC

Phase A cannot start until #1 (decides which e-sign vendor) and #4 (keys).

---

## 10. What was deferred / dropped vs original AUDIT.md

| Original gap | Original phase | New status |
|---|---|---|
| Customer-facing post-judgment enforcement (info subpoena UI, restraining notice UI, executions UI) | Phase C | **Dropped from customer scope.** Generated as handoff package only. |
| Customer-facing marshal/sheriff dispatch | Phase C | **Dropped from customer scope.** Goes into handoff package as draft request. |
| Customer-facing judgment interest tracker | Phase C | **Moved to handoff package.** |
| Trial / motion practice support | (never planned) | Out of scope. Partner attorney handles. |
| Reclaim becomes its own NYSCEF e-filer | (user asked) | **Not realistic** — no public API, year+ OCA accreditation. Use InfoTrack. |

This list is intentional and reflects user decisions during review. It is
not a "we'll get to it later" list — these are deliberate scope cuts.
