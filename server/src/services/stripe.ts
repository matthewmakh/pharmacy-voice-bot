/**
 * Stripe Connect escrow service.
 *
 * Flow:
 *   1. Claimant onboards a Connect account (Express).
 *   2. Debtor pays via Checkout — funds settle into Reclaim's platform balance.
 *   3. After cooldown, Reclaim takes 12% recovery fee and transfers 88%
 *      to the claimant's Connect account.
 *
 * Uses "separate charges and transfers" model so Reclaim controls escrow
 * timing and can hold funds while disputes resolve.
 */

import Stripe from 'stripe';

const apiKey = process.env.STRIPE_SECRET_KEY;
const PLATFORM_FEE_BPS = 1200; // 12.00% (basis points)

if (!apiKey) {
  console.warn('[stripe] STRIPE_SECRET_KEY not set — escrow flows will fail');
}

// Pin to a known API version. Cast keeps this resilient across SDK type bumps.
const stripe = apiKey
  ? new Stripe(apiKey, { apiVersion: '2025-09-30.clover' as never })
  : null;

type StripeClient = ReturnType<typeof getStripe>;

function getStripe(): InstanceType<typeof Stripe> {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe;
}

function client(): StripeClient {
  return getStripe();
}

// ─── Connect onboarding ──────────────────────────────────────────────────────

export async function createConnectAccount(userEmail: string): Promise<string> {
  const account = await client().accounts.create({
    type: 'express',
    email: userEmail,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: 'company',
  });
  return account.id;
}

export async function createConnectOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<string> {
  const link = await client().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

export async function getAccountStatus(accountId: string): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}> {
  const account = await client().accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

// ─── Debtor payment ──────────────────────────────────────────────────────────

export interface CreateCheckoutParams {
  amountCents: number;
  caseId: string;
  debtorEmail?: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createDebtorCheckoutSession(
  params: CreateCheckoutParams,
): Promise<{ sessionId: string; url: string }> {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    customer_email: params.debtorEmail,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: params.amountCents,
        product_data: { name: params.description },
      },
    }],
    metadata: { caseId: params.caseId },
    payment_intent_data: { metadata: { caseId: params.caseId } },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!session.url) throw new Error('Stripe returned no checkout URL');
  return { sessionId: session.id, url: session.url };
}

// ─── Escrow payout ───────────────────────────────────────────────────────────

/**
 * After receiving a debtor payment, transfer 88% to the claimant's Connect
 * account and retain 12% as the platform fee.
 */
export async function payoutToClaimant(params: {
  paymentIntentId: string;
  claimantAccountId: string;
  amountCollectedCents: number;
  caseId: string;
}): Promise<{ transferId: string; feeCents: number; payoutCents: number }> {
  const feeCents = Math.floor((params.amountCollectedCents * PLATFORM_FEE_BPS) / 10_000);
  const payoutCents = params.amountCollectedCents - feeCents;

  const transfer = await client().transfers.create({
    amount: payoutCents,
    currency: 'usd',
    destination: params.claimantAccountId,
    source_transaction: params.paymentIntentId,
    metadata: { caseId: params.caseId },
  });

  return { transferId: transfer.id, feeCents, payoutCents };
}

// ─── Webhook signature verification ──────────────────────────────────────────

export function verifyStripeSignature(
  rawBody: Buffer,
  signature: string,
): ReturnType<StripeClient['webhooks']['constructEvent']> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return client().webhooks.constructEvent(rawBody, signature, secret);
}
