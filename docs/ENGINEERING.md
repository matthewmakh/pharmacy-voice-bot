# Engineering guide — how this codebase is built & what's expected

This is the working agreement for Reclaim: the conventions to match, the patterns to
reuse, and the bar a change has to clear. The audit overhaul (see `CHANGELOG.md`)
established these — keep them consistent.

## Principles (what "good" looks like here)

1. **Correctness on money, dates, parties, and venue is non-negotiable.** This product
   drafts legal documents and computes deadlines. Anything touching `amountOwed`/
   `amountPaid`, the statute of limitations, court routing, or party identity gets a test
   and is checked in code — never left to an LLM's judgment.
2. **The case data is ground truth.** Generators may draft prose; they don't invent facts.
   `verifyDocumentFacts` enforces that the right values actually appear in the output.
3. **Long work runs in the background.** If a request can take more than a few seconds
   (any Claude call, any scraper), it's fire-and-forget with a status the client polls —
   never a synchronous request that can time out.
4. **Fail loud over silently wrong.** A truncated or unparseable AI result throws and
   reverts status; we do not persist half-baked legal documents behind a "verified" label.
5. **Don't break production data.** Schema changes are additive where possible; destructive
   migrations are staged with a backfill and validated (see the deferred-migration doc).
6. **Be honest about state.** "Done" means typechecked, built, tested, and (for backend)
   boot-checked. Deferred work is written down with the reason, not quietly skipped.

## Code style

- **TypeScript, strict.** No new `any`; prefer real types. The `as never` casts on Prisma
  JSON columns are a known wart of the god-object model — don't add more; the normalization
  removes them.
- **Match the surrounding file** — naming, import order, comment density, 2-space indent.
- **Comments explain *why*, not *what*.** Every non-obvious decision in this codebase has a
  one-line rationale above it (look at `storage.ts`, `verify.ts`, `county.ts` for the
  voice). If a reviewer would ask "why is this like this?", answer it inline.
- **Keep modules single-purpose.** Pure logic (`legal.ts`, `county.ts`) stays free of
  Express/Prisma so it's trivially testable. Express types live in middleware/routes.
- **Errors are surfaced, not swallowed.** Use `getErrorMessage(err)` on the client; return
  a real status + message on the server. A bare `catch {}` needs a comment justifying it.

## Patterns to reuse (don't reinvent)

- **A new AI document type:** add a `generate*` in `claude.ts` using `generateHTML`
  (raw HTML) or `generateJSON` (structured) — both cache the system block and guard
  truncation. Add its `DocKind` to `verify.ts` and let `verifyDocumentFacts` /
  `reviseDocument` handle the check/fix. Add a fire-and-forget background fn + a thin route
  in `cases.ts` that sets `GENERATING` and acquires the job lock. Don't write a bespoke
  verify/retry pair — that's the anti-pattern we removed.
- **A new debtor lookup:** add the service fn and one entry in the `LOOKUPS` registry in
  `cases.ts`; the generic `/lookups/:key` route, `lookupMeta`, and the `LookupCard`
  controller handle the rest. Don't add a new route or a stateful card.
- **Anything reading/writing a case:** scope by `organizationId: { in: req.orgIds! }`
  (reads via `findFirst`); for writes, guard with `caseInScope(id, req.orgIds!)` then write
  by `{ id }`, or use `deleteMany`/`updateMany`. Never scope a case query by `userId` alone.
- **Legal constants** (rates, deadlines, thresholds, court addresses) live in `lib/legal.ts`
  / `lib/county.ts` and are *injected* into prompts — the model must not recall them.
- **Dates** that appear in documents/deadlines render in `America/New_York`.

## Testing & CI

- Pure logic gets a vitest test (`*.test.ts` next to the source). The non-negotiables from
  Principle 1 — balance math, court routing, venue, the deterministic verifier, SOL — are
  covered; keep them covered when you touch them.
- Test files are excluded from the server build (`tsconfig` `exclude`) but run via
  `npm test`. Integration paths that need a DB/API key aren't unit-tested — verify those
  with the boot smoke test and manually.
- **CI must be green** (`.github/workflows/ci.yml` typechecks + builds + tests both
  packages). Don't merge red.

## Before you commit

1. `npm run build` (server) / `npm run build` (client) — both clean.
2. `npm test` in any package you touched.
3. For backend changes, a boot smoke test (`node dist/index.js` with throwaway env →
   `GET /api/health` is 200; startup steps fail *non-fatally* without a DB).
4. Small, themed commits with a message that says what changed and why. Develop on the
   feature branch; push when a coherent unit is green.

## Open design questions

### Should we re-prompt the AI after the user answers the intake clarifying questions?
The evidence-drop intake extracts fields *and* asks 2–5 clarifying questions; today the
answers just fill form fields. The open question is whether to feed those answers back to
the model to re-derive a better extraction/analysis. **Recommendation: do a single,
targeted second pass — not a loop, and not at intake.** Re-running the full extraction on
every answer is slow, costly, and can churn fields the user already corrected. Instead,
treat the user's answers as authoritative facts and let the *next* real step that already
calls the model — `synthesizeCase` (case analysis) — consume them. That pass is the one
whose quality actually depends on these facts, it already runs once, and the user has
finished correcting the form by then. If we ever want intake itself to react, scope it to
the specific field a single answer affects (e.g., recompute only the SOL/venue hint),
guard it behind "the user didn't manually edit this," and cap it at one pass. See the
chat thread for the fuller rationale.
