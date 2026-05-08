/**
 * Public partner-attorney portal — accessed via the magic-link token sent
 * in the handoff email. No app authentication; the token IS the authentication.
 *
 * Routes:
 *   GET  /api/attorney/:token                  — sanitized case package view
 *   POST /api/attorney/:token/accept           — partner accepts the case
 *   POST /api/attorney/:token/decline          — partner declines the case
 *   POST /api/attorney/:token/report-outcome   — partner reports settlement / loss
 *   GET  /api/attorney/:token/doc/:kind        — fetch a generated doc as HTML
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';

const router = Router();

async function loadCaseByHandoffToken(token: string) {
  const c = await prisma.case.findUnique({
    where: { attorneyHandoffToken: token },
    include: {
      attorneyPartner: true,
      actions: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!c) return null;
  if (c.attorneyHandoffTokenExpiresAt && c.attorneyHandoffTokenExpiresAt < new Date()) return null;
  return c;
}

// ─── Sanitized package view ──────────────────────────────────────────────────

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByHandoffToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });

    return res.json({
      handoff: {
        status: c.attorneyHandoffStatus,
        initiatedAt: c.attorneyHandoffInitiatedAt,
        acceptedAt: c.attorneyHandoffAcceptedAt,
        resolvedAt: c.attorneyHandoffResolvedAt,
        notes: c.attorneyHandoffNotes,
        outcome: c.attorneyHandoffOutcome,
        settlementCents: c.attorneyHandoffSettlementCents,
        partner: c.attorneyPartner ? {
          name: c.attorneyPartner.name,
          firmName: c.attorneyPartner.firmName,
          referralFeePercent: c.attorneyPartner.referralFeePercent,
        } : null,
      },
      summary: {
        claimant: c.claimantBusiness || c.claimantName,
        claimantEmail: c.claimantEmail,
        debtor: c.debtorBusiness || c.debtorName,
        debtorAddress: c.debtorAddress,
        debtorEmail: c.debtorEmail,
        debtorPhone: c.debtorPhone,
        debtorEntityType: c.debtorEntityType,
        amountOwed: c.amountOwed,
        amountPaid: c.amountPaid,
        invoiceNumber: c.invoiceNumber,
        invoiceDate: c.invoiceDate,
        agreementDate: c.agreementDate,
        serviceDescription: c.serviceDescription,
        hasWrittenContract: c.hasWrittenContract,
        notes: c.notes,
      },
      preTrial: docFlags(c),
      investigation: {
        acris: c.acrisResult,
        nysEntity: c.entityResult,
        ucc: c.uccResult,
        ecb: c.ecbResult,
        courtHistory: c.courtHistory,
        pacer: c.pacerResult,
      },
      timeline: c.actions.map((a) => ({
        type: a.type,
        label: a.label,
        notes: a.notes,
        createdAt: a.createdAt,
      })),
      filingStatus: {
        defaultJudgmentFiledAt: c.defaultJudgmentFiledAt,
        defaultJudgmentFilingMethod: c.defaultJudgmentFilingMethod,
        defaultJudgmentIndexNumber: c.defaultJudgmentIndexNumber,
      },
      collected: {
        amountCollectedCents: c.amountCollectedCents,
        payoutCompletedAt: c.payoutCompletedAt,
      },
    });
  } catch (err) {
    console.error('attorney portal GET error:', err);
    return res.status(500).json({ error: 'Failed to load case' });
  }
});

function docFlags(c: { [k: string]: unknown }) {
  return {
    demandLetter: !!c.demandLetterHtml,
    finalNotice: !!c.finalNoticeHtml,
    courtForm: !!c.filingPacketHtml,
    affidavitOfService: !!c.affidavitOfServiceHtml,
    scraAffidavit: !!c.scraAffidavitHtml,
    defaultJudgment: !!c.defaultJudgmentHtml,
    settlement: !!c.settlementHtml,
    paymentPlan: !!c.paymentPlanHtml,
    informationSubpoena: !!c.informationSubpoenaHtml,
    restrainingNotice: !!c.restrainingNoticeHtml,
    propertyExecution: !!c.propertyExecutionHtml,
    incomeExecution: !!c.incomeExecutionHtml,
    marshalRequest: !!c.marshalRequestHtml,
  };
}

// ─── Doc fetch ───────────────────────────────────────────────────────────────

const DOC_FIELDS: Record<string, string> = {
  'demand-letter': 'demandLetterHtml',
  'final-notice': 'finalNoticeHtml',
  'court-form': 'filingPacketHtml',
  'affidavit-of-service': 'affidavitOfServiceHtml',
  'scra-affidavit': 'scraAffidavitHtml',
  'default-judgment': 'defaultJudgmentHtml',
  'settlement': 'settlementHtml',
  'payment-plan': 'paymentPlanHtml',
  'information-subpoena': 'informationSubpoenaHtml',
  'restraining-notice': 'restrainingNoticeHtml',
  'property-execution': 'propertyExecutionHtml',
  'income-execution': 'incomeExecutionHtml',
  'marshal-request': 'marshalRequestHtml',
};

router.get('/:token/doc/:kind', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByHandoffToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });

    const field = DOC_FIELDS[req.params.kind];
    if (!field) return res.status(400).json({ error: 'Unknown doc kind' });

    const html = (c as Record<string, unknown>)[field] as string | null;
    if (!html) return res.status(404).json({ error: 'Document not generated' });

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error('attorney portal doc fetch error:', err);
    return res.status(500).json({ error: 'Failed to load doc' });
  }
});

// ─── Accept / decline ────────────────────────────────────────────────────────

router.post('/:token/accept', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByHandoffToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });
    if (c.attorneyHandoffStatus !== 'pending') {
      return res.status(400).json({ error: `Case is already ${c.attorneyHandoffStatus}` });
    }

    await prisma.case.update({
      where: { id: c.id },
      data: {
        attorneyHandoffStatus: 'accepted',
        attorneyHandoffAcceptedAt: new Date(),
        actions: {
          create: {
            type: 'ATTORNEY_HANDOFF_INITIATED',
            label: 'Partner attorney accepted the case',
          },
        },
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('attorney accept error:', err);
    return res.status(500).json({ error: 'Failed to accept' });
  }
});

const declineSchema = z.object({
  reason: z.string().optional(),
});

router.post('/:token/decline', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByHandoffToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });
    const { reason } = declineSchema.parse(req.body);

    await prisma.case.update({
      where: { id: c.id },
      data: {
        attorneyHandoffStatus: 'declined',
        attorneyHandoffOutcome: reason || null,
        actions: {
          create: {
            type: 'ATTORNEY_HANDOFF_INITIATED',
            label: 'Partner attorney declined the case',
            notes: reason || null,
          },
        },
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('attorney decline error:', err);
    return res.status(500).json({ error: 'Failed to decline' });
  }
});

// ─── Outcome reporting ───────────────────────────────────────────────────────

const reportOutcomeSchema = z.object({
  status: z.enum(['in-progress', 'resolved', 'lost']),
  settlementAmount: z.number().min(0).optional(), // dollars (will convert to cents)
  notes: z.string().optional(),
});

router.post('/:token/report-outcome', async (req: Request, res: Response) => {
  try {
    const c = await loadCaseByHandoffToken(req.params.token);
    if (!c) return res.status(404).json({ error: 'Invalid or expired link' });
    const { status, settlementAmount, notes } = reportOutcomeSchema.parse(req.body);

    const updates: Record<string, unknown> = {
      attorneyHandoffStatus: status,
      attorneyHandoffOutcome: notes || null,
    };

    if (status === 'resolved') {
      updates.attorneyHandoffResolvedAt = new Date();
      if (settlementAmount !== undefined) {
        const settlementCents = Math.round(settlementAmount * 100);
        updates.attorneyHandoffSettlementCents = settlementCents;

        // Compute referral fee: 20% (default) of attorney contingency, where
        // contingency is typically 33% of recovery. So referral ≈ 20% × 33% × settlement = ~6.6% of settlement.
        // But we record the FULL referral basis as 20% of settlement and let humans negotiate the actual transfer.
        const partner = c.attorneyPartnerId
          ? await prisma.attorneyPartner.findUnique({ where: { id: c.attorneyPartnerId } })
          : null;
        const feePercent = partner?.referralFeePercent ? Number(partner.referralFeePercent) : 20;
        // We compute 20% of the attorney's typical 33% contingency take, not 20% of settlement.
        // attorney_fee = settlement × 0.33; reclaim_fee = attorney_fee × feePercent / 100
        const attorneyContingency = Math.round(settlementCents * 0.33);
        updates.referralFeeCents = Math.round((attorneyContingency * feePercent) / 100);
      }
    }

    await prisma.case.update({
      where: { id: c.id },
      data: {
        ...updates,
        actions: {
          create: {
            type: 'ATTORNEY_HANDOFF_INITIATED',
            label: `Partner attorney updated status: ${status}${settlementAmount !== undefined ? ` ($${settlementAmount.toLocaleString()})` : ''}`,
            notes: notes || null,
          },
        },
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('attorney report-outcome error:', err);
    return res.status(500).json({ error: 'Failed to report outcome' });
  }
});

export default router;
