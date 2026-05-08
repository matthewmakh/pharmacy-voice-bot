# Phase A — Test Plan

End-to-end verification of the send/sign/collect flow. Work top-to-bottom;
each section depends on the previous one being green.

---

## 0. Pre-flight checklist

- [ ] **Database is accessible.** `DATABASE_URL` set in `server/.env` and the
      DB is reachable. Test: `cd server && npx prisma db pull` should print
      the existing schema without error.

- [ ] **Schema is up to date.** Run `cd server && npx prisma db push` to
      apply the new Phase A fields. Should report a bunch of "Added column"
      lines and exit clean.

- [ ] **Vendor keys are in `.env`.** At repo root:
  ```
  LOB_API_KEY=test_440a07f1...
  RESEND_API_KEY=re_dYjYf7vC...
  DROPBOX_SIGN_API_KEY=8db1b506...
  STRIPE_SECRET_KEY=sk_test_...        # ← still missing
  STRIPE_PUBLISHABLE_KEY=pk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...      # added in step 3 below
  EMAIL_FROM_ADDRESS=hello@mail.reclaimful.com
  PUBLIC_BASE_URL=http://localhost:5173
  REDIS_URL=redis://localhost:6379     # optional in dev
  ```

- [ ] **Smoke test passes.** From `server/`, run:
  ```bash
  npx ts-node test-phase-a.ts
  ```
  Should print `OK` for every vendor whose key is set. Any `FAIL` blocks
  the rest of testing — fix before continuing.

- [ ] **Server boots.** `cd server && npm run dev`. Console should show
      `Collections Platform server running on port 3001` and no warnings
      about missing keys (warnings about Redis are OK if `REDIS_URL` unset
      — follow-ups will be a no-op).

- [ ] **Client boots.** `cd client && npm run dev`. Open
      http://localhost:5173 — login screen renders.

---

## 1. Resend sender domain (one-time setup)

The demand-letter email won't deliver until you verify the domain.

- [ ] Go to https://resend.com/domains
- [ ] Click your domain (`reclaimful.com`)
- [ ] Resend shows ~5 DNS records to add (SPF, DKIM × 3, DMARC)
- [ ] Add them in your DNS provider for `reclaimful.com`
- [ ] Wait ~5 min, click **Verify DNS records** in Resend
- [ ] All five should turn green ✓

If `EMAIL_FROM_ADDRESS=hello@mail.reclaimful.com` (subdomain), verify
`mail.reclaimful.com` instead. If you want to keep things simple, change
`.env` to `EMAIL_FROM_ADDRESS=hello@reclaimful.com` and verify the
apex domain.

**Test:** smoke script reports `Resend OK · domain verified`.

---

## 2. Stripe Connect (one-time setup)

Required for the debtor → portal → escrow → payout flow. The platform
needs Connect enabled.

- [ ] Go to https://dashboard.stripe.com/test/settings/connect
- [ ] Enable **Connect** if it's not already on (test-mode is fine)
- [ ] In Settings → Connect → Onboarding options, leave Express as the
      default account type (matches our integration)
- [ ] In your `.env`, paste your `sk_test_...` and `pk_test_...` keys
- [ ] Restart the server

**Test:** open http://localhost:5173/settings/payouts. Click "Start Stripe
onboarding". You should be redirected to a `connect.stripe.com/...` URL.
Fill in the test data Stripe suggests (use SSN `000-00-0000`, etc.). On
return, the page should show "Connected" with charges + payouts enabled.

---

## 3. Webhook configuration (one-time per vendor)

Webhooks tell the app when mail is delivered, email is opened, signature
is completed, payment is received. Without them, the app sees no events.

For local testing, use **ngrok** or **Cloudflare Tunnel** to expose your
laptop:

```bash
brew install ngrok
ngrok http 3001
# copy the https://xxx.ngrok-free.app URL
```

Then for each vendor:

### Lob
- [ ] https://dashboard.lob.com/settings/webhooks
- [ ] Add endpoint: `https://xxx.ngrok-free.app/api/webhooks/lob`
- [ ] Subscribe to: `letter.created`, `letter.in_transit`, `letter.processed_for_delivery`, `letter.delivered`, `letter.returned_to_sender`

### Resend
- [ ] https://resend.com/webhooks
- [ ] Add endpoint: `https://xxx.ngrok-free.app/api/webhooks/resend`
- [ ] Subscribe to: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`

### Dropbox Sign
- [ ] https://app.hellosign.com/home/myAccount#api
- [ ] Scroll to "Webhooks" section, add: `https://xxx.ngrok-free.app/api/webhooks/dropbox-sign`
- [ ] All events (default)

### Stripe
- [ ] https://dashboard.stripe.com/test/webhooks
- [ ] Add endpoint: `https://xxx.ngrok-free.app/api/webhooks/stripe`
- [ ] Subscribe to: `checkout.session.completed`, `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`
- [ ] After saving, copy the **signing secret** (starts with `whsec_...`)
- [ ] Paste into `.env` as `STRIPE_WEBHOOK_SECRET=whsec_...`
- [ ] Restart server

---

## 4. End-to-end scenario

Time budget: ~10 minutes. You play both creditor (in the main app) and
debtor (in an incognito window).

### 4.1 — Set up the creditor (you)

- [ ] Log in or register at http://localhost:5173
- [ ] Sidebar → **Payouts** → confirm "Connected" (set up in step 2)

### 4.2 — Create a test case

- [ ] **New Case** with these fields. Use **a real email you control**
      for the debtor — this is what receives the demand letter.

  ```
  Claimant business: Test Pharmacy LLC
  Claimant email:    you+claimant@example.com
  Claimant address:  123 Main St, New York, NY 10001
  Debtor business:   Test Debtor Co
  Debtor email:      you+debtor@example.com   ← real, you control
  Debtor address:    456 Test Ave, Brooklyn, NY 11201
  Amount owed:       1000.00
  Service descr:     Pharmacy services rendered Aug-Sep 2025
  Invoice number:    INV-2025-001
  Invoice date:      2025-09-15
  ```

- [ ] Run analysis → pick a strategy → generate demand letter
- [ ] Letter tab should show the generated demand letter

### 4.3 — Send the demand letter

- [ ] On the Letter tab, in the **Send Demand Letter** panel:
  - [ ] Toggle **Email** on (Mail off for now — that costs $8 and we don't
        need to test certified mail to verify the flow)
  - [ ] Click **Send via Email**
- [ ] Panel updates to show "Emailed [date]"
- [ ] Check the debtor inbox (`you+debtor@example.com`) — email should
      arrive within seconds with a **Respond online** button at top
- [ ] Server console should log a `[webhook:resend] email.delivered`
      entry within ~10 seconds

### 4.4 — Debtor responds (Pay)

- [ ] In an **incognito window**, click the **Respond online** button
      from the email (or copy the URL from the DebtorPortalCard)
- [ ] Portal loads, showing the claimant business + amount + invoice
- [ ] Click **Pay $1,000.00**
- [ ] Stripe Checkout opens. Use test card `4242 4242 4242 4242`,
      future expiry, any CVC, any ZIP
- [ ] On success, redirected to `/respond/paid` with the green confirm

### 4.5 — Creditor verifies payment

- [ ] Server console: `[webhook:stripe] checkout.session.completed`
- [ ] Refresh the Letter tab in the main app
- [ ] **Escrow & Payout** card now appears showing:
  - Collected: $1,000.00
  - Reclaim fee (12%): $120.00
  - Payout to you (88%): $880.00
- [ ] Click **Release funds to my Stripe account**
- [ ] Card updates to "Released [datetime]" with the transfer ID

If the release fails with "card payment hasn't cleared yet", that's
expected for real cards — wait 1-2 business days. For the test card
`4242...` in test mode, the transfer should succeed immediately.

### 4.6 — E-signature flow (separate test)

- [ ] On the same case, Escalation tab → Settlement Track
- [ ] Generate a stipulation of settlement (or payment plan)
- [ ] Click **Send for E-Signature**
- [ ] Both `you+claimant@example.com` and `you+debtor@example.com`
      should receive Dropbox Sign emails within seconds
- [ ] Sign as both parties (test mode lets you click through)
- [ ] Server console: `[webhook:dropbox-sign] signature_request_all_signed`
- [ ] Refresh the case — settlement row shows "Fully signed [date]"

### 4.7 — Auto follow-up cadence (optional, requires Redis)

If `REDIS_URL` is set:

- [ ] Send a demand-letter email to a fresh case (no payment, no signature)
- [ ] Check `case.followUpEnabled` is true and `followUpStartedAt` is set
- [ ] BullMQ should have ~4 delayed jobs scheduled for that case
- [ ] To force the next step without waiting, manipulate the queue or
      adjust system clock — out of scope for normal testing

---

## 5. Common issues and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `Domain not verified` from Resend | DNS records not added or not propagated | Re-check DNS, wait 10 min, click verify in Resend dashboard |
| `Could not parse debtor address` on send-mail | Address doesn't have `City, ST ZIP` shape | Re-enter on the Overview tab as `Street, City, ST ZIP` |
| `Stripe webhook signature verification failed` | `STRIPE_WEBHOOK_SECRET` mismatch | Copy fresh secret from Stripe dashboard → restart server |
| Debtor paid but no payout panel appears | Webhook didn't reach the server | Check ngrok is running and Stripe dashboard shows the event was delivered (200) |
| `Stripe Connect onboarding incomplete` on release | Onboarding finished but capabilities not yet active | Wait ~1 minute, refresh `/settings/payouts`, retry release |
| `Hello API Event Received` response on Dropbox Sign webhook setup | This is correct — Dropbox Sign requires this exact body to validate the URL | Nothing to fix |

---

## 6. What to report back

If anything fails in section 4, send me:

1. The step number that broke
2. Server console output around the failure (last ~20 lines)
3. Browser console errors if it was a UI break
4. Vendor dashboard webhook delivery log if the webhook didn't arrive

I'll fix forward from there.
