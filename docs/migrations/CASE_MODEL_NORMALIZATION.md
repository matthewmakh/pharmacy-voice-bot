# Migration plan: normalize the `Case` god-object

**Status:** Planned / not started. Deliberately deferred — this is a destructive schema
change and must be staged carefully against production data.

## The problem

`Case` is a ~70-column row that mixes three different concerns:

1. **Case facts & state** — parties, claim amounts, dates, `status`, `strategy`.
2. **Generated documents** — ~14 columns: `demandLetter`/`demandLetterHtml`,
   `finalNotice`/`finalNoticeHtml`, `filingPacket*`, `courtForm*`, `defaultJudgment*`,
   `affidavitOfServiceHtml`, `settlementHtml`, `paymentPlanHtml`, plus six
   `*Verification` JSON blobs.
3. **Debtor research** — `acrisResult`, `courtHistory`, `entityResult`, `uccResult`,
   `ecbResult`, `pacerResult`, `lookupMeta`.

Consequences: every `findUnique`/`findFirst` without an explicit `select` drags
megabytes of HTML/JSON; adding a new document type means a `Case` migration; there's no
document history (regenerating overwrites); and the row is a write-contention hotspot.

## Target shape

```prisma
model GeneratedDocument {
  id            String   @id @default(cuid())
  caseId        String
  case          Case     @relation(fields: [caseId], references: [id], onDelete: Cascade)
  kind          DocKind  // DEMAND_LETTER | FINAL_NOTICE | COURT_FORM | DEFAULT_JUDGMENT | SETTLEMENT | PAYMENT_PLAN | AFFIDAVIT
  html          String   @db.Text
  text          String?  @db.Text
  formType      String?  // court form only
  instructions  Json?    // court form only
  verification  Json?    // deterministic fact-check result
  version       Int      @default(1)
  supersededAt  DateTime? // non-null once replaced by a newer version → enables history
  createdAt     DateTime @default(now())
  @@index([caseId, kind])
}

model DebtorResearch {
  id        String   @id @default(cuid())
  caseId    String
  case      Case     @relation(fields: [caseId], references: [id], onDelete: Cascade)
  source    ResearchSource // ACRIS | COURTS | ENTITY | UCC | ECB | PACER
  result    Json
  status    String   // running | done | error  (replaces lookupMeta)
  error     String?
  fetchedAt DateTime @default(now())
  @@unique([caseId, source])
}
```

`Case` keeps only facts + `status`/`strategy`/parties and gains
`documents GeneratedDocument[]` and `research DebtorResearch[]`.

## Why it's deferred (the risk)

The production deploy currently runs `prisma db push` on boot (see `railway.toml`).
`db push` resolves a column **removal** by dropping it — so naively deleting the old
`Case` columns would destroy existing documents/research. A safe split therefore
requires a real, ordered migration with a data backfill, which must be validated
against real data — not run blind.

## Safe staged rollout

Do these as separate, independently-deployable steps. Never combine "backfill" and
"drop columns" in one deploy.

1. **Switch deploy off `db push`.** Change `railway.toml` `startCommand` to
   `npx prisma migrate deploy && node dist/index.js`, and start committing migrations
   (`prisma migrate dev` locally). This is a prerequisite — `db push` cannot express a
   safe column drop.
2. **Add the new tables (additive migration).** No column removals. Deploy. Zero risk.
3. **Idempotent backfill at startup** (mirror the org backfill in `index.ts`): for each
   `Case`, copy any populated document/research columns into `GeneratedDocument` /
   `DebtorResearch` rows if not already present. Safe to run every boot.
4. **Cut the code over.** Read/write documents and research through the new tables.
   Keep the API response shape **flat** (denormalize on read — map the rows back into
   `demandLetterHtml`, `acrisResult`, etc.) so the frontend needs **no** changes in this
   step. Old columns become read-fallback only.
5. **Bake.** Run in production for a release or two; confirm the new tables are the
   source of truth and the old columns are no longer written.
6. **Drop the old columns** in a final, separate migration once you're confident.

## Code touch-points

- `server/src/routes/cases.ts` — all generate/PDF routes read/write the doc columns.
- `server/src/routes/cases.ts` — the `/lookups/:key` trigger writes research columns +
  `lookupMeta`; `assess-strategy` reads them.
- `server/src/services/verify.ts` — unchanged (operates on HTML, not storage).
- `client/src/types/index.ts` + tabs — **no change** if the API stays flat (step 4).

## Payoff

Smaller `Case` rows and cheaper reads; new document types without a `Case` migration;
and—most user-visible—**document version history** via `version`/`supersededAt`, so a
regenerate keeps the prior draft instead of overwriting it.

## Rough estimate

~1–1.5 days: 0.5 day schema + backfill + the read/write cutover, 0.5 day testing
(the denormalization mapping is the fiddly part), then a later 1-hour column-drop PR.
