# Reclaim — Legal Workflow Audit & Business Plan

**Date:** May 5, 2026
**Branch:** `claude/audit-legal-workflow-jtVHr`
**Premise:** The product should act like a real NY B2B collections lawyer — not a generic AI wrapper — handling everything a lawyer does up to (but not including) trial.

---

## 1. State of the Codebase (across all branches)

Three branches. All three carry a `HANDOFF.md`. Salient points across them:

| Branch | What it is | What it added |
|---|---|---|
| `claude/collections-platform-mvp-J862j` | Original MVP (commit `46c5e76`) | Full pivot from pharmacy voice bot → NY B2B collections platform. 7-tab case detail. Demand letter, court forms, default judgment, settlement, payment plan, affidavit of service. 6 debtor-research scrapers. |
| `claude/refresh-frontend-design-wW79w` | UI refresh (commit `f65f1ef` + follow-ups) | Split 3,181-line `CaseDetail.tsx` into `pages/case-detail/*`. 4-tone semantic palette. Reusable `<SectionCard>`, `<Badge>`, `<Alert>`. Adversarial verification ("judge agent") wired to all 6 generated documents. |
| `claude/audit-legal-workflow-jtVHr` | This audit | (no code changes — analysis only) |

What the product **already does well**:

- Intake → AI synthesis → strategy selection → demand letter → pre-filing notice → court form → process server log → affidavit → default judgment → settlement → payment plan
- Court routing by amount (Commercial Claims < $10k, Civil ≤ $50k, Supreme > $50k) with verified courthouse address per borough
- Cause-of-action analysis: breach (written/oral), account stated, quantum meruit
- SOL calc per CPLR §213 (6-year)
- Pre-judgment interest @ NY statutory 9%
- Counterclaim-risk model with industry modifiers (creative/tech = elevated, healthcare/wholesale = lower)
- 6 debtor lookups: ACRIS (NYC property), NY Courts (history), NYS Entity, NYS UCC, NYC ECB, PACER
- Adversarial "judge" verification + auto-retry on every generated document (case analysis, demand letter, court form, default judgment, settlement, payment plan)
- Deadline calculator: 20/30-day answer windows, default-motion eligibility, 120-day service window
- Per-track filing guide with checklist, common mistakes, NYC marshal directory

What the product **does not do at all** (the core finding of this audit):

- **No sending.** No certified mail, no email send, no SMS, no fax. The user has to print and mail everything.
- **No e-signature.** Settlements and payment plans are unsigned templates.
- **No e-filing.** No NYSCEF, no EDDS, no County Clerk integration. Filing is "drive to the courthouse with 3 copies."
- **No process server dispatch.** "Log Service Initiated" is a manual checkbox; no integration with ABC Legal, Proof, ServeNow, etc.
- **No payment processing.** Settlements have no Stripe/ACH rails. The debtor has to wire money out-of-band.
- **No post-judgment enforcement workflow.** No info subpoena, no restraining notice, no income execution, no transcript of judgment, no marshal dispatch.
- **No notary.** Affidavits, verifications, info subpoenas all need wet-ink notarization. No online notary integration.
- **No defendant-response handling.** If the debtor answers, motions, or counterclaims, there's no workflow.
- **No discovery.** No interrogatories, no notice to admit, no document requests, no subpoenas duces tecum.
- **No client billing or contingency capture.** The product makes no money from collections it enables.

That last bullet is the one that matters most for the business model.

---

## 2. What a NY Collections Lawyer Actually Does (the 13 phases)

Mapped step-by-step against the product. ✅ = covered. 🟡 = partial. ❌ = missing.

### Phase 1 — Intake & engagement
| Step | Status |
|---|---|
| Conflict check (does our firm already represent the debtor?) | ❌ |
| Signed engagement letter / fee agreement (contingency 25–40%, hourly, or hybrid) | ❌ |
| Verify creditor's authority to bring the claim (corporate signatory, board resolution if needed) | ❌ |
| KYC on creditor (entity verification, beneficial owners) | ❌ |
| Initial damages calc (principal + interest + costs) | ✅ |
| Document collection (contract, invoices, statements, comms) | ✅ |

### Phase 2 — Investigation / skip trace / asset search
| Step | Status |
|---|---|
| Verify debtor's exact legal name via Secretary of State | ✅ (NYS Entity) |
| Registered agent lookup | ✅ |
| Officers / managers / pierce-the-veil candidates | 🟡 (NYS Entity returns this; not surfaced in UI prominently) |
| Real property (ACRIS / county recorder) | ✅ |
| Senior creditors (UCC-1 filings) | ✅ |
| Prior judgments / liens against debtor | 🟡 (court history covers this) |
| Active litigation as defendant | ✅ (court history) |
| Federal bankruptcy | ✅ (PACER) |
| Tax warrants (NY DTF) | ❌ |
| NYC ECB / DOB / OATH violations | ✅ |
| Bank account intelligence (from prior court filings, UCC, check copies) | ❌ |
| Phone / website / social verification | ❌ |
| D&B or Experian Business credit | ❌ |
| Industry licenses (DCWP, DOT, healthcare) | ❌ |
| Collectability score (synthesizes all the above into one number) | 🟡 (`assessStrategyWithResearch` reasons through it but doesn't output a numerical score the user can act on) |

### Phase 3 — Statute & theory
| Step | Status |
|---|---|
| SOL: CPLR §213(2) breach (6yr) | ✅ |
| SOL: UCC §2-725 sale of goods (4yr) | ❌ |
| SOL: account stated (6yr from last activity, NY GOL §17-101 reset) | 🟡 |
| Causes: breach written/oral, account stated, quantum meruit | ✅ |
| Causes: goods sold and delivered (UCC 2-709) | ❌ |
| Promissory note / personal guaranty | ❌ |
| Pre-judgment interest CPLR §5001 @ 9% | ✅ |
| Counterclaim-risk model | ✅ |
| Venue determination per CPLR §503 | 🟡 (derived from debtor address, but no override path) |
| Court track determination | ✅ |

### Phase 4 — Demand
| Step | Status |
|---|---|
| Strategy-toned demand letter draft | ✅ |
| Send via certified mail RRR (return receipt requested) | ❌ |
| Email send + open/read tracking | ❌ |
| SMS notice (B2B is largely outside TCPA — fine to use) | ❌ |
| Delivery confirmation captured & filed in case | ❌ |
| Calendared response deadline | ✅ (Filing tab) |
| Automated follow-up cadence (day 7 / 14 / 21) | ❌ |
| Phone outreach log | 🟡 (Timeline tab — manual entry only) |

### Phase 5 — Negotiation & settlement
| Step | Status |
|---|---|
| Stipulation of settlement | ✅ |
| Payment plan agreement | ✅ |
| Acknowledgment of debt (resets SOL per NY GOL §17-101) | 🟡 (mentioned in Payment Plan, not standalone) |
| E-sign for both parties | ❌ |
| Payment rails (Stripe / ACH / wire instructions) for settlement collection | ❌ |
| Confession of judgment (CPLR §3218 — valid against NY residents) | ❌ |
| Default-on-settlement → auto-judgment workflow | 🟡 (acceleration clause in template, but no enforcement trigger) |
| Mediation referral | ❌ |

### Phase 6 — Pre-filing
| Step | Status |
|---|---|
| Pre-filing / final notice | ✅ |
| Re-verify debtor name & address | 🟡 (lookups exist, no enforced re-check) |
| Court & venue selection | ✅ |
| Caption + pleadings draft | ✅ |
| Ad damnum with interest accrued to filing date | ✅ |

### Phase 7 — Filing
| Step | Status |
|---|---|
| Notarize verification (CPLR §3020) | ❌ — template has notary line, no integration with online notary |
| Pay filing fee | ❌ |
| **E-file via NYSCEF** (Supreme Court — mandatory for represented parties) | ❌ |
| **EDDS** (NY Courts Electronic Document Delivery System — Civil pro se path in some courts) | ❌ |
| In-person filing for Commercial Claims | ❌ (instructions only) |
| Index number purchase ($210, Supreme) | ❌ |
| Stamped/conformed copies received | ❌ |
| RJI (Request for Judicial Intervention) within 60 days, Supreme | ❌ |

### Phase 8 — Service of process
| Step | Status |
|---|---|
| Process server selection | ❌ — no marketplace, no preferred vendors |
| **Process server dispatch via API** (ABC Legal, Proof, ServeNow, ProVest) | ❌ |
| Service attempts log | ❌ |
| Affidavit of service template | ✅ |
| Affidavit notarized + filed with court | ❌ |
| 120-day service-window calendar | ✅ |
| Additional mailing under CPLR §3215(g)(3) (required for natural persons) | ❌ |

### Phase 9 — Defendant response
| Step | Status |
|---|---|
| Detect/parse incoming answer | ❌ |
| Analyze affirmative defenses | ❌ |
| Reply to counterclaims | ❌ |
| Motion to dismiss CPLR §3211 | ❌ |
| Demand for bill of particulars | ❌ |
| No answer → calendar default eligibility | ✅ |

### Phase 10 — Discovery (if answered)
| Step | Status |
|---|---|
| Preliminary conference prep | ❌ |
| Document demand CPLR §3120 | ❌ |
| Interrogatories CPLR §3130 | ❌ |
| Notice to admit CPLR §3123 | ❌ |
| Subpoena duces tecum | ❌ |
| Deposition notices CPLR §3107 | ❌ |
| Note of issue / certificate of readiness | ❌ |
| **Summary judgment CPLR §3212** (kills most B2B collection cases — biggest leverage point) | ❌ |

### Phase 11 — Default judgment (CPLR §3215)
| Step | Status |
|---|---|
| Notice of motion | ✅ |
| Affidavit of facts / merit | ✅ |
| **Affidavit of non-military service** (SCRA 50 USC §3931) — required for individual defendants | ❌ |
| Additional-mailing affidavit CPLR §3215(g)(3) | ❌ |
| Proposed judgment with itemized damages | ✅ |
| Within 1-year window per CPLR §3215(c) (else dismissed for failure to prosecute) | ❌ — no calendar enforcement |
| File with clerk → judge signs | ❌ |

### Phase 12 — Post-judgment enforcement *(this is where money actually moves)*
| Step | Status |
|---|---|
| Docket judgment with County Clerk | ❌ |
| **Transcript of judgment** (extends lien to other counties) | ❌ |
| **Information subpoena CPLR §5224** (questions to debtor + banks/employers/customers — the workhorse) | ❌ |
| **Restraining notice CPLR §5222** (immediate 1-year freeze on bank accounts) | ❌ |
| **Property execution CPLR §5230** (marshal/sheriff levy) | ❌ |
| **Income execution CPLR §5231** (10% wage garnishment, individuals) | ❌ |
| Real-property judgment lien (auto on docketing in same county) | 🟡 (informational only) |
| **City marshal dispatch** (NYC has 30 marshals; no integration) | ❌ |
| Sheriff dispatch (outside NYC) | ❌ |
| Turnover proceeding CPLR §5225 | ❌ |
| Charging order against LLC interests | ❌ |
| Judgment renewal at 10/20 years CPLR §211(b) | ❌ |
| Interest accrual tracker post-judgment | ❌ |

### Phase 13 — Case close
| Step | Status |
|---|---|
| Satisfaction of judgment filing | ❌ |
| 1099-C if debt is forgiven | ❌ |
| Final accounting to client | ❌ |

**Overall coverage of the lawyer's job: ~35–40%.** The product nails drafting and analysis (the lawyer's "thinking" work) but skips almost all of the doing — sending, signing, filing, serving, collecting. Those omissions are also where the lawyer makes most of their hourly money.

---

## 3. The 12 Highest-Leverage Gaps (prioritized)

Ranked by `(impact on user × frequency × ease of integration)`. If we close the top 6, the product replaces ~80% of the lawyer's job.

| # | Gap | Why it matters | Integration |
|---|---|---|---|
| 1 | **Certified mail / email send** for demand & final notice | Nothing happens until something is sent. This is the first thing a lawyer does. | **Lob.com** API for certified mail RRR; **Resend** or **Postmark** for tracked email |
| 2 | **E-signature** for settlement / payment plan / engagement letter | An unsigned settlement is worthless. | **Dropbox Sign** or **DocuSign** API |
| 3 | **Stripe escrow / ACH** for settlement collection | This is how Reclaim makes money (15% on collected). Also auto-triggers SOL reset and case close. | **Stripe Connect** + Treasury for escrow; **Plaid** for ACH |
| 4 | **Online notary** for affidavits, verifications, info subpoenas | Unblocks every notarized document. | **Proof (Notarize.com)** or **BlueNotary** API |
| 5 | **Process server dispatch** | Currently the user has to find their own server. | **ABC Legal** has an API; **Proof.com** has an API and covers all 50 states |
| 6 | **Restraining notice + info subpoena generator** | The actual collection tools. Without these, winning a judgment does nothing. | Pure document generation + serve via #1 + #5 |
| 7 | **NYSCEF e-filing** for Supreme Court | Mandatory for represented parties; massive friction without it. | NYSCEF has no public API but accepts PDF/A uploads via web; partner with a registered e-filer (e.g. **InfoTrack**, **One Legal**, **File & ServeXpress**) |
| 8 | **Affidavit of non-military service** + CPLR §3215(g)(3) additional-mailing affidavit | Default judgments against individuals get rejected without these. | DOD SCRA portal lookup (free) + template |
| 9 | **Defendant response portal** | Lets debtor pay/dispute/propose without a phone call. Massive deflection. | Build internally; magic-link auth |
| 10 | **Auto follow-up cadence** | Day 0 demand → day 7 reminder → day 14 final notice → day 21 file. | Background job scheduler |
| 11 | **Marshal/sheriff dispatch** for executions | Last mile of post-judgment enforcement. | NYC marshals are individual private contractors — start with white-glove handoff, automate later |
| 12 | **Judgment interest tracker + renewal alerts** | A judgment compounds at 9%; renewal at 10 years is mission-critical. | Pure compute job |

---

## 4. Product Roadmap

Three phases. Each one independently ships value.

### Phase A — "Send, sign, collect" (4–6 weeks)
The product becomes useful end-to-end without any court involvement.

1. Lob certified mail integration (demand + pre-filing notice)
2. Resend tracked email (with branded sender domain per claimant)
3. Dropbox Sign for settlement + payment plan
4. Stripe Connect escrow for settlement payment collection
5. **Reclaim's first revenue line:** flat % of collected funds via Stripe (10–15%)
6. Auto follow-up scheduler

After Phase A: ~60% of cases never go to court. They settle on the demand letter or the pre-filing notice. Reclaim captures revenue on every one. **This is the MVP-revenue moment.**

### Phase B — "File, serve, default" (6–10 weeks)
The court track stops being a paper hand-off.

7. Proof.com process-server dispatch
8. Online notary (Proof) for affidavits & verifications
9. Affidavit of non-military service + §3215(g)(3) mailing
10. Partner with InfoTrack or One Legal for NYSCEF e-filing (Supreme) — or build direct submitter
11. Index-number purchase via the same partner
12. EDDS upload for Civil pro se (manual at first; doc bundle prepared)
13. Default judgment auto-trigger when answer deadline passes with no answer
14. Defendant response portal (magic link for the debtor — view claim, dispute, propose payment, pay)

After Phase B: Reclaim handles a contested-but-defaulted case from intake to judgment without the user leaving the app.

### Phase C — "Enforce" (6–10 weeks)
The hard part of collections. This is what most online collection tools quit before.

15. Information subpoena CPLR §5224 generator + serve
16. Restraining notice CPLR §5222 generator + serve to bank(s) identified from research
17. Property execution + income execution document generators
18. Transcript of judgment + multi-county docketing
19. NYC marshal directory with 1-click handoff packet (initially manual; integrate as relationships develop)
20. Post-judgment interest tracker (running balance with daily accrual)
21. Judgment renewal alerts at year 9 and year 19

After Phase C: Reclaim does almost everything a $400/hr collections lawyer does, end-to-end, except appearing at the rare contested hearing.

### Continuously
- Engagement letter / conflict check workflow (Phase A)
- Tax warrant search (NY DTF) and DCWP licenses (Phase B)
- D&B / Experian Business credit (Phase B)
- Discovery doc generator pack — interrogatories, notice to admit, doc demand (Phase C, used rarely but huge for credibility)
- Summary judgment motion package (Phase C, defining feature)

---

## 5. Business Plan

### What the product is, in one sentence
**The fastest way for a NY business to collect on an unpaid invoice — from demand letter to bank levy — without hiring a collections lawyer or write-off-by-default.**

### Market & ICP

Three concentric circles, biggest opportunity is the middle one:

| Segment | Claim size | Today's options | Reclaim's wedge |
|---|---|---|---|
| Sub-$10k unpaid invoices | < $10k | Write off — too small for a lawyer | "We collect on the invoices you were going to give up on" |
| **$10k–$100k unpaid invoices (PRIMARY)** | $10k–$100k | Pay a collections lawyer 25–40% contingency | "Same outcome at 10–15%, with full transparency" |
| Mid-market ($100k+) | > $100k | In-house counsel + outside firm | "Document automation for your AR or legal team" — different sale, later |

**Best ICP for the first 100 customers:**
- Small NY-based service business with high AR exposure: **creative agencies, dev shops, marketing firms, B2B SaaS, fractional CFO/CMO/CPO firms, contractors (GC/sub), commercial cleaning, IT MSPs, consulting, design studios, A/V production.**
- 5–50 employees, $1M–$20M revenue
- Has 1–5 unpaid invoices/year over $5k
- Already pissed off about it
- Currently writing them off or sending sad reminder emails

These businesses have one full-time AR person at most, no in-house counsel, and don't want to retain a $400/hr lawyer for a $25k invoice.

### Pricing

**Hybrid: low subscription floor + outcome-based take rate.**

- **Free tier:** Run intake, see the AI strategy assessment, generate a demand letter (HTML preview only — no send). This is the trojan horse.
- **Pro: $79/mo per company** — unlimited cases, send certified mail, send email, e-sign, debtor portal, follow-up cadence.
- **Recovery fee: 12% of any amount collected via the platform.** (Lawyers charge 25–40%. Reclaim is half.)
- **Filing-fee passthrough:** Real costs (court filing fees, process server, certified mail, notary) pass through at cost + 10% handling.
- **Supreme Court / contested cases:** Reclaim refers to a partner attorney network and takes a 20% referral fee. (The platform stays useful; the human stays in charge of the courtroom.)

**Why this works:**
- $79/mo is below the threshold where buyers hesitate.
- 12% beats the lawyer comparison without question.
- Recovery fee aligns Reclaim's incentives with the user's. Eliminates "did this letter actually work?" anxiety.
- Filing fees pass through transparently — no hidden margin on legal procedure.
- The product makes money on every case that resolves *before* court (which is most of them), and a bigger chunk on cases that go all the way through enforcement.

### Unit economics (rough)

Average case: $35k claim, 65% net recovery rate (~$23k collected).
- Subscription contribution: $79/mo × 6 months = $474
- Recovery fee: 12% × $23k = $2,760
- **Per-case revenue: ~$3,200**
- Variable cost (Stripe + Lob + e-sign + notary + LLM): ~$80
- Customer acquisition (target): $400 blended
- Payback: first resolved case

A user with 4 cases/year LTVs at ~$13k. CAC < $500. The math works.

### UPL & legal positioning

Reclaim is **software the user operates pro se** — not a law firm and not legal services. This is the same posture as LegalZoom, RocketLawyer, and Atticus. Critical guardrails:

- No "legal advice" — the AI gives strategic *information* with disclaimers
- Every generated document is the user's document, signed by the user
- Network attorneys for actual representation are referred, not employed
- Engagement language: *"You are representing yourself. Reclaim is your tool, not your lawyer."*
- Refer up at $50k+ or at any contested response
- Maintain PII / matter-confidentiality posture even though no privilege attaches

NY allows pro se in all courts; Commercial Claims Court is explicitly designed for it. This works.

### Competitive landscape

| Competitor | What they do | Why Reclaim wins |
|---|---|---|
| Collections law firms (e.g. Mandelbaum Barrett, NY collections boutiques) | 25–40% contingency, full service | Half the price, transparent, faster, you keep control |
| **Hunter Warfield, IC System, Caine & Weiner** (traditional collection agencies) | Phone + letter campaigns, 30–50% contingency | Doesn't go to court; Reclaim does |
| **TrueAccord, Attain, InDebted** | Consumer-debt focused, automated outreach | B2C; Reclaim is B2B |
| **GetPaid, Upflow, Receeve, Tesorio** | AR automation (dunning, reminders) | Stops at the unpaid invoice; doesn't go to court or collect |
| **LegalZoom / Rocket Lawyer / Atticus** | General legal docs | Generic; Reclaim is specialized end-to-end on NY collections |
| **Hello Divorce, Better Legal, etc.** | Vertical legal SaaS in other domains | Proves the model; collections is bigger |
| **DoNotPay** | Consumer disputes | Toy; not a real B2B collections workflow |

**The wedge:** No one combines (a) NY-state-specific procedural depth with (b) end-to-end execution from demand → enforcement with (c) outcome-aligned pricing. Every existing player picks one or two of those.

---

## 6. Go-to-Market Plan

### Positioning (one line, by audience)

| Audience | Hook |
|---|---|
| Creative agency founders | *"The unpaid invoice you were going to write off? We collect it for 12%."* |
| Bookkeepers & fractional CFOs | *"When AR aging hits 90 days, we take it from there."* |
| GC / construction subs | *"NY mechanic's lien + collections, on autopilot."* (later, when we add lien filings) |
| AR managers in mid-market | *"Stop sending it to outside counsel. Run it in here, escalate only what survives."* |

### Channels (ranked)

1. **Direct outbound to the ICP.** Pull a list of NY creative/dev/marketing agencies with 10–50 employees from Apollo / Clay; first-touch is *"What do you do with invoices that go past 90 days?"* This is a 1-on-1 sales motion for the first 50 customers. CAC: $200–$500.

2. **Bookkeeper / fractional-CFO partnerships.** Bookkeepers see AR aging before the founder does and they have repeat exposure. Offer 15% rev-share on referred collections. Bookkeepers refer because it makes them look effective ("I solve unpaid invoices").

3. **QuickBooks App Store + Xero marketplace.** Once we have an integration that auto-imports invoices over 60 days. Single biggest organic-distribution lever for SMB SaaS in this space.

4. **SEO playbook.** Build out long-tail content: *"How to collect on an unpaid invoice in NY"*, *"NYC Commercial Claims Court guide"*, *"Suing an LLC in NY"*, *"Information subpoena vs restraining notice"*. The user-intent here converts insanely well. We have the legal accuracy in the product already — extract it into 100 SEO pages.

5. **Industry communities.** AIGA (designers), AAAA & 4A's (advertising), Freelancers Union, ASMP, Software NY, NYTech meetups. *"For when a client doesn't pay."*

6. **Paid: Meta + Google.** Search ads on `small claims court NY`, `B2B collections lawyer NYC`, `unpaid invoice attorney`. Meta retargets. Don't lead here — lead with content + outbound. Use paid to scale once unit economics are confirmed.

7. **White-label for SMB law firms.** Sell Reclaim as a productivity layer to small NY collections practices. They use it internally; their clients see "Powered by Reclaim." Generates recurring revenue + brings in cases.

8. **PR angle.** Press loves "AI replaces lawyers" stories. We have a real, defensible version of that. Pitch The Information, Bloomberg Law, Above the Law, PYMNTS.

### Launch sequence

1. **Weeks 1–6 (Phase A shipping):** No public launch. Manual onboarding of 10 friendly NY agencies / consulting firms. White-glove their first case end-to-end. Document everything.
2. **Weeks 7–10:** Public landing page + Show HN + ProductHunt. Lead with *"We collected $X for our first 10 customers in 30 days."* Real numbers only.
3. **Weeks 11–20 (Phase B shipping):** Direct outbound + partnership work. Target: 50 paying customers, $50k MRR + recovery fees.
4. **Q3+:** Phase C ships → enforcement use cases → Reclaim is the only platform in the category that sees a case through to bank levy.

---

## 7. What I Would Build First

**A 3-week sprint that closes the single biggest credibility gap and unlocks revenue:**

1. **Lob certified mail send for the demand letter.** Click "Send" → Lob mails it → tracking number stored in the case → delivery confirmation auto-attached. *(2–3 days dev.)*
2. **Resend tracked email send for the demand letter.** Branded sender domain per claimant. Open + click tracking. Auto-action log. *(1–2 days dev.)*
3. **Stripe Connect escrow.** Debtor pays via a magic link → funds settle into Reclaim's Connect account → Reclaim takes 12% → balance ACHs to the user. *(4–5 days dev + Stripe onboarding.)*
4. **Dropbox Sign for settlement + payment plan.** *(2 days dev.)*
5. **Debtor magic-link portal.** A page where the debtor can: see the claim, view the demand letter, dispute/respond in writing (logged), or pay. *(3 days dev.)*

That's it. After 3 weeks the product handles money in and out, captures Reclaim's first revenue, and proves the thesis on real cases. Everything else can follow.

---

## 8. Open Questions for the Founder

1. Are we comfortable being NY-only for the first 12 months, or do we want to broadly architect for multi-state from day 1? (My take: NY-only. Depth > breadth. Add NJ + CA second.)
2. Do we want to build the attorney-referral side (Phase B+) as our own marketplace, or partner with an existing one (e.g. UpCounsel)? (My take: marketplace ourselves. Margin is too good to give up.)
3. Are we OK with the UPL posture — i.e. always pro se, never representing? (My take: yes. It's the entire reason this is a venture-scale software business and not a 50-person law firm.)
4. Do we want to capture the consumer-debt market eventually, or stay strictly B2B? (My take: stay strictly B2B. FDCPA exposure on consumer-debt collection is a different regulatory regime and would slow us down.)
5. Do we want to pursue NYC marshals as channel partners (referral fees from them on every levy we send) or treat them as commodity vendors? (My take: channel partners — there are only ~30, the relationships compound, and they will refer cases back the other way.)
