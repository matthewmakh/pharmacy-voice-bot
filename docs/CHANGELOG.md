# Overhaul changelog

A senior-engineer audit of the platform produced a fix program; this is what shipped on
`claude/relaxed-ptolemy-otAGB`, grouped by theme. Each bullet is the *what* + the *why*.
Commits are small and themed — see `git log` for the exact diffs.

## Reliability & correctness
- **Async AI routes.** Court form, default judgment, and final notice ran 3–5 sequential
  Claude calls inside one HTTP request and routinely blew the 120s client timeout. They're
  now fire-and-forget with `GENERATING` + polling, like the demand letter.
- **Idempotent generation.** A per-case in-memory job lock + busy-status check makes
  generate/analyze idempotent under double-clicks (second request → `409`), preventing
  duplicate AI spend and racing writes.
- **Truncation guards.** Every AI call throws on `stop_reason === 'max_tokens'`, so a
  settlement/judgment cut off mid-clause is never saved as if complete.
- **CIV-SC-70 PDF fix.** The form drew a `✓` in a Helvetica StandardFont (unencodable →
  threw on every commercial-claims download). Now a WinAnsi-safe glyph; the resolved
  county drives the borough checkbox.
- **Venue.** Replaced brittle substring matching (which defaulted *everything* unknown —
  including non-NYC — to Queens) with a ZIP→county resolver that flags out-of-NYC/ambiguous
  addresses instead of silently guessing.
- **Statute of limitations.** `solForCase` now restarts the 6-year clock from the most
  recent acknowledgment/partial payment (GOL §17-101/§17-107), matching the app's own
  settlement/payment-plan language (it previously could show "expired" on a revived debt).
- **Payments.** A partial payment no longer marks a case `RESOLVED`; only one that clears
  the balance does. `amountPaid` uses an atomic increment (was read-modify-write).
- **File ingestion.** `.docx` is parsed (mammoth) and scanned/image-only PDFs are read by
  Claude — both previously produced garbage/empty text and were fed to the model anyway.

## AI system
- **Deterministic verification.** Six `verify*` + five `retry*` LLM functions (an LLM
  checking another LLM, which flagged injected courthouse addresses as "hallucinated" and
  then argued with itself) were replaced by `verifyDocumentFacts` — code that checks the
  party names / amount / invoice / blanks actually appear in the HTML — plus one shared
  `reviseDocument` LLM corrector invoked only on real issues. Faster, cheaper, correct.
- **Structured output.** Every JSON-returning function now uses a forced tool call with a
  schema (`generateJSON`), eliminating the brittle `extractJson` slice and the
  prose/fence/HTML-in-JSON parse failures it caused.
- **Prompt caching** on the large static instruction blocks; **ET-localized** dates.
- **Evidence-drop intake, upgraded.** `extractIntakeFromDocuments` now also returns a
  plain-language summary of what it read and 2–5 clarifying questions; the intake fills the
  form as the user answers them (see open question in `docs/ENGINEERING.md`).

## Debtor research
- Six synchronous GET lookups (UCC/PACER blocked 40–90s) → one backgrounded
  `POST /lookups/:key` trigger; results persist with a `lookupMeta` status the page polls.
  Fixed a latent bug where results lived only in component state and vanished on refresh.

## Security
- `helmet` + a tailored CSP, `X-Content-Type-Options: nosniff`, and forced-download for
  non-previewable uploads (closes a same-origin stored-XSS vector).
- JWT scopes: the 30-day session token is header-only; files/PDFs download via
  header-authenticated blobs (no token in URLs/logs/history). Fail-fast if `JWT_SECRET`
  is unset in production.

## Durability & scale
- **Pluggable storage** (`lib/storage.ts`): local disk (dev) or S3/Cloudflare R2 (prod,
  opt-in via env). Uploads were on ephemeral container disk and lost on every redeploy.
- **Multi-tenant organizations.** `Organization`/`Membership`/`Case.organizationId`
  (additive); case access scoped by org membership so teams share cases; `/api/orgs` +
  Team page to manage members; idempotent startup backfill for existing data.
- **Bounded list reads** (`GET /cases` limit/offset + Dashboard "Load more"); shared
  Puppeteer browser with timeouts (was a launch-per-PDF).

## Frontend / UX
- A persistent **"Next step"** guide and **status-gated tabs** make the workflow legible;
  keyboard tab nav; doc polling stops after 10 minutes (was infinite for stuck docs).
- 401 → clean logout; an `ErrorBoundary`; surfaced upload/lookup/generation errors
  (several were swallowed); mobile single-column form grids; modal ESC/focus/aria.
- One-time **disclaimer gate** + footer (UPL mitigation).

## Tooling
- **vitest** unit tests (legal math, venue resolver, deterministic verifier, SOL) and a
  **GitHub Actions** CI that typechecks, builds, and tests both packages on push/PR.

## Deliberately deferred
- **S3 enablement** needs your bucket/credentials (code is ready).
- **`Case` god-object normalization** — destructive migration, staged plan in
  `docs/migrations/CASE_MODEL_NORMALIZATION.md`.
