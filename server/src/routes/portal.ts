/**
 * Public defendant response portal — no authentication required, the magic
 * link token IS the authentication.
 *
 * Routes:
 *   GET  /api/portal/:token              — sanitized case view for debtor
 *   POST /api/portal/:token/dispute      — debtor files a dispute
 *   POST /api/portal/:token/propose-plan — debtor proposes a payment plan
 *   POST /api/portal/:token/checkout     — Stripe Checkout session for payment
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { createDebtorCheckoutSession } from '../services/stripe';
import { cancelFollowUpForCase } from '../jobs/followUpScheduler';

const router = Router();

interface PortalCase {
  id: string;
  status: string;
  claimantName: string;
  claimantBusiness: string | null;
  amountOwed: string | null;
  serviceDescription: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  paymentDueDate: Date | null;
  hasWrittenContract: boolean;
  // What's already happened
  alreadyPaid: boolean;
  disputed: boolean;
  proposedPlan: unknown;
}

async function loadCaseByToken(token: string) {
  const c = await prisma.case.findUnique({
    where: { portalToken: token },
  });
  if (!c) return null;
  if (c.portalTokenExpiresAt && c.portalTokenExpiresAt < new Date()) return null;
  return c;
}

function sanitize(c: NonNullable<Awaited<ReturnType<typeof loadCaseByToken>>>): PortalCase {
  return {
    id: c.id,
    status: c.status,
    claimantName: c.claimantName || c.claimantBusiness || 'Claimant',
    claimantBusiness: c.claimantBusiness,
    amountOwed: c.amountOwed?.toString() ?? null,
    serviceDescription: c.serviceDescription,
    invoiceNumber: c.invoiceNumber,
    invoiceDate: c.invoiceDate,
    paymentDueDate: c.paymentDueDate,
    hasWrittenContract: c.hasWrittenContract,
    alreadyPaid: !!c.amountCollectedCents && c.amountCollectedCents > 0,
    disputed: !!c.defendantDisputeText,
    proposedPlan: c.defendantProposedPlan,
  };
}

// ─── GET case info ───────────────────────────────────────────────────────────

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });

    // log the view
    await prisma.case.update({
      where: { id: c.id },
      data: {
        portalLastViewedAt: new Date(),
        actions: { create: { type: 'PORTAL_VIEWED', label: 'Debtor viewed portal' } },
      },
    });

    return res.json(sanitize(c));
  } catch (err) {
    console.error('portal GET error:', err);
    return res.status(500).json({ error: 'Failed to load case' });
  }
});

// ─── POST dispute ────────────────────────────────────────────────────────────

const disputeSchema = z.object({
  reason: z.string().min(10).max(5000),
});

router.post('/:token/dispute', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });

    const { reason } = disputeSchema.parse(req.body);

    await prisma.case.update({
      where: { id: c.id },
      data: {
        defendantDisputeText: reason,
        actions: {
          create: {
            type: 'DISPUTE_FILED',
            label: 'Debtor disputed the claim',
            notes: reason.slice(0, 500),
          },
        },
      },
    });

    // Stop auto follow-ups: dispute filed, claim now needs human review
    cancelFollowUpForCase(c.id).catch(() => { /* non-blocking */ });

    return res.json({ ok: true });
  } catch (err) {
    console.error('portal dispute error:', err);
    return res.status(500).json({ error: 'Failed to file dispute' });
  }
});

// ─── POST propose payment plan ───────────────────────────────────────────────

const proposePlanSchema = z.object({
  monthlyAmount: z.number().positive(),
  numberOfPayments: z.number().int().min(2).max(36),
  startDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

router.post('/:token/propose-plan', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });

    const plan = proposePlanSchema.parse(req.body);

    await prisma.case.update({
      where: { id: c.id },
      data: {
        defendantProposedPlan: plan as never,
        actions: {
          create: {
            type: 'PAYMENT_PLAN_PROPOSED',
            label: `Debtor proposed payment plan: $${plan.monthlyAmount}/mo × ${plan.numberOfPayments}`,
            metadata: plan as never,
          },
        },
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('portal propose-plan error:', err);
    return res.status(500).json({ error: 'Failed to propose plan' });
  }
});

// ─── POST checkout (Stripe) ──────────────────────────────────────────────────

router.post('/:token/checkout', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });
    if (!c.amountOwed) return res.status(400).json({ error: 'Case has no amount owed' });

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
    const result = await createDebtorCheckoutSession({
      amountCents: Math.round(Number(c.amountOwed) * 100),
      caseId: c.id,
      debtorEmail: c.debtorEmail || undefined,
      description: `Payment for ${c.claimantBusiness || c.claimantName || 'Claimant'} — Case ${c.id.slice(0, 8)}`,
      successUrl: `${baseUrl}/respond/paid`,
      cancelUrl: `${baseUrl}/respond/${req.params.token}`,
    });

    return res.json(result);
  } catch (err) {
    console.error('portal checkout error:', err);
    return res.status(500).json({ error: 'Failed to start checkout' });
  }
});

export default router;
