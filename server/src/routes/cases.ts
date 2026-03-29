import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { synthesizeCase, generateDemandLetter, generateFinalNotice, generateCourtForm, verifyCourtForm, retryCourtForm, generateDefaultJudgment } from '../services/claude';
import { requireAuth } from '../middleware/auth';
import { lookupACRIS } from '../services/acris';
import { lookupNYCourtHistory } from '../services/nycourts';
import { lookupNYSEntity } from '../services/nysEntity';
import { lookupNYSUCC } from '../services/nysUCC';
import { lookupNYCECB } from '../services/nycECB';

const router = Router();

// All case routes require authentication
router.use(requireAuth);

// ─── Validation schemas ───────────────────────────────────────────────────────

const createCaseSchema = z.object({
  title: z.string().optional(),
  claimantName: z.string().optional(),
  claimantBusiness: z.string().optional(),
  claimantAddress: z.string().optional(),
  claimantEmail: z.string().email().optional().or(z.literal('')),
  claimantPhone: z.string().optional(),
  debtorName: z.string().optional(),
  debtorBusiness: z.string().optional(),
  debtorAddress: z.string().optional(),
  debtorEmail: z.string().email().optional().or(z.literal('')),
  debtorPhone: z.string().optional(),
  debtorEntityType: z.string().optional(),
  amountOwed: z.number().positive().optional(),
  amountPaid: z.number().min(0).optional(),
  serviceDescription: z.string().optional(),
  agreementDate: z.string().optional(),
  serviceStartDate: z.string().optional(),
  serviceEndDate: z.string().optional(),
  invoiceDate: z.string().optional(),
  paymentDueDate: z.string().optional(),
  hasWrittenContract: z.boolean().optional(),
  invoiceNumber: z.string().optional(),
  industry: z.string().optional(),
  notes: z.string().optional(),
});

const updateCaseSchema = createCaseSchema.partial();

const strategySchema = z.object({
  strategy: z.enum(['QUICK_ESCALATION', 'STANDARD_RECOVERY', 'GRADUAL_APPROACH']),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: string | undefined): Date | undefined {
  if (!val) return undefined;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/cases
router.get('/', async (req: Request, res: Response) => {
  try {
    const cases = await prisma.case.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: { select: { id: true, originalName: true, classification: true } },
        actions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    res.json(cases);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// POST /api/cases
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = createCaseSchema.parse(req.body);

    const title =
      data.title ||
      (data.debtorBusiness || data.debtorName || 'Unknown Debtor') +
        (data.amountOwed ? ` — $${data.amountOwed.toLocaleString()}` : '');

    const newCase = await prisma.case.create({
      data: {
        title,
        claimantName: data.claimantName,
        claimantBusiness: data.claimantBusiness,
        claimantAddress: data.claimantAddress,
        claimantEmail: data.claimantEmail || undefined,
        claimantPhone: data.claimantPhone,
        debtorName: data.debtorName,
        debtorBusiness: data.debtorBusiness,
        debtorAddress: data.debtorAddress,
        debtorEmail: data.debtorEmail || undefined,
        debtorPhone: data.debtorPhone,
        debtorEntityType: data.debtorEntityType,
        amountOwed: data.amountOwed,
        amountPaid: data.amountPaid,
        serviceDescription: data.serviceDescription,
        agreementDate: parseDate(data.agreementDate),
        serviceStartDate: parseDate(data.serviceStartDate),
        serviceEndDate: parseDate(data.serviceEndDate),
        invoiceDate: parseDate(data.invoiceDate),
        paymentDueDate: parseDate(data.paymentDueDate),
        hasWrittenContract: data.hasWrittenContract ?? false,
        invoiceNumber: data.invoiceNumber,
        notes: data.notes,
        status: 'ASSEMBLING',
        userId: req.user!.id,
        actions: {
          create: {
            type: 'CASE_CREATED',
            status: 'COMPLETED',
            label: 'Case created',
          },
        },
      },
      include: { documents: true, actions: true },
    });

    res.status(201).json(newCase);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Failed to create case' });
    }
  }
});

// GET /api/cases/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        documents: { orderBy: { uploadedAt: 'desc' } },
        actions: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!caseData) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    res.json(caseData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch case' });
  }
});

// PATCH /api/cases/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const data = updateCaseSchema.parse(req.body);

    const updated = await prisma.case.update({
      where: { id: req.params.id, userId: req.user!.id },
      data: {
        ...data,
        claimantEmail: data.claimantEmail || undefined,
        debtorEmail: data.debtorEmail || undefined,
        amountOwed: data.amountOwed,
        amountPaid: data.amountPaid,
        agreementDate: parseDate(data.agreementDate),
        serviceStartDate: parseDate(data.serviceStartDate),
        serviceEndDate: parseDate(data.serviceEndDate),
        invoiceDate: parseDate(data.invoiceDate),
        paymentDueDate: parseDate(data.paymentDueDate),
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Failed to update case' });
    }
  }
});

// POST /api/cases/:id/reset-analysis — clear AI results so analysis can be re-run
router.post('/:id/reset-analysis', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.case.update({
      where: { id: req.params.id, userId: req.user!.id },
      data: {
        status: 'ASSEMBLING',
        caseStrength: null,
        caseSummary: null,
        missingInfo: [],
        caseTimeline: [],
        evidenceSummary: null as never,
        extractedFacts: null as never,
        caseAssessment: null as never,
        // Preserve: strategy, demandLetter, finalNotice, filingPacket
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset analysis' });
  }
});

// POST /api/cases/:id/analyze  — run AI synthesis across all uploaded docs
router.post('/:id/analyze', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      include: { documents: true },
    });

    if (!caseData) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    // Update status to ANALYZING
    await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'ANALYZING' },
    });

    const docInputs = caseData.documents.map((d) => ({
      originalName: d.originalName,
      classification: d.classification,
      extractedFacts: d.extractedFacts as Record<string, unknown> | null,
      supportsTags: d.supportsTags,
      summary: d.summary,
    }));

    const userFacts = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      claimantAddress: caseData.claimantAddress,
      claimantPhone: caseData.claimantPhone,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      debtorPhone: caseData.debtorPhone,
      debtorEntityType: caseData.debtorEntityType,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      serviceDescription: caseData.serviceDescription,
      invoiceNumber: caseData.invoiceNumber,
      hasWrittenContract: caseData.hasWrittenContract,
      agreementDate: caseData.agreementDate?.toISOString(),
      invoiceDate: caseData.invoiceDate?.toISOString(),
      paymentDueDate: caseData.paymentDueDate?.toISOString(),
      serviceStartDate: caseData.serviceStartDate?.toISOString(),
      serviceEndDate: caseData.serviceEndDate?.toISOString(),
      industry: caseData.industry,
    };

    const synthesis = await synthesizeCase(docInputs, userFacts);

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        status: 'STRATEGY_PENDING',
        caseTimeline: synthesis.timeline,
        caseSummary: synthesis.caseSummary,
        missingInfo: synthesis.missingInfo as never,
        caseStrength: synthesis.caseStrength,
        evidenceSummary: synthesis.evidenceSummary as never,
        extractedFacts: synthesis.extractedFacts as never,
        caseAssessment: synthesis.caseAssessment as never,
        // Auto-fill missing fields from AI extraction
        debtorAddress:
          caseData.debtorAddress ||
          (synthesis.extractedFacts as Record<string, string>)?.debtorAddress ||
          undefined,
        // Auto-fill more missing fields from AI extraction
        ...((() => {
          const f = synthesis.extractedFacts as Record<string, string | boolean | number | null>;
          const safeDate = (v: unknown) => { if (!v || typeof v !== 'string') return undefined; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; };
          return {
            debtorName: caseData.debtorName || (f?.debtorName as string) || undefined,
            debtorBusiness: caseData.debtorBusiness || (f?.debtorBusiness as string) || undefined,
            claimantName: caseData.claimantName || (f?.claimantName as string) || undefined,
            claimantBusiness: caseData.claimantBusiness || (f?.claimantBusiness as string) || undefined,
            amountOwed: caseData.amountOwed ?? (f?.amountOwed != null ? Number(f.amountOwed) : undefined),
            invoiceDate: caseData.invoiceDate ?? safeDate(f?.invoiceDate),
            agreementDate: caseData.agreementDate ?? safeDate(f?.agreementDate),
            paymentDueDate: caseData.paymentDueDate ?? safeDate(f?.paymentDueDate),
            invoiceNumber: caseData.invoiceNumber || (f?.invoiceNumber as string) || undefined,
          };
        })()),
        actions: {
          create: {
            type: 'AI_ANALYSIS_COMPLETED',
            status: 'COMPLETED',
            label: 'AI case analysis completed',
            metadata: { caseStrength: synthesis.caseStrength, documentCount: docInputs.length },
          },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    console.error('Analysis error:', err);
    await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'ASSEMBLING' },
    }).catch(() => {});
    res.status(500).json({ error: 'Analysis failed', details: String(err) });
  }
});

// POST /api/cases/:id/strategy
router.post('/:id/strategy', async (req: Request, res: Response) => {
  try {
    const { strategy } = strategySchema.parse(req.body);

    const updated = await prisma.case.update({
      where: { id: req.params.id, userId: req.user!.id },
      data: {
        strategy,
        status: 'STRATEGY_SELECTED',
        actions: {
          create: {
            type: 'STRATEGY_SELECTED',
            status: 'COMPLETED',
            label: `Strategy set: ${strategy.replace(/_/g, ' ').toLowerCase()}`,
          },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid strategy' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Failed to set strategy' });
    }
  }
});

// POST /api/cases/:id/generate — generate demand letter
router.post('/:id/generate', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      include: { documents: { select: { classification: true, supportsTags: true, summary: true } } },
    });

    if (!caseData) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    if (!caseData.strategy) {
      res.status(400).json({ error: 'Strategy must be selected before generating letter' });
      return;
    }

    await prisma.case.update({ where: { id: req.params.id }, data: { status: 'GENERATING' } });

    const caseContext = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      claimantAddress: caseData.claimantAddress,
      claimantEmail: caseData.claimantEmail,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      serviceDescription: caseData.serviceDescription,
      invoiceNumber: caseData.invoiceNumber,
      agreementDate: caseData.agreementDate?.toISOString().split('T')[0],
      serviceStartDate: caseData.serviceStartDate?.toISOString().split('T')[0],
      serviceEndDate: caseData.serviceEndDate?.toISOString().split('T')[0],
      invoiceDate: caseData.invoiceDate?.toISOString().split('T')[0],
      paymentDueDate: caseData.paymentDueDate?.toISOString().split('T')[0],
      hasWrittenContract: caseData.hasWrittenContract,
      extractedFacts: caseData.extractedFacts,
      evidenceSummary: caseData.evidenceSummary,
      timeline: caseData.caseTimeline,
      documentTypes: caseData.documents.map((d) => d.classification).filter(Boolean),
    };

    const result = await generateDemandLetter(
      caseContext as Record<string, unknown>,
      caseData.strategy as 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH'
    );

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        status: 'READY',
        demandLetter: result.text,
        demandLetterHtml: result.html,
        actions: {
          create: {
            type: 'DEMAND_LETTER_GENERATED',
            status: 'COMPLETED',
            label: 'Demand letter generated',
          },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    console.error('Letter generation error:', err);
    await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'STRATEGY_SELECTED' },
    }).catch(() => {});
    res.status(500).json({ error: 'Letter generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/actions — log a manual action
router.post('/:id/actions', async (req: Request, res: Response) => {
  try {
    const { type, notes, metadata } = req.body;

    // Verify case ownership
    const caseData = await prisma.case.findUnique({ where: { id: req.params.id, userId: req.user!.id } });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const action = await prisma.caseAction.create({
      data: {
        caseId: req.params.id,
        type,
        status: 'COMPLETED',
        label: notes || type,
        notes,
        metadata,
      },
    });

    // Update case status if relevant
    const statusMap: Record<string, string> = {
      EMAIL_SENT: 'SENT',
      CERTIFIED_MAIL_SENT: 'SENT',
      REMINDER_SENT: 'AWAITING_RESPONSE',
      FINAL_NOTICE_SENT: 'ESCALATING',
      PAYMENT_RECEIVED: 'RESOLVED',
      CASE_CLOSED: 'CLOSED',
    };

    if (statusMap[type]) {
      await prisma.case.update({
        where: { id: req.params.id, userId: req.user!.id },
        data: { status: statusMap[type] as never },
      });
    }

    // When payment received with amount, update amountPaid
    if (type === 'PAYMENT_RECEIVED' && metadata?.amount) {
      const paymentAmount = parseFloat(String(metadata.amount));
      if (!isNaN(paymentAmount) && paymentAmount > 0) {
        const existing = await prisma.case.findUnique({ where: { id: req.params.id } });
        if (existing) {
          const newPaid = Number(existing.amountPaid || 0) + paymentAmount;
          await prisma.case.update({
            where: { id: req.params.id },
            data: { amountPaid: newPaid },
          });
        }
      }
    }

    res.status(201).json(action);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log action' });
  }
});

// GET /api/cases/:id/acris — ACRIS NYC property lookup for debtor
router.get('/:id/acris', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { debtorBusiness: true, debtorName: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const partyName = caseData.debtorBusiness || caseData.debtorName;
    if (!partyName) {
      res.status(400).json({ error: 'No debtor name on file — add debtor information first' });
      return;
    }

    const result = await lookupACRIS(partyName);
    res.json(result);
  } catch (err) {
    console.error('ACRIS lookup error:', err);
    res.status(500).json({ error: 'ACRIS lookup failed', details: String(err) });
  }
});

// GET /api/cases/:id/court-history — NYC Civil Court prior case lookup for debtor
router.get('/:id/court-history', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { debtorBusiness: true, debtorName: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const partyName = caseData.debtorBusiness || caseData.debtorName;
    if (!partyName) {
      res.status(400).json({ error: 'No debtor name on file — add debtor information first' });
      return;
    }

    const result = await lookupNYCourtHistory(partyName);
    res.json(result);
  } catch (err) {
    console.error('Court history lookup error:', err);
    res.status(500).json({ error: 'Court history lookup failed', details: String(err) });
  }
});

// GET /api/cases/:id/nys-entity — NYS DOS entity lookup for debtor
router.get('/:id/nys-entity', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { debtorBusiness: true, debtorName: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const entityName = caseData.debtorBusiness || caseData.debtorName;
    if (!entityName) {
      res.status(400).json({ error: 'No debtor business or name on file — add debtor information first' });
      return;
    }

    const result = await lookupNYSEntity(entityName);
    res.json(result);
  } catch (err) {
    console.error('NYS entity lookup error:', err);
    res.status(500).json({ error: 'NYS entity lookup failed', details: String(err) });
  }
});

// GET /api/cases/:id/ucc-filings — NYS UCC secured creditor search for debtor
router.get('/:id/ucc-filings', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { debtorBusiness: true, debtorName: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const debtorName = caseData.debtorBusiness || caseData.debtorName;
    if (!debtorName) {
      res.status(400).json({ error: 'No debtor name on file — add debtor information first' });
      return;
    }

    const result = await lookupNYSUCC(debtorName);
    res.json(result);
  } catch (err) {
    console.error('UCC lookup error:', err);
    res.status(500).json({ error: 'UCC lookup failed', details: String(err) });
  }
});

// GET /api/cases/:id/ecb-violations — NYC ECB/OATH violation lookup for debtor
router.get('/:id/ecb-violations', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { debtorBusiness: true, debtorName: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const partyName = caseData.debtorBusiness || caseData.debtorName;
    if (!partyName) {
      res.status(400).json({ error: 'No debtor name on file' });
      return;
    }

    const result = await lookupNYCECB(partyName);
    res.json(result);
  } catch (err) {
    console.error('ECB lookup error:', err);
    res.status(500).json({ error: 'ECB lookup failed', details: String(err) });
  }
});

// DELETE /api/cases/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.case.delete({ where: { id: req.params.id, userId: req.user!.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

// POST /api/cases/:id/final-notice
router.post('/:id/final-notice', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      invoiceNumber: caseData.invoiceNumber,
      serviceDescription: caseData.serviceDescription,
      paymentDueDate: caseData.paymentDueDate?.toISOString().split('T')[0],
      demandLetterSent: !!caseData.demandLetter,
    };

    const result = await generateFinalNotice(context as Record<string, unknown>);

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        finalNotice: result.text,
        finalNoticeHtml: result.html,
        status: 'ESCALATING',
        actions: {
          create: { type: 'FINAL_NOTICE_GENERATED', status: 'COMPLETED', label: 'Final notice generated' },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    console.error('Final notice error:', err);
    res.status(500).json({ error: 'Final notice generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/court-form
router.post('/:id/court-form', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    // Determine track from outstanding balance
    const amountOwed = Number(caseData.amountOwed || 0);
    const amountPaid = Number(caseData.amountPaid || 0);
    const outstanding = amountOwed - amountPaid;

    let track: 'commercial' | 'civil' | 'supreme';
    if (outstanding <= 10000) {
      track = 'commercial';
    } else if (outstanding <= 50000) {
      track = 'civil';
    } else {
      track = 'supreme';
    }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      claimantAddress: caseData.claimantAddress,
      claimantEmail: caseData.claimantEmail,
      claimantPhone: caseData.claimantPhone,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      debtorPhone: caseData.debtorPhone,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      outstandingBalance: outstanding.toFixed(2),
      serviceDescription: caseData.serviceDescription,
      invoiceNumber: caseData.invoiceNumber,
      agreementDate: caseData.agreementDate?.toISOString().split('T')[0],
      invoiceDate: caseData.invoiceDate?.toISOString().split('T')[0],
      paymentDueDate: caseData.paymentDueDate?.toISOString().split('T')[0],
      hasWrittenContract: caseData.hasWrittenContract,
      extractedFacts: caseData.extractedFacts,
    };

    const GENERATION_FAILED_MARKER = 'Form generation failed';

    // ── Pass 1: Generate ──────────────────────────────────────────────────────
    let form = await generateCourtForm(context as Record<string, unknown>, track);

    // ── Pass 1b: Retry generation if it produced an error fallback ────────────
    // This is a generation failure (JSON parse/truncation), not a content issue.
    // Don't send an error message into the verify pipeline — retry generation directly.
    if (form.html.includes(GENERATION_FAILED_MARKER)) {
      console.log(`Court form generation failed on first attempt — retrying generation (case ${req.params.id})`);
      form = await generateCourtForm(context as Record<string, unknown>, track);
    }

    // If both generation attempts failed, save the error state and return early
    if (form.html.includes(GENERATION_FAILED_MARKER)) {
      console.error(`Court form generation failed on both attempts (case ${req.params.id})`);
      const updated = await prisma.case.update({
        where: { id: req.params.id },
        data: {
          filingPacketHtml: form.html,
          filingPacket: form.formType,
          courtFormType: form.formType,
          courtFormInstructions: form.instructions as never,
          courtFormVerification: {
            overallStatus: 'issues_found',
            checks: [],
            summary: 'Form generation failed after two attempts. This is usually a temporary issue — please try again.',
            blankFields: [],
            verifiedAt: new Date().toISOString(),
            didRetry: false,
            generationFailed: true,
          } as never,
          actions: {
            create: { type: 'COURT_FORM_GENERATED', status: 'FAILED', label: 'Court form generation failed' },
          },
        },
        include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
      });
      res.json(updated);
      return;
    }

    // ── Pass 2: Verify ────────────────────────────────────────────────────────
    let verification = await verifyCourtForm(form.html, context as Record<string, unknown>);
    let didRetry = false;

    // ── Pass 3: Retry once if hard issues found ───────────────────────────────
    // Only retry on 'issues_found' (mismatch / hallucination). 'review_needed' means
    // missing data — retrying won't fix that, it's a data gap on the case.
    if (verification.overallStatus === 'issues_found') {
      console.log(`Court form verification: issues_found — retrying with corrections (case ${req.params.id})`);
      const retried = await retryCourtForm(
        form.html,
        verification,
        context as Record<string, unknown>,
        track,
        form.formType
      );
      // Verify the retry result — one final check, no further retries
      const retryVerification = await verifyCourtForm(retried.html, context as Record<string, unknown>);
      form = retried;
      verification = retryVerification;
      didRetry = true;
    }

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        filingPacketHtml: form.html,
        filingPacket: form.formType,
        courtFormType: form.formType,
        courtFormInstructions: form.instructions as never,
        courtFormVerification: { ...verification, didRetry } as never,
        actions: {
          create: {
            type: 'COURT_FORM_GENERATED',
            status: 'COMPLETED',
            label: `Court form generated: ${form.formType}${didRetry ? ' (auto-corrected)' : ''}`,
            metadata: { overallStatus: verification.overallStatus, didRetry },
          },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    console.error('Court form error:', err);
    res.status(500).json({ error: 'Court form generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/default-judgment
router.post('/:id/default-judgment', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      claimantAddress: caseData.claimantAddress,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      outstandingBalance: (Number(caseData.amountOwed || 0) - Number(caseData.amountPaid || 0)).toFixed(2),
      serviceDescription: caseData.serviceDescription,
      invoiceNumber: caseData.invoiceNumber,
      agreementDate: caseData.agreementDate?.toISOString().split('T')[0],
      invoiceDate: caseData.invoiceDate?.toISOString().split('T')[0],
      paymentDueDate: caseData.paymentDueDate?.toISOString().split('T')[0],
      courtFormType: caseData.courtFormType,
      demandLetterSent: !!caseData.demandLetter,
      finalNoticeSent: !!caseData.finalNotice,
    };

    const result = await generateDefaultJudgment(context as Record<string, unknown>);

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        defaultJudgment: result.text,
        defaultJudgmentHtml: result.html,
        actions: {
          create: { type: 'DEFAULT_JUDGMENT_GENERATED', status: 'COMPLETED', label: 'Default judgment motion generated' },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    console.error('Default judgment error:', err);
    res.status(500).json({ error: 'Default judgment generation failed', details: String(err) });
  }
});

export default router;
