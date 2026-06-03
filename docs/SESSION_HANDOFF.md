# Session handoff — continuing this work in a new chat

Orientation for a new session picking up the Reclaim overhaul. Read this first, then
[`../HANDOFF.md`](../HANDOFF.md) (architecture / route map / data model) and
[`ENGINEERING.md`](./ENGINEERING.md) (conventions + how to extend). The itemized list of
what changed is in [`CHANGELOG.md`](./CHANGELOG.md).

> Tone note for whoever continues: be careful repeating claims as facts. Much of this was
> typechecked, built, unit-tested, and CI-verified, but **not** run against a live database,
> the real Anthropic API, or an actual Railway deploy. The split is spelled out below — treat
> the "not verified" items as things to confirm, not givens.

## Where things stand

- **Branch:** `claude/relaxed-ptolemy-otAGB`. All work is committed and pushed.
- **GitHub Actions CI is green on every pushed commit** (confirmed via the Actions API on the
  latest commits, including the PDF-renderer and apply-answers changes). CI runs `tsc`, build,
  and `vitest` for both `server/` and `client/`.
- A senior-engineer audit drove the overhaul across reliability, security, the AI layer,
  durability/scale, UX, multi-tenancy, tests/CI, documentation, and two deploy fixes (the
  Railway build and the PDF renderer).

## Verification status — confirmed vs. not verified

**Confirmed (actually executed in this environment):**
- `tsc --noEmit` and the production build pass for both `server` and `client`.
- Unit tests pass — `server`: 18 (outstanding-balance math, court-track routing, the ZIP→county
  venue resolver, the deterministic `verifyDocumentFacts`); `client`: 5 (statute-of-limitations
  math, including the acknowledgment/partial-payment reset).
- The server boots: `GET /api/health` returns 200 with the helmet/CSP headers, and the startup
  cleanup + org backfill fail **non-fatally** when no database is reachable.
- PDF rendering: the real `htmlToPDF` (puppeteer-core + `@sparticuz/chromium`) produced a valid
  PDF (`%PDF-` header) when run in this Linux container. This is strong evidence for Railway, but
  it is not the Railway environment itself.
- The Railway build fix: the failure (`tsc` absent under `NODE_ENV=production`) and the fix
  (`npm install --include=dev` restores it) were both reproduced in isolation.
- `prisma generate` succeeds against the current schema (orgs, `organizationId`, `lookupMeta`).

**Not verified — confirm before relying on these:**
- **No live end-to-end run.** Nothing was exercised against a real PostgreSQL DB or the real
  Claude API. So the actual runtime behavior of AI generation/extraction/verification, the new
  intake "apply answers" math, multi-tenant scoping/backfill on Postgres, and the org-invite
  flow is reasoned-about and type-checked, not observed. Confirm on a staging environment.
- **The live Railway deploy succeeding (build + runtime) is expected, not observed here.**
- **Debtor-research scrapers** (ACRIS, NY courts, NYS entity, NYS UCC via 2captcha, NYC ECB,
  PACER) were only changed structurally (made background jobs). Their live behavior, and the
  third-party portals/credentials they depend on, were not exercised. PACER does not paginate
  (first page of results only).
- **S3/R2 storage driver** compiles but was not run against a real bucket. Default is `local`,
  which is **ephemeral on Railway** — set `STORAGE_DRIVER=s3` for production or uploads are lost
  on redeploy.
- **Frontend runtime/UX** was not clicked through in a browser. It builds; the intake
  review panel, tab gating, Team page, etc. are visually unverified.
- **Legal accuracy is not attorney-reviewed.** Statutory citations, court addresses, filing
  fees, the ZIP→county map, SOL/venue logic, and the document prompts are best-effort and must
  be independently verified before anyone relies on them. The product is positioned as
  self-help document preparation, **not legal advice** (there's a disclaimer gate + footer).
- The **deterministic verifier** was tested on synthetic HTML; behavior on real Claude output
  could differ (e.g., unusual formatting affecting the text/amount matching).
- **Prisma `findFirst` with `{ organizationId: { in } }`** is used for reads; writes deliberately
  avoid `{in}` filters via explicit in-scope guards / `deleteMany`. The access-control behavior
  was reasoned through, not run against Postgres — re-confirm if you touch it.

## Design principles we've been working to

Full version in [`ENGINEERING.md`](./ENGINEERING.md). In brief:

1. **Correctness on money, dates, parties, and venue is non-negotiable** — checked in code (and
   unit-tested), not left to the model's judgment.
2. **Case data is ground truth.** Generators draft prose; they don't invent facts.
   `verifyDocumentFacts` enforces that the expected values actually appear in the output.
3. **Anything slow runs in the background** (every Claude call, every scraper) with a status the
   client polls — never a synchronous request that can time out.
4. **Fail loud over silently wrong** — truncation throws; we don't persist a half-written legal
   document behind a "verified" label.
5. **Don't break production data** — schema changes are additive where possible; destructive
   migrations are staged with a backfill (see `migrations/CASE_MODEL_NORMALIZATION.md`).
6. **Be honest about state** — "done" means typechecked + built + tested (+ boot-checked for the
   backend); deferred work is written down with its reason.
7. **AI runs at meaningful state boundaries, not on every keystroke.** The one retained LLM
   "second look" (`reviseDocument`) fires only when a deterministic check finds a real problem.
   The intake "apply answers" pass is **batched and proposes reviewable changes** — never silent.

## Pending / deferred (with the reason)

- **Confirm the live deploy** on Railway — a real build, an actual PDF download, and one AI
  generation against the real API. Highest-value next check.
- **Enable S3/R2 storage** (env vars) — otherwise uploads are ephemeral.
- **`Case` god-object normalization** — deferred because it's a destructive migration; staged
  plan in `migrations/CASE_MODEL_NORMALIZATION.md`.
- **Scraper resilience / PACER pagination** — structural changes done; internals untouched.
- **UPL posture** — a product/legal decision, only partially mitigated in code.
- Secondary audit items (deeper accessibility, optimistic UI updates) remain optional.

## Working agreement for the next change

- Build + run the tests for any package you touch; boot-check backend changes; keep CI green.
- Reuse the established patterns (background job + deterministic check + single revise for AI
  documents; org-scoped access; tool-structured JSON) — don't reintroduce the anti-patterns the
  overhaul removed (LLM-checking-LLM verify loops, synchronous AI routes, `userId`-only scoping).
- Small, themed commits; develop on the feature branch; say plainly what's verified vs. assumed.
