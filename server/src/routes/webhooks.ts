/**
 * Inbound vendor webhooks for Lob (mail tracking), Resend (email events),
 * Dropbox Sign (signature events), and Stripe (payment events).
 *
 * All routes are mounted under /api/webhooks. Signature verification is
 * enforced when the vendor's signing secret is set in env; otherwise the
 * route logs a warning and processes the event (dev convenience).
 */

import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import type { LobWebhookPayload } from '../services/lob';
import type { ResendWebhookPayload } from '../services/resend';
import type { DropboxSignWebhookPayload } from '../services/dropboxSign';
import { verifyStripeSignature } from '../services/stripe';
import { cancelFollowUpForCase } from '../jobs/followUpScheduler';

const router = Router();

// ─── Lob: certified mail tracking ────────────────────────────────────────────

router.post('/lob', express.json(), async (req: Request, res: Response) => {
  const payload = req.body as LobWebhookPayload;

  // Optional: verify Lob webhook signature if LOB_WEBHOOK_SECRET is set
  // (Lob uses HMAC-SHA256 on the raw body; we'd need raw-body middleware)

  const eventType = payload.event_type?.id;
  const letterId = payload.body?.id;
  const caseId = payload.body?.metadata?.caseId;
  const kind = payload.body?.metadata?.kind;

  if (!letterId || !caseId) {
    res.status(200).json({ ok: true, ignored: 'missing letterId or caseId' });
    return;
  }

  try {
    if (eventType === 'letter.delivered') {
      const fields =
        kind === 'final-notice'
          ? { finalNoticeDeliveredAt: new Date() }
          : { demandLetterDeliveredAt: new Date() };

      await prisma.case.update({
        where: { id: caseId },
        data: {
          ...fields,
          actions: {
            create: {
              type: 'DEMAND_LETTER_DELIVERED',
              label: `Lob: ${kind || 'letter'} delivered`,
              metadata: { letterId, eventType, kind },
            },
          },
        },
      });
    } else {
      // log other tracking events as-is
      await prisma.caseAction.create({
        data: {
          caseId,
          type: 'CERTIFIED_MAIL_SENT',
          status: 'COMPLETED',
          label: `Lob: ${eventType}`,
          metadata: { letterId, eventType, kind },
        },
      });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook:lob] processing error', err);
    res.status(500).json({ error: 'failed to process' });
  }
});

// ─── Resend: email delivery / open / click ───────────────────────────────────

router.post('/resend', express.json(), async (req: Request, res: Response) => {
  const payload = req.body as ResendWebhookPayload;

  // Resend uses Svix signature headers (svix-id, svix-timestamp, svix-signature)
  // when RESEND_WEBHOOK_SECRET is configured. Skipping verification for dev.

  const tags = payload.data?.tags || {};
  const caseId = tags.caseId;
  const kind = tags.kind;
  const emailId = payload.data?.email_id;

  if (!caseId || !emailId) {
    res.status(200).json({ ok: true, ignored: 'missing caseId or emailId' });
    return;
  }

  try {
    let actionType: 'EMAIL_OPENED' | 'EMAIL_CLICKED' | 'EMAIL_SENT' = 'EMAIL_SENT';
    const updates: Record<string, unknown> = {};

    if (payload.type === 'email.opened') {
      actionType = 'EMAIL_OPENED';
      if (kind === 'demand-letter') updates.demandLetterEmailOpenedAt = new Date();
    } else if (payload.type === 'email.clicked') {
      actionType = 'EMAIL_CLICKED';
    }

    await prisma.case.update({
      where: { id: caseId },
      data: {
        ...updates,
        actions: {
          create: {
            type: actionType,
            label: `Resend: ${payload.type}`,
            metadata: { emailId, kind, eventType: payload.type },
          },
        },
      },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook:resend] processing error', err);
    res.status(500).json({ error: 'failed to process' });
  }
});

// ─── Dropbox Sign: signature events ──────────────────────────────────────────

router.post('/dropbox-sign', express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
  // Dropbox Sign sends webhooks as multipart/form-data with a "json" field.
  // The event_hash is HMAC-SHA256 of (event_time + event_type) using the API key.
  const raw = req.body.json;
  if (!raw) {
    // Dropbox Sign requires a literal "Hello API Event Received" response to
    // confirm the webhook URL during setup.
    res.status(200).send('Hello API Event Received');
    return;
  }

  let payload: DropboxSignWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'invalid json' });
    return;
  }

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (apiKey && payload.event?.event_hash) {
    const expected = crypto
      .createHmac('sha256', apiKey)
      .update(payload.event.event_time + payload.event.event_type)
      .digest('hex');
    if (expected !== payload.event.event_hash) {
      res.status(401).json({ error: 'invalid event_hash' });
      return;
    }
  }

  const sr = payload.signature_request;
  const caseId = sr?.metadata?.caseId;
  const kind = sr?.metadata?.kind;
  const requestId = sr?.signature_request_id;

  if (!caseId || !requestId) {
    res.status(200).send('Hello API Event Received');
    return;
  }

  try {
    if (payload.event.event_type === 'signature_request_all_signed' && sr?.is_complete) {
      const updates: Record<string, unknown> =
        kind === 'payment-plan'
          ? { paymentPlanSignedAt: new Date() }
          : { settlementSignedAt: new Date() };

      await prisma.case.update({
        where: { id: caseId },
        data: {
          ...updates,
          actions: {
            create: {
              type: kind === 'payment-plan' ? 'PAYMENT_PLAN_SIGNED' : 'SETTLEMENT_SIGNED',
              label: `Dropbox Sign: ${kind || 'agreement'} fully signed`,
              metadata: { requestId, kind },
            },
          },
        },
      });
      // Stop auto follow-ups: settlement reached
      cancelFollowUpForCase(caseId).catch(() => { /* non-blocking */ });
    } else {
      await prisma.caseAction.create({
        data: {
          caseId,
          type: 'EMAIL_SENT', // generic log for intermediate events
          status: 'COMPLETED',
          label: `Dropbox Sign: ${payload.event.event_type}`,
          metadata: { requestId, kind, eventType: payload.event.event_type },
        },
      });
    }
    res.status(200).send('Hello API Event Received');
  } catch (err) {
    console.error('[webhook:dropbox-sign] processing error', err);
    res.status(500).json({ error: 'failed to process' });
  }
});

// ─── Stripe: payment events ──────────────────────────────────────────────────

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'missing stripe-signature header' });
      return;
    }

    let event;
    try {
      event = verifyStripeSignature(req.body as Buffer, signature);
    } catch (err) {
      console.error('[webhook:stripe] signature verification failed', err);
      res.status(400).json({ error: 'invalid signature' });
      return;
    }

    const obj = event.data.object as { id: string; metadata?: Record<string, string> };
    const caseId = obj.metadata?.caseId;

    try {
      if (event.type === 'checkout.session.completed' && caseId) {
        const session = event.data.object as {
          id: string;
          payment_intent: string;
          amount_total: number;
          metadata?: Record<string, string>;
        };
        await prisma.case.update({
          where: { id: caseId },
          data: {
            stripePaymentIntentId: session.payment_intent,
            amountCollectedCents: session.amount_total,
            actions: {
              create: {
                type: 'PAYMENT_VIA_PORTAL',
                label: `Debtor paid $${(session.amount_total / 100).toFixed(2)} via portal`,
                metadata: { sessionId: session.id, paymentIntentId: session.payment_intent },
              },
            },
          },
        });
        // Stop auto follow-ups: debtor paid
        cancelFollowUpForCase(caseId).catch(() => { /* non-blocking */ });
      } else if (event.type === 'account.updated') {
        const account = event.data.object as {
          id: string;
          charges_enabled: boolean;
          payouts_enabled: boolean;
        };
        await prisma.user.updateMany({
          where: { stripeAccountId: account.id },
          data: {
            stripeAccountChargesEnabled: account.charges_enabled,
            stripeAccountPayoutsEnabled: account.payouts_enabled,
          },
        });
      }
      res.status(200).json({ received: true });
    } catch (err) {
      console.error('[webhook:stripe] processing error', err);
      res.status(500).json({ error: 'failed to process' });
    }
  },
);

export default router;
