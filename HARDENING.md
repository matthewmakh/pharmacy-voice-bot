# Hardening Handoff — Closing the Lawyer-Judgment Gap

**Status:** This branch is intentionally empty except for this doc. The next session should read this top-to-bottom, pick a chunk, and build it on a sub-branch off `main`.

**Why this doc exists.** We just finished Phase A (send / sign / collect) and Phase B (file / serve / hand-off). The product is now a competent **paralegal with excellent filing infrastructure**. It is not yet imitating the **lawyer's judgment layer** — collectibility scoring, leverage mapping, evidence extraction, pressure tactics, fallback theories. That's the gap this branch is meant to close.

---

## 1. The lawyer's process (the bar we're trying to clear)

A real B2B collections attorney walks every new matter through this sequence. The earlier steps are the ones that *separate* a lawyer from a paralegal. Most of what makes a lawyer worth their hourly rate happens in **Step 0–3**.

### Step 0 — Silent reality check (before anything is said out loud)

The attorney is asking themselves four questions:

1. **Is this collectible?** Does the defendant actually have money or seizable assets?
2. **Is there proof of obligation?** A signed contract, invoices, paid-on-account history, written admissions?
3. **Is the amount worth litigating?** Time-cost vs. recovery probability.
4. **Is liability clear or arguable?** Strong elements of breach vs. messy facts, counterclaim risk, statute of limitations clock.

If any of these are weak, **the entire strategy changes** — they shift from aggressive to strategic-pressure, or refuse the case.

### Step 1 — Structured intake (not a story; an evidence checklist)

The attorney asks for **structured evidence**, not a narrative:

| Bucket | What they want |
|---|---|
| Parties & identity | Legal name, individual owner, business structure, address, **guarantors** (the lawyer flags this as "HUGE if you have it") |
| Contractual basis | Signed contract, terms (payment / scope / IP / termination / late fees / **attorney-fee clause**) — and if no contract, then offer-acceptance-consideration via emails/texts |
| Proof of performance | Deliverables, screenshots, deployment records, system access logs, ack messages |
| Payment history | Invoices issued, payments made, dates, outstanding balance calc |
| Breach evidence | Refusal/delay/excuse messages — and especially **debt admissions** ("we'll pay you later", "we're waiting on X") |
| Damages calculation | Total + interest + ongoing damages (if subscription or continued use) |
| Current situation | **Are they still using your system? Have you cut access? Are they ignoring you or actively disputing?** |

### Step 2 — Legal positioning

The attorney decides:

**Cause of action hierarchy** (try in this order, fall back as needed):
1. **Breach of contract** — best case
2. **Account stated** — invoices accepted but unpaid
3. **Unjust enrichment** — fallback if no contract

**Leverage level:**
- Strong contract + proof of use → aggressive (sue first, settle later)
- Weak contract → strategic pressure first, lawsuit only if needed

### Step 3 — Pre-litigation strategy (this is where most money is recovered)

A *real* demand letter includes:
- Legal claims (cited)
- Timeline of events
- Exact amount owed
- Deadline (7–14 days)
- Threat of: lawsuit, attorney fees, interest, additional claims
- Tone: not emotional, not begging, controlled and confident

**Strategic pressure** beyond the demand letter:
- Notify them continued use = willful infringement (if applicable)
- Mention personal liability if structure allows (LLC piercing, sole prop)
- Signal litigation readiness (without bluffing)
- Sometimes contact partners/vendors (carefully, legally)
- Reputation pressure (must be done correctly)

**Settlement window** — most cases resolve here:
- Lump sum discount (70–90%)
- Payment plan
- **Confession of judgment** (very powerful — debtor pre-signs a judgment that's filed only on default)

### Steps 4–8 — Litigation, discovery, pre-trial, trial, enforcement

(See detailed transcript in `IMPLEMENTATION_NOTES.md` once the merge lands.)

The product currently covers Steps 4 (filing), 7 (handoff at trial), and 8 (post-judgment doc generation for handoff package) reasonably well. The judgment layer is in **Steps 0–3**.

### Step 9 — Advanced leverage

A senior attorney also considers:
- **Piercing the corporate veil** — go after owner personally if undercapitalized / commingled / fraud
- **Fraud claims** — if they never intended to pay
- **Conversion / IP misuse**
- **Injunctions** — force them to stop using the system

### What the lawyer says people get wrong
- Rely on verbal agreements
- Don't document performance
- **Wait too long** (statute of limitations)
- Don't apply pressure correctly
- Think "winning = getting paid"

---

## 2. Where we are right now (score card)

Current product graded against the lawyer's framework:

| Step | Lawyer does | We do | Grade |
|---|---|---|---|
| 0. Silent reality check | Go/no-go judgment on collectibility, proof, amount, clarity | Run 6-source investigation (ACRIS, NYS Entity, UCC, ECB, court history, PACER); never synthesize into a decision | **6/10** |
| 1. Intake | 7 categories incl. **guarantors** + **attorney-fee clause** + ongoing-use status | Capture basics; miss guarantors, attorney-fee flag, IP terms, "still using" | **5/10** |
| 2. Legal positioning | Hierarchy: breach → account stated → unjust enrichment, with leverage map | Default to breach of contract; no fallback theory; no leverage classification | **3/10** |
| 3. Pre-litigation | Demand letter + **pressure tactics** + settlement window incl. **COJ** | Demand letter ✓, settlement + payment plan ✓, no pressure tactics, no COJ | **6/10** |
| 4. Litigation path | Court routing, filing, response branches | Court form gen + 3 filing paths + default judgment + answer-deadline calc | **9/10** |
| 5. Discovery | Interrogatories, requests for docs, depositions | Document upload + AI extraction; no formal discovery; doesn't surface "use admissions" | **2/10** |
| 6. Pre-trial settlement pressure | Cost-rising / risk-real pressure on both sides | Defendant portal helps; no formal pressure mechanism | **3/10** |
| 7. Trial | Out of scope (handed to attorney) | — | N/A |
| 8. Enforcement | Levies, garnishment, liens | Generate all post-judgment docs as handoff package | **7/10** |
| 9. Advanced leverage | Veil piercing, fraud, conversion, injunctions | Nothing | **1/10** |

**Overall: ~5–6 out of 10.** We're a better-than-average paralegal. We're not a lawyer.

---

## 3. The 10 specific gaps (numbered, prioritized)

In rough order of value-per-day-of-effort:

### 🔴 P0 — High value, high feasibility

**Gap 1: Collectibility score**
- **What's missing:** We surface raw investigation data. We never tell the user "this is an 8/10 collectibility, file aggressively" or "this is a 2/10, walk away."
- **Why it matters:** The lawyer's silent Step 0. Wrong-headed cases waste user time and our infrastructure.
- **Where to build:** Server-side after `synthesizeCase` runs. Add a `collectibilityScore` (1-10) + `collectibilityReasoning` (string) to the Case schema. Compute by feeding investigations + intake into a Claude prompt with a strict scoring rubric.
- **Inputs to score on:** ACRIS holdings (real estate equity), NYS Entity status (active vs. dissolved), UCC liens (existing creditors competing for assets), ECB violations (cash flow signal), court history (litigation pattern, prior judgments), PACER bankruptcy, payment history pattern, written contract presence, guarantors.
- **Output:** Score + 3-5 reasoning bullets + recommended action ("Aggressive filing" / "Strategic pressure" / "Don't pursue").
- **UI:** Big card at top of case detail. Show only after analysis runs. Color-coded badge.

**Gap 2: Intake hardening**
- **What's missing:** No `guarantors` field, no `attorneyFeeClause` flag, no `stillUsingService` boolean, no `accessRevokedAt` date, no separate `ongoingDamages` field, no statute-of-limitations countdown.
- **Why it matters:** Every one of these is a leverage point a lawyer asks about on the first call. Missing them means we draft a weaker demand letter.
- **Where to build:**
  - Schema: add fields to `Case` (`guarantors` JSON array, `attorneyFeeClauseInContract` Boolean, `stillUsingService` Boolean, `accessRevokedAt` DateTime?, `ongoingDamagesPerMonth` Decimal?, `claimAccrualDate` DateTime?, `statuteOfLimitationsExpiresAt` DateTime?)
  - Frontend: extend `NewCase.tsx` intake wizard with a new "Leverage points" step.
  - Backend: enrich `synthesizeCase` and `generateDemandLetter` prompts to use these signals.
- **Statute of limitations clock:** NY breach of written contract = 6 years from breach (CPLR §213); breach of oral contract = 6 years; account stated = 6 years; goods sold UCC = 4 years. Compute `statuteOfLimitationsExpiresAt` from `claimAccrualDate` + appropriate window. Show a banner on the case if <12 months remain. Block default-judgment / filing flows if expired.

**Gap 3: Debt-admission extractor**
- **What's missing:** Users upload emails/texts as documents. Claude extracts facts but doesn't pull out the *single best* debt-admission quote. The lawyer specifically asks for this.
- **Why it matters:** "We'll pay you later" or "we're waiting on funding" is a written acknowledgment of debt — the line that wins the case at summary judgment.
- **Where to build:**
  - New service function `extractDebtAdmissions(documents)` in `claude.ts`. Takes uploaded doc text, returns ranked list of admission quotes with source doc ID, date, and sender attribution.
  - Schema: `debtAdmissions` JSON array on Case.
  - UI: "Strongest debt admission" card on case overview. Quote + sender + date + source doc link. Auto-pulled into demand letter and default judgment.
- **Bonus:** Same extractor can pull *use admissions* (defendant referenced using the system) → feeds the willful-infringement pressure tactic.

### 🟡 P1 — High value, more effort

**Gap 4: Leverage map / case-strategy classifier**
- **What's missing:** We classify cases by *amount* (court track) but not by *leverage strength*.
- **Why it matters:** Determines whether we draft an aggressive demand letter or a strategic-pressure one.
- **Spec:**
  - Compute `leverageProfile`: `{ contractStrength: 'strong'|'medium'|'weak', proofOfPerformance: 'strong'|'medium'|'weak', collectibility: 1-10, counterclaimRisk: 'low'|'medium'|'high', recommendedPosture: 'aggressive'|'strategic'|'cautious' }`
  - Drives demand-letter tone, settlement-discount range (70-90% of full vs 90-100%), and whether to include attorney-fee clause threat.

**Gap 5: Confession of judgment (COJ)**
- **What's missing:** We have settlement and payment plan. Not COJ.
- **Why it matters:** Lawyer calls this "very powerful." A debtor pre-signs a judgment that's only filed if they default on the payment plan. Shortcuts months of litigation if they break the plan.
- **Where to build:**
  - New AI doc generator `generateConfessionOfJudgment` in `claude.ts`. NY-specific (CPLR §3218): must be signed, notarized, AND include the affidavit of confession with: amount, court, residence, and stated facts authorizing entry of judgment.
  - **Critical compliance note:** NY restricts COJs against out-of-state debtors after the 2019 reform. Only valid against NY-resident defendants. Must include the statutory recitations or it's void.
  - Schema: `confessionOfJudgmentHtml`, `confessionSignedAt`, `confessionFiledAt`.
  - UI: panel in Settlement track. Pair with payment plan: "Sign payment plan + COJ together."

**Gap 6: Account-stated and unjust-enrichment fallback claims**
- **What's missing:** Demand letter assumes breach of written contract. If the user has no contract, we should generate based on account-stated theory (invoices accepted without timely objection).
- **Why it matters:** Users without signed contracts are still collectible. We currently leave them weaker.
- **Where to build:**
  - Branch on `hasWrittenContract` and presence of unobjected invoices → switch demand-letter prompt to account-stated framing.
  - Add `causeOfAction` to Case: `'breach_written'|'breach_oral'|'account_stated'|'unjust_enrichment'`.
  - Tie to leverage map (weak case theory → strategic-pressure posture).

**Gap 7: Pressure-tactic library**
- **What's missing:** Lawyer's playbook of "things you can threaten" — willful infringement notice, personal-liability flag, vendor/partner notification, reputation pressure.
- **Why it matters:** The settlement window opens wider when the debtor sees more risk.
- **Where to build:**
  - For each tactic, a generator + an AI advisor that says "applicable to this case" / "not applicable / risky / unethical here."
  - **Willful-infringement notice:** if `stillUsingService === true`, generate a cease-and-desist that calls out continued use as willful infringement. Often more effective than the demand letter.
  - **Personal-liability flag:** if the entity is a sole prop, single-member LLC with no operating agreement, or recently dissolved, flag the owner as potentially personally liable. Increases pressure dramatically.
  - **Vendor/partner notification:** generate template letters to the debtor's known vendors / suppliers / customers. **Use carefully** — this can cross into tortious interference if done wrong. Must include legal disclaimers.

### 🟢 P2 — Important but lower urgency

**Gap 8: Statute-of-limitations watchdog**
- **What's missing:** No clock on when the user must file by.
- **Why it matters:** Lawyer's blind-spot list says "they wait too long." Our follow-up cadence runs forever; it should escalate before the SOL expires.
- **Where to build:** Computed field on Case (NY: 6 years from breach for written contract). Banner if < 12 months. Auto-prompt "file now" if < 90 days. Block enrollment in long payment plans that would push past SOL without a tolling agreement.
- **Tolling agreements:** add a generator for these too — debtor's voluntary extension of the SOL clock.

**Gap 9: Continued-use detection from documents**
- **What's missing:** We never ask "are they still using your system?" The lawyer treats this as a leverage point because it = ongoing damages + possible willful infringement claims.
- **Where to build:**
  - Question on intake (boolean + "if yes, last access date").
  - Optional: AI scans uploaded server logs / access exports / screenshots for evidence of continued use after the demand letter dated. Surface a card "Defendant accessed system on [date] AFTER your demand letter — willful." This is a major pressure point.

**Gap 10: Discovery-light**
- **What's missing:** No interrogatories or request-for-production generators.
- **Why it matters:** Out of scope for our pre-trial-only product, BUT some of these (particularly the post-judgment information subpoena which we already do) overlap with discovery. Could expand to draft pre-trial discovery templates as part of the attorney handoff package — makes us more valuable to the partner attorney.

---

## 4. Recommended build order (4-week roadmap)

### Week 1 — P0 trio
- **Day 1-2:** Gap 2 (intake hardening) — schema fields, `NewCase.tsx` step, prompt updates
- **Day 3-4:** Gap 3 (debt-admission extractor) — service function, schema, overview card
- **Day 5:** Gap 1 (collectibility score) — service function, schema, big card on case detail

### Week 2 — Bind it together
- **Day 1-2:** Gap 4 (leverage map / classifier) — depends on gaps 1+2+3 having data
- **Day 3-4:** Gap 6 (account-stated / unjust-enrichment fallback) — branches the demand-letter prompt
- **Day 5:** Update `generateDemandLetter` to consume `leverageProfile` + `causeOfAction` + `debtAdmissions`

### Week 3 — Power tools
- **Day 1-2:** Gap 5 (confession of judgment) — AI doc + NY compliance + UI panel
- **Day 3-5:** Gap 7 (pressure-tactic library — start with willful-infringement notice + personal-liability flag; defer vendor notification)

### Week 4 — Watchdogs
- **Day 1-2:** Gap 8 (SOL watchdog) — clock + banner + auto-prompts
- **Day 3-4:** Gap 9 (continued-use detection) — intake field + optional log scanner
- **Day 5:** Buffer for testing + polish

That gets us to a **lawyer-grade 8/10** by end of week 4 (vs. current 5–6/10).

---

## 5. Architecture notes for the next agent

### Where things live now (post Phase A + B merge)
- **Backend AI generators:** `server/src/services/claude.ts` (mostly), plus `server/src/services/postJudgmentDocs.ts` for the lawyer-handoff bundle
- **Vendor wrappers:** `server/src/services/{lob,resend,dropboxSign,stripe,proof,infoTrack}.ts`
- **Routes:** `server/src/routes/{cases,portal,attorney,handoff,payouts,webhooks,walkthrough}.ts`
- **Frontend escalation panels:** `client/src/pages/case-detail/escalation/*Panel.tsx`
- **Public partner-attorney portal:** `client/src/pages/AttorneyPortal.tsx` at `/attorney/:token`
- **Public debtor portal:** `client/src/pages/DebtorPortal.tsx` at `/respond/:token`
- **Public DIY filing wizard:** `client/src/pages/WalkthroughPage.tsx` at `/cases/:id/walkthrough`

### Pattern to follow for new AI generators
1. Add function to `claude.ts` (or new file if it grows): `generateXxx(caseData) → { text, html }`
2. Add HTML field on `Case` in `schema.prisma`
3. Add route `POST /api/cases/:id/generate-xxx` in `cases.ts`
4. Add API client method in `client/src/lib/api.ts`
5. Add panel in `client/src/pages/case-detail/escalation/` or similar
6. Wire into `EscalationTab.tsx`
7. Surface in attorney handoff package (`routes/handoff.ts` `getHandoffPackage` and `routes/attorney.ts` `DOC_FIELDS` map)

### Pattern for new intake fields
1. Add column to `User` or `Case` in `schema.prisma`
2. `npx prisma generate` to update Prisma client types
3. Update zod `createCaseSchema` and `updateCaseSchema` in `routes/cases.ts`
4. Add to `Case` type in `client/src/types/index.ts`
5. Add input to `NewCase.tsx` step (likely a new step for "leverage points")
6. Update demand-letter / synthesis prompts in `claude.ts` to consume the new field
7. **Run `npx prisma db push` against the dev DB** — schema changes are dev-grade until we add real migrations (separate hardening task)

### Pattern for new score / classifier
1. New service function in `claude.ts`. Tight prompt with explicit rubric (don't ask Claude to "score this generally" — give specific criteria).
2. Cache the result on the case (`collectibilityScore`, `collectibilityScoredAt`) so we don't re-charge tokens on every page load.
3. Recompute when `synthesizeCase` runs OR when intake fields change OR on user request via "Re-score" button.

---

## 6. Open questions for the user (to ask at session kickoff)

1. **Score visibility:** show collectibility score to user as a number (8/10) or as a label (Strong / Moderate / Weak)? Numbers feel medical; labels feel marketing. Probably labels with hover for the number.
2. **Refusing cases:** if a case scores 1-2/10 collectibility, should the product *block* the user from sending a demand letter, or just warn? Lawyer would refuse the case entirely. We probably warn + require user override.
3. **Confession of judgment scope:** NY-only or do we plan to support other states? COJ rules differ a lot — Delaware has the most permissive ones, California has banned them entirely, NY restricts to in-state defendants.
4. **Pressure tactics ethics:** vendor notification can cross into tortious interference. Do we ship this with mandatory legal review, or build the templates and require attorney handoff for actual sending?
5. **Statute of limitations fork:** when SOL is < 90 days, do we *force* file via InfoTrack, or let user pick DIY/handoff with a big warning?

---

## 7. What this branch needs to do next

1. **Merge `dev` into your local view** before you start. Phase A and B are on `dev`. The current `main` does NOT yet have them — that's pending the user's manual main reset.
2. **Pick ONE gap** to start. Recommend Gap 2 (intake hardening) because every other gap depends on it having more data. Then Gap 3 (debt admissions). Then Gap 1 (collectibility score) which depends on Gaps 2+3.
3. **Build on a sub-branch** off `main` (after the user resets it to include Phase A+B). Name it after the gap, e.g. `hardening-intake`, `hardening-collectibility`.
4. **Ship one gap end-to-end** before starting the next: schema → backend → AI prompt → frontend → manual smoke test.
5. **Update this doc** as you go — strike out gaps you've completed, add open questions you find.

---

## 8. Pre-existing Claude branches with potentially uncovered work

When the merge happened, two pre-existing `claude/*` branches were left untouched:
- `claude/collections-platform-mvp-J862j` — has background-processing improvements, settlement formatting fixes, schema migration for `analysisError` column. Worth grepping for things we don't have on `main` yet.
- `claude/refresh-frontend-design-wW79w` — has rate-limit retry-storm hardening, **auto-fill new-case intake from uploaded documents** (this one might be valuable for Gap 2!), backend UX fixes.

Spend ~30 min before starting Gap 2 looking at `auto-fill new-case intake from uploaded documents` on `claude/refresh-frontend-design-wW79w`. It might be 50% of Gap 2 already done.

```bash
git diff origin/main..origin/claude/refresh-frontend-design-wW79w -- client/src/pages/NewCase.tsx
```

---

## 9. One more thing — context from the lawyer transcript

The user pasted a full lawyer-process transcript in our last session. The key one-liner that should drive everything in this branch:

> *"What I Need From You Next: ... Give me: 1. What is the total amount owed? 2. Do you have a signed agreement? 3. Are they still using your system? 4. What payments (if any) were made? 5. What's the strongest message you have where they acknowledge the debt?"*

We capture (1), (2), (4) today. We don't capture (3) or (5). **Those are gaps 9 and 3 above** — and they're literally the first 5 questions a real attorney asks. Building those is closing the gap fastest.

The lawyer also said:

> *"I'll be blunt: They rely on verbal agreements. They don't document performance. They wait too long. They don't apply pressure correctly. They think 'winning' = getting paid. It doesn't."*

Each of those translates directly to a P0 gap above. The product's job is to be a smarter version of the user's gut — that's what a lawyer is.

---

## 10. Done is

- User can run a new case through intake and get a **collectibility verdict + leverage profile** before drafting anything
- Demand letter cites the **strongest debt admission** word-for-word and threatens **attorney fees** when the contract has the clause
- Settlement window can produce a **confession of judgment** alongside payment plan
- Statute-of-limitations clock visible on every case; auto-escalates near expiry
- Score card in §2 above shows **8/10** average across the lawyer's 9 steps

If you can ship that, we're no longer a paralegal. We're imitating the judgment a lawyer charges $400/hr for. That's the actual moat.
