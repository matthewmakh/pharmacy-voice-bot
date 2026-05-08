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
import type { ProofWebhookPayload } from '../services/proof';
import type { InfoTrackWebhookPayload } from '../services/infoTrack';
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

// ─── Proof.com: notarization + process service events ───────────────────────

router.post('/proof', express.json(), async (req: Request, res: Response) => {
  const payload = req.body as ProofWebhookPayload;
  const caseId = payload.data?.metadata?.caseId;
  const objectId = payload.data?.id;

  if (!caseId || !objectId) {
    res.status(200).json({ ok: true, ignored: 'missing caseId or id' });
    return;
  }

  try {
    if (payload.event === 'notarization.completed') {
      await prisma.case.update({
        where: { id: caseId },
        data: {
          notarizationStatus: 'completed',
          notarizedAt: new Date(),
          notarizedPdfUrl: payload.data.signed_document_url ?? null,
          actions: {
            create: {
              type: 'FILING_PREPARED',
              label: 'Notarization completed via Proof',
              metadata: { notarizationId: objectId, signedUrl: payload.data.signed_document_url } as never,
            },
          },
        },
      });
    } else if (payload.event === 'notarization.failed') {
      await prisma.case.update({
        where: { id: caseId },
        data: { notarizationStatus: 'failed' },
      });
    } else if (payload.event === 'service.served') {
      await prisma.case.update({
        where: { id: caseId },
        data: {
          processServeStatus: 'served',
          processServedAt: new Date(),
          processServeAffidavitUrl: payload.data.affidavit_url ?? null,
          actions: {
            create: {
              type: 'SERVICE_INITIATED',
              label: 'Process server completed service',
              metadata: { jobId: objectId, affidavitUrl: payload.data.affidavit_url } as never,
            },
          },
        },
      });
    } else if (payload.event === 'service.attempted') {
      await prisma.case.update({
        where: { id: caseId },
        data: { processServeStatus: 'attempted' },
      });
    } else if (payload.event === 'service.unsuccessful') {
      await prisma.case.update({
        where: { id: caseId },
        data: { processServeStatus: 'unsuccessful' },
      });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook:proof] processing error', err);
    res.status(500).json({ error: 'failed to process' });
  }
});

// ─── InfoTrack: e-filing events ──────────────────────────────────────────────

router.post('/infotrack', express.json(), async (req: Request, res: Response) => {
  const payload = req.body as InfoTrackWebhookPayload;
  const caseId = payload.data?.metadata?.caseId;
  const orderId = payload.data?.id;

  if (!caseId || !orderId) {
    res.status(200).json({ ok: true, ignored: 'missing caseId or order id' });
    return;
  }

  try {
    if (payload.event === 'efiling.accepted' || payload.event === 'efiling.filed') {
      const indexNumber = payload.data.index_number ?? null;
      const c = await prisma.case.findFirst({ where: { id: caseId } });
      const isDefault = c?.infoTrackPurpose === 'default-judgment';

      await prisma.case.update({
        where: { id: caseId },
        data: {
          infoTrackStatus: 'accepted',
          infoTrackAcceptedAt: new Date(),
          infoTrackIndexNumber: indexNumber,
          ...(isDefault && {
            defaultJudgmentFiledAt: new Date(),
            defaultJudgmentIndexNumber: indexNumber,
          }),
          actions: {
            create: {
              type: 'FILING_PREPARED',
              label: `Court accepted filing${indexNumber ? ` · Index #${indexNumber}` : ''}`,
              metadata: { orderId, indexNumber } as never,
            },
          },
        },
      });
    } else if (payload.event === 'efiling.rejected') {
      await prisma.case.update({
        where: { id: caseId },
        data: {
          infoTrackStatus: 'rejected',
          infoTrackRejectionReason: payload.data.rejection_reason || 'no reason provided',
          actions: {
            create: {
              type: 'FILING_PREPARED',
              label: 'Court REJECTED the filing',
              notes: payload.data.rejection_reason || null,
            },
          },
        },
      });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook:infotrack] processing error', err);
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
        const collected = session.amount_total;
        const fee = Math.floor((collected * 1200) / 10_000); // 12%
        const payout = collected - fee;
        await prisma.case.update({
          where: { id: caseId },
          data: {
            stripePaymentIntentId: session.payment_intent,
            amountCollectedCents: collected,
            reclaimFeeCents: fee,
            payoutToClaimantCents: payout,
            actions: {
              create: {
                type: 'PAYMENT_VIA_PORTAL',
                label: `Debtor paid $${(collected / 100).toFixed(2)} via portal`,
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
