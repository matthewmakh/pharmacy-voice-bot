/**
 * Attorney handoff flow — creditor-side endpoints (auth required).
 *
 * Routes:
 *   GET  /api/cases/:id/handoff/package          — preview the case package
 *   POST /api/cases/:id/handoff/generate-docs    — generate post-judgment doc drafts
 *   POST /api/cases/:id/handoff/initiate         — send the case to a partner attorney
 *
 * Plus AttorneyPartner CRUD on /api/handoff/partners
 *
 * The partner-facing portal lives in routes/attorney.ts (no auth, magic link).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { sendEmail } from '../services/resend';
import {
  generateInformationSubpoena,
  generateRestrainingNotice,
  generatePropertyExecution,
  generateIncomeExecution,
  generateMarshalRequest,
} from '../services/postJudgmentDocs';

const router = Router();
router.use(requireAuth);

// ─── AttorneyPartner CRUD ────────────────────────────────────────────────────

const partnerSchema = z.object({
  name: z.string().min(1),
  firmName: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  barNumber: z.string().optional(),
  state: z.string().default('NY'),
  notes: z.string().optional(),
  referralFeePercent: z.number().min(0).max(100).default(20),
});

router.get('/partners', async (req: Request, res: Response) => {
  try {
    const partners = await prisma.attorneyPartner.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(partners);
  } catch (err) {
    console.error('list partners error:', err);
    return res.status(500).json({ error: 'Failed to list partners' });
  }
});

router.post('/partners', async (req: Request, res: Response) => {
  try {
    const data = partnerSchema.parse(req.body);
    const partner = await prisma.attorneyPartner.create({
      data: { ...data, userId: req.user!.id },
    });
    return res.json(partner);
  } catch (err) {
    console.error('create partner error:', err);
    return res.status(500).json({ error: 'Failed to create partner', details: String(err) });
  }
});

router.patch('/partners/:id', async (req: Request, res: Response) => {
  try {
    const data = partnerSchema.partial().parse(req.body);
    const existing = await prisma.attorneyPartner.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) return res.status(404).json({ error: 'Partner not found' });
    const partner = await prisma.attorneyPartner.update({
      where: { id: req.params.id },
      data,
    });
    return res.json(partner);
  } catch (err) {
    console.error('update partner error:', err);
    return res.status(500).json({ error: 'Failed to update partner' });
  }
});

// ─── Generate post-judgment doc drafts ───────────────────────────────────────

const generateDocsSchema = z.object({
  docs: z.array(z.enum(['information-subpoena', 'restraining-notice', 'property-execution', 'income-execution', 'marshal-request'])).min(1),
});

router.post('/cases/:id/handoff/generate-docs', async (req: Request, res: Response) => {
  try {
    const { docs } = generateDocsSchema.parse(req.body);
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const data = c as Record<string, unknown>;
    const updates: Record<string, string> = {};

    for (const doc of docs) {
      if (doc === 'information-subpoena') {
        const r = await generateInformationSubpoena(data);
        updates.informationSubpoenaHtml = r.html;
      } else if (doc === 'restraining-notice') {
        const r = await generateRestrainingNotice(data);
        updates.restrainingNoticeHtml = r.html;
      } else if (doc === 'property-execution') {
        const r = await generatePropertyExecution(data);
        updates.propertyExecutionHtml = r.html;
      } else if (doc === 'income-execution') {
        const r = await generateIncomeExecution(data);
        updates.incomeExecutionHtml = r.html;
      } else if (doc === 'marshal-request') {
        const r = await generateMarshalRequest(data);
        updates.marshalRequestHtml = r.html;
      }
    }

    const updated = await prisma.case.update({
      where: { id: c.id },
      data: {
        ...updates,
        actions: {
          create: {
            type: 'FILING_PREPARED',
            label: `Post-judgment drafts generated: ${docs.join(', ')}`,
          },
        },
      },
      include: { actions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    return res.json({ case: updated });
  } catch (err) {
    console.error('generate-docs error:', err);
    return res.status(500).json({ error: 'Failed to generate docs', details: String(err) });
  }
});

// ─── Package preview ─────────────────────────────────────────────────────────

router.get('/cases/:id/handoff/package', async (req: Request, res: Response) => {
  try {
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { actions: { orderBy: { createdAt: 'asc' } }, documents: true },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    return res.json({
      caseId: c.id,
      summary: {
        claimant: c.claimantBusiness || c.claimantName,
        debtor: c.debtorBusiness || c.debtorName,
        amountOwed: c.amountOwed,
        amountPaid: c.amountPaid,
        invoiceNumber: c.invoiceNumber,
        invoiceDate: c.invoiceDate,
        agreementDate: c.agreementDate,
        serviceDescription: c.serviceDescription,
        hasWrittenContract: c.hasWrittenContract,
        notes: c.notes,
      },
      preTrial: {
        demandLetter: !!c.demandLetterHtml,
        finalNotice: !!c.finalNoticeHtml,
        courtForm: !!c.filingPacketHtml,
        affidavitOfService: !!c.affidavitOfServiceHtml,
        scraAffidavit: !!c.scraAffidavitHtml,
        defaultJudgment: !!c.defaultJudgmentHtml,
        settlement: !!c.settlementHtml,
        paymentPlan: !!c.paymentPlanHtml,
      },
      postJudgmentDrafts: {
        informationSubpoena: !!c.informationSubpoenaHtml,
        restrainingNotice: !!c.restrainingNoticeHtml,
        propertyExecution: !!c.propertyExecutionHtml,
        incomeExecution: !!c.incomeExecutionHtml,
        marshalRequest: !!c.marshalRequestHtml,
      },
      investigation: {
        acris: !!c.acrisResult,
        nysEntity: !!c.entityResult,
        ucc: !!c.uccResult,
        ecb: !!c.ecbResult,
        courtHistory: !!c.courtHistory,
        pacer: !!c.pacerResult,
      },
      timeline: c.actions.map((a) => ({
        type: a.type,
        label: a.label,
        notes: a.notes,
        createdAt: a.createdAt,
      })),
      documents: c.documents.map((d) => ({
        id: d.id,
        name: d.originalName,
        classification: d.classification,
      })),
      handoff: {
        status: c.attorneyHandoffStatus,
        partnerId: c.attorneyPartnerId,
        initiatedAt: c.attorneyHandoffInitiatedAt,
        token: c.attorneyHandoffToken,
        notes: c.attorneyHandoffNotes,
      },
    });
  } catch (err) {
    console.error('handoff package error:', err);
    return res.status(500).json({ error: 'Failed to build package' });
  }
});

// ─── Initiate handoff ────────────────────────────────────────────────────────

const initiateSchema = z.object({
  attorneyPartnerId: z.string(),
  notes: z.string().optional(),
});

router.post('/cases/:id/handoff/initiate', async (req: Request, res: Response) => {
  try {
    const { attorneyPartnerId, notes } = initiateSchema.parse(req.body);

    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const partner = await prisma.attorneyPartner.findFirst({
      where: { id: attorneyPartnerId, userId: req.user!.id },
    });
    if (!partner) return res.status(404).json({ error: 'Partner attorney not found' });

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

    const updated = await prisma.case.update({
      where: { id: c.id },
      data: {
        attorneyPartnerId: partner.id,
        attorneyHandoffStatus: 'pending',
        attorneyHandoffInitiatedAt: new Date(),
        attorneyHandoffToken: token,
        attorneyHandoffTokenExpiresAt: expiresAt,
        attorneyHandoffNotes: notes,
        actions: {
          create: {
            type: 'ATTORNEY_HANDOFF_INITIATED',
            label: `Case handed off to ${partner.name}${partner.firmName ? ` (${partner.firmName})` : ''}`,
            metadata: { partnerId: partner.id, partnerEmail: partner.email } as never,
          },
        },
      },
    });

    // Notify the partner attorney
    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
    const portalUrl = `${baseUrl}/attorney/${token}`;

    try {
      const claimantName = c.claimantBusiness || c.claimantName || 'A claimant';
      const debtorName = c.debtorBusiness || c.debtorName || 'a debtor';
      const amount = c.amountOwed
        ? `$${Number(c.amountOwed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        : '';

      await sendEmail({
        to: partner.email,
        subject: `New case referral from ${claimantName} — ${amount} vs ${debtorName}`,
        caseId: c.id,
        kind: 'attorney-handoff',
        replyTo: req.user!.email,
        html: `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;line-height:1.5">
<p>Hi ${partner.name},</p>
<p><strong>${claimantName}</strong> would like to refer a collections matter to you:</p>
<table style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;width:100%">
  ${amount ? `<tr><td style="padding:4px 0"><strong>Amount in dispute:</strong></td><td>${amount}</td></tr>` : ''}
  <tr><td style="padding:4px 0"><strong>Defendant:</strong></td><td>${debtorName}</td></tr>
  <tr><td style="padding:4px 0"><strong>Referral fee:</strong></td><td>${partner.referralFeePercent}% of contingency</td></tr>
</table>
${notes ? `<p><strong>Notes from claimant:</strong></p><p style="background:#f8fafc;padding:12px;border-left:3px solid #2563eb;border-radius:4px">${notes.replace(/</g, '&lt;')}</p>` : ''}
<p>The full case file (intake, demand letter, court forms, investigation results, draft post-judgment toolkit) is available at:</p>
<p style="margin:24px 0"><a href="${portalUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Review case file</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:32px">You can accept or decline directly from the case file. The link is valid for 90 days.</p>
</body></html>`,
      });
    } catch (emailErr) {
      console.warn('[handoff] notification email failed (non-blocking):', emailErr);
    }

    return res.json({ case: updated, portalUrl });
  } catch (err) {
    console.error('handoff initiate error:', err);
    return res.status(500).json({ error: 'Failed to initiate handoff', details: String(err) });
  }
});

export default router;
