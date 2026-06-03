# Frontend redesign — baseline & change log

**Goal:** a cooler, cleaner, better-looking UI (shadcn-style) across the whole app,
including navigation. **Hard constraint: this is strictly a *visual* redesign — no
behavior, workflow, routing, data flow, gating, or API usage changes.** Every feature
listed in the regression checklist below must work identically afterward.

This file is the **before** record. The "What changed" and "Verification" sections at the
bottom are filled in once the redesign lands, so we can confirm nothing behavioral drifted.

Before screenshots: [`before/`](./before/) (Dashboard, Case workspace, Login, mobile).
After screenshots will land in `after/`.

---

## Baseline design system (before)

- **Type:** system font stack only (`-apple-system, Segoe UI, system-ui`) — the main reason
  it read as "prototype." No web font.
- **Color:** stock Tailwind — `slate-*` neutrals + default `blue-600`; a `brand` blue scale was
  defined in the config but unused. Semantic tones via `Tone` = neutral/info/success/warning/danger.
- **Surfaces:** white cards, `rounded-xl`, `border-slate-200`, uniform `shadow-sm`, on a `slate-50` canvas.
- **Shell:** dark `slate-900` sidebar (`w-60`), light content. Auth screens on a dark `slate-900` field.
- **Shared classes (index.css):** `.btn` / `.btn-primary|secondary|danger|ghost|lg|sm`, `.card`,
  `.input`, `.label`, `.section-title`, `.muted`, `.divider`, `.kbd-label`, `.field-label`,
  `.field-value`, `.stack-sm|md|lg`.
- **UI primitives (`components/ui/`):** `Badge` (tone+size), `Alert` (tone+title+actions),
  `EmptyState`, `TabBar` (roving-tabindex, arrow-key nav, disabled hints), `StatusPill`
  (status→tone), `SectionCard` (collapsible).

### Redesign approach (so nothing breaks)
- Introduce shadcn-style **CSS-variable tokens** + Tailwind theme mapping; **keep every existing
  class name** (`.btn-*`, `.card`, `.input`, …) so unredesigned screens keep working while we
  restyle screen-by-screen.
- Self-host the typeface (`@fontsource-variable/inter`) — the server CSP only allows `'self'`
  styles/fonts, so a Google Fonts `<link>` would be blocked.
- Add `cn()` (clsx + tailwind-merge). No Radix swaps of existing interactive components (avoids
  behavior changes); we restyle, not re-implement.

---

## Functional inventory — REGRESSION CHECKLIST (must work identically after)

Behavior only. Compiled from the codebase with file:line refs.

### Routing & auth
- [ ] `PublicOnly` redirects logged-in users away from `/login` `/register` → `/` (App.tsx:44–45).
- [ ] `ProtectedRoutes` shows Loading, redirects unauthenticated → `/login` (App.tsx:12–36).
- [ ] Routes: `/` Dashboard, `/cases/new`, `/cases/:id`, `/team`; unknown → `/` (App.tsx:26–34).
- [ ] Token validated on mount; 401 anywhere fires `auth:unauthorized` → clean logout (AuthContext.tsx:38–52).
- [ ] ErrorBoundary fallback: "Try again" + "Back to dashboard" (ErrorBoundary.tsx).

### Dashboard
- [ ] 4 stat cards: Active, Needs Attention (STRATEGY_PENDING/ASSEMBLING), Total Outstanding, Resolved.
- [ ] Drafts hidden from the table; row click → `/cases/:id`.
- [ ] Polls every 5s **only** while a case is ANALYZING/GENERATING, else not at all (Dashboard.tsx:72–76).
- [ ] EmptyState when no cases; "Load more" when `length >= limit` (pagination).

### New Case intake (NewCase.tsx)
- [ ] First upload creates a draft (`createDraftCase`) then `uploadDocuments`; submit uses
      `submitDraftCase` if draft exists else `createCase` (149–154, 106–112).
- [ ] Autofill: `autofillFromDocuments` (180s) → fills only high/med-confidence fields, AI badges
      with source tooltips; manual edit clears the badge (143–201, 132–141, 217–230).
- [ ] Clarifying questions: save/edit/clear each; "Save & submit all" → `applyIntakeAnswers` (120s) (296–327).
- [ ] Proposed changes modal: Accept applies to form, Discard doesn't (203–211, 331–367).
- [ ] Submit disabled when `!amountOwed || analyzing || uploading`; amountPaid>amountOwed warning;
      missing-recommended-fields alert (442, 450–452, 511–532).
- [ ] RotatingFact while analyzing.

### Team (Team.tsx)
- [ ] List orgs (role + member count); per-org members load; invite (OWNER/ADMIN) → `inviteMember`;
      remove (not OWNER) → `removeMember`; gating + error display (13, 35, 42–47, 64–92).

### Case detail shell (case-detail/index.tsx)
- [ ] Smart polling: 3s while ANALYZING/GENERATING, docs pending (<10min), or a lookup running (67–82).
- [ ] Tab gating: Strategy off in DRAFT; Letter needs strategy|letter; Escalation needs letter|post-letter
      status; disabled-tab hint on hover; auto-fallback to Overview if active tab disables (34–47, 86–89).
- [ ] In-progress banner for ANALYZING/GENERATING; "Next step" nudge with CTA that switches tab (49–60, 146–166).
- [ ] Header: back, title/fallback, StatusPill, strategy label, outstanding (129–143).

### Overview tab
- [ ] Key numbers (owed/paid/balance); pre-judgment interest card when outstanding>0 & paymentDueDate past.
- [ ] Inline edit form → `updateCase` (parses amounts; clears empty dates to null); dirty-confirm on cancel.
- [ ] Parties cards; Key Dates + SOL alert; AI assessment; Evidence-on-file; Missing info; Services.

### Evidence tab + UploadZone
- [ ] Upload (dropzone: pdf/txt/jpg/png/gif/webp, ≤20 files, 25MB) → `uploadDocuments` (60s).
- [ ] Per-doc status: failed+Retry / analyzing(+Retry if stuck>3min) / classified badge.
- [ ] Preview modal (images+PDF only): blob URL; close on Esc / X / outside; Download; Delete; Reanalyze.

### Strategy tab + lookups
- [ ] `analyzeCase`; needsAnalysis / isAnalyzing / isStuck(>2min)+Reset states; RotatingFact.
- [ ] Assessment: strength badge, summary, legal theory + elements (✓/gap), counterclaim risk, enforcement,
      SOL, strategy reasoning.
- [ ] 6 lookup cards via generic LookupCard: trigger `triggerLookup`, poll while running, persist result +
      fetched date; collapsed if all empty. RefineStrategyPanel (`assessStrategy`) only if a result exists.
- [ ] Strategy selector cards: select → `setStrategy`; Selected label; AI-pick badge; disabled while pending.
- [ ] caseAnalysisVerification panel when present.

### Letter tab
- [ ] `generateLetter` (needs strategy); EmptyState/RotatingFact/result states.
- [ ] Result actions: Copy (→"Copied!" 2s), Email (mailto, gated on debtorEmail, logs EMAIL_SENT),
      View (openHtmlInTab), Download PDF, Regenerate; verification panel; HTML render.

### Escalation tab (+ sub-panels)
- [ ] PreFilingNotice (`generateFinalNotice`), CourtFormPanel (`generateCourtForm`, track by amount,
      instructions + verification), ProcessServerPanel (only if outstanding>$10k; log SERVICE_INITIATED;
      deadline math 20/30 days), AffidavitPanel (only after service), DefaultJudgmentPanel (answer-deadline
      gate), SettlementPanel (settlement + payment-plan generate/view/PDF).

### Filing guide tab
- [ ] Court routing (≤10k/10–50k/>50k); pre-filing checklist (8 items); filing steps (expandable);
      deadline tracker (service ±20/30, default motion, RJI); SOL alert.

### Timeline tab
- [ ] Log action (type select; notes; amount field when PAYMENT_RECEIVED) → `logAction`; sorted desc; EmptyState.

### Shared
- [ ] VerificationPanel (status, auto-corrected badge, counts, issues, blank fields).
- [ ] InlineProgress / RotatingFact (elapsed + capped-95% estimate). PdfDownloadButton (blob, no token in URL).
- [ ] openHtmlInTab (CPLR print CSS, blob, revoke after 60s).
- [ ] DisclaimerGate one-time modal (localStorage `reclaim:disclaimerAck:v1`).

### Mutation disabled-states & polling
- [ ] Every disabled-state in the table (NewCase submit, answers, analysis, strategy, letter, lookups,
      team, timeline) preserved.
- [ ] Polling stops when idle (dashboard + case detail) — no battery/quota drain.

---

## What changed

Screenshots: [`before/`](./before/) vs [`after/`](./after/).

**Design system / foundation**
- shadcn-style **CSS-variable tokens** (light + dark) mapped through the Tailwind theme; added
  `cn()` (clsx + tailwind-merge) and `tailwindcss-animate`.
- **Typography:** system font stack → self-hosted **Inter Variable** (CSP-safe; no external `<link>`).
- Existing class names kept and retoned (`.btn-*`, `.card`, `.input`, `.label`, …).

**Navigation / shell**
- Dark `slate-900` sidebar → **light token sidebar** with a primary-accent active state, a
  "Workspace" section label, and a refined logo lockup. Mobile top bar + overlay (blur) retoned.

**Dashboard**
- Refined stat cards (token accents, hover lift) and a cleaner table (muted header, row hover,
  animated chevron). **New responsive mobile card list** replaces the horizontally-scrolling table
  that clipped amounts. Centered `max-w-7xl`, subtle fade-in.

**Auth**
- Dark centered login → **branded split-screen** (`AuthLayout`): gradient brand panel + feature
  list on desktop, clean form on the right, logo lockup on mobile. Login + Register restyled.

**Case workspace + primitives**
- Case header (semibold / tracking-tight) and next-step banner (accent surface, primary border) refined.
- `TabBar` (primary active underline), `SectionCard`, `EmptyState`, `DisclaimerGate` (token surfaces,
  backdrop blur, entrance animation) retoned. `Badge`/`Alert` kept (already token-adjacent).

**App-wide**
- Migrated all remaining neutral `slate-*` utilities → `foreground` / `muted-foreground` / `border` /
  `muted`, and bare `bg-white` → `bg-card`, across every case-detail tab, escalation/strategy
  sub-panel, shared component, New Case intake, and Team. **Semantic accent tones**
  (success / warning / danger / info, status pills, risk levels, doc classifications) intentionally kept.

**What did NOT change (functionality).** Routing & auth gating, `AuthContext`, every React Query
query/mutation, all polling intervals, tab-gating + next-step logic, all handlers (upload / generate /
lookup / PDF / email / copy), disabled-states, the `DisclaimerGate` localStorage key, `openHtmlInTab`
print CSS, and all PDF/blob flows are untouched. The **only** non-color structural change is the
Dashboard's mobile presentation (table → card list) — same data, same row-click navigation.

## Verification

- **Build:** client `tsc && vite build` green (1754 modules); root build (client + server) green.
  Server source untouched (18/18 server tests unaffected).
- **Tests:** client `vitest` **5/5** pass (SOL math).
- **Visual:** before/after captured for Login, Dashboard (desktop + mobile), Case Overview,
  Strategy, Evidence, Filing Guide, New Case, and Team. All states render correctly — tab gating
  (Letter/Escalation disabled), next-step banner, status pills, badges, lookup grid, strategy
  selector + AI-pick badge, document classifications, and member roles all present and correct.
- **Regression checklist:** every behavior-only item above is unaffected, since changes are limited to
  `className` strings plus the Dashboard mobile card list (same data + navigation). Not exercised
  against a live DB/API in this pass (none available here) — recommend a click-through on staging.
