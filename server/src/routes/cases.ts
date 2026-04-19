import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { synthesizeCase, generateDemandLetter, generateFinalNotice, generateCourtForm, verifyCourtForm, retryCourtForm, generateDefaultJudgment, assessStrategyWithResearch, generateAffidavitOfService, generateStipulationOfSettlement, generatePaymentPlanAgreement, verifyDemandLetter, retryDemandLetter, verifyCaseSynthesis, verifyDefaultJudgment, retryDefaultJudgment, verifySettlement, retrySettlement, verifyPaymentPlan, retryPaymentPlan } from '../services/claude';
import { fillCIVSC70, htmlToPDF } from '../services/pdf';
import { requireAuth } from '../middleware/auth';
import { lookupACRIS } from '../services/acris';
import { lookupNYCourtHistory } from '../services/nycourts';
import { lookupNYSEntity } from '../services/nysEntity';
import { lookupNYSUCC } from '../services/nysUCC';
import { lookupNYCECB } from '../services/nycECB';
import { checkPACERBankruptcy } from '../services/pacer';

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
        caseAnalysisVerification: null as never,
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset analysis' });
  }
});

// Background helpers — same fire-and-forget pattern as analyzeDocumentInBackground in documents.ts

type DocInput = {
  originalName: string;
  classification: string | null;
  extractedFacts: Record<string, unknown> | null;
  supportsTags: string[];
  summary: string | null;
};

async function analyzeCaseInBackground(
  caseId: string,
  docInputs: DocInput[],
  userFacts: Record<string, unknown>,
  originalCase: { debtorAddress: string | null; debtorName: string | null; debtorBusiness: string | null; claimantName: string | null; claimantBusiness: string | null; amountOwed: { toString(): string } | null; invoiceDate: Date | null; agreementDate: Date | null; paymentDueDate: Date | null; invoiceNumber: string | null }
) {
  try {
    const synthesis = await synthesizeCase(docInputs, userFacts);
    const analysisVerification = await verifyCaseSynthesis(synthesis, docInputs, userFacts);

    const f = synthesis.extractedFacts as Record<string, string | boolean | number | null>;
    const safeDate = (v: unknown) => { if (!v || typeof v !== 'string') return undefined; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; };

    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: 'STRATEGY_PENDING',
        caseTimeline: synthesis.timeline,
        caseSummary: synthesis.caseSummary,
        missingInfo: synthesis.missingInfo as never,
        caseStrength: synthesis.caseStrength,
        evidenceSummary: synthesis.evidenceSummary as never,
        extractedFacts: synthesis.extractedFacts as never,
        caseAssessment: synthesis.caseAssessment as never,
        caseAnalysisVerification: analysisVerification as never,
        debtorAddress: originalCase.debtorAddress || (f?.debtorAddress as string) || undefined,
        debtorName: originalCase.debtorName || (f?.debtorName as string) || undefined,
        debtorBusiness: originalCase.debtorBusiness || (f?.debtorBusiness as string) || undefined,
        claimantName: originalCase.claimantName || (f?.claimantName as string) || undefined,
        claimantBusiness: originalCase.claimantBusiness || (f?.claimantBusiness as string) || undefined,
        amountOwed: originalCase.amountOwed != null ? Number(originalCase.amountOwed.toString()) : (f?.amountOwed != null ? Number(f.amountOwed) : undefined),
        invoiceDate: originalCase.invoiceDate ?? safeDate(f?.invoiceDate),
        agreementDate: originalCase.agreementDate ?? safeDate(f?.agreementDate),
        paymentDueDate: originalCase.paymentDueDate ?? safeDate(f?.paymentDueDate),
        invoiceNumber: originalCase.invoiceNumber || (f?.invoiceNumber as string) || undefined,
        actions: {
          create: {
            type: 'AI_ANALYSIS_COMPLETED',
            status: 'COMPLETED',
            label: 'AI case analysis completed',
            metadata: { caseStrength: synthesis.caseStrength, documentCount: docInputs.length },
          },
        },
      },
    });
  } catch (err) {
    console.error(`Background analysis failed for case ${caseId}:`, err);
    await prisma.case.update({
      where: { id: caseId },
      data: { status: 'ASSEMBLING' },
    }).catch(() => {});
  }
}

async function generateLetterInBackground(
  caseId: string,
  caseContext: Record<string, unknown>,
  strategy: string
) {
  try {
    let result = await generateDemandLetter(
      caseContext,
      strategy as 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH'
    );
    let dlVerification = await verifyDemandLetter(result.html, caseContext);
    let dlDidRetry = false;
    if (dlVerification.overallStatus === 'issues_found') {
      const retried = await retryDemandLetter(result.html, dlVerification, caseContext, strategy);
      dlVerification = await verifyDemandLetter(retried.html, caseContext);
      result = retried;
      dlDidRetry = true;
    }
    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: 'READY',
        demandLetter: result.text,
        demandLetterHtml: result.html,
        demandLetterVerification: { ...dlVerification, didRetry: dlDidRetry } as never,
        actions: {
          create: {
            type: 'DEMAND_LETTER_GENERATED',
            status: 'COMPLETED',
            label: 'Demand letter generated',
          },
        },
      },
    });
  } catch (err) {
    console.error(`Background letter generation failed for case ${caseId}:`, err);
    await prisma.case.update({
      where: { id: caseId },
      data: { status: 'STRATEGY_SELECTED' },
    }).catch(() => {});
  }
}

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

    // Set ANALYZING, return immediately — synthesis runs in background
    const updatedCase = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'ANALYZING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updatedCase);

    analyzeCaseInBackground(caseData.id, docInputs, userFacts as Record<string, unknown>, caseData);
  } catch (err) {
    console.error('Analysis error:', err);
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
      strategy: caseData.strategy,
    };

    // Set GENERATING, return immediately — letter generation runs in background
    const updatedCase = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updatedCase);

    generateLetterInBackground(caseData.id, caseContext as Record<string, unknown>, caseData.strategy!);
  } catch (err) {
    console.error('Letter generation error:', err);
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
    await prisma.case.update({ where: { id: req.params.id }, data: { acrisResult: result as never } }).catch(() => {});
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
    await prisma.case.update({ where: { id: req.params.id }, data: { courtHistory: result as never } }).catch(() => {});
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
    await prisma.case.update({ where: { id: req.params.id }, data: { entityResult: result as never } }).catch(() => {});
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
    await prisma.case.update({ where: { id: req.params.id }, data: { uccResult: result as never } }).catch(() => {});
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
    await prisma.case.update({ where: { id: req.params.id }, data: { ecbResult: result as never } }).catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('ECB lookup error:', err);
    res.status(500).json({ error: 'ECB lookup failed', details: String(err) });
  }
});

// GET /api/cases/:id/pacer-bankruptcy — PACER federal bankruptcy check for debtor
router.get('/:id/pacer-bankruptcy', async (req: Request, res: Response) => {
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

    const result = await checkPACERBankruptcy(partyName);
    await prisma.case.update({ where: { id: req.params.id }, data: { pacerResult: result as never } }).catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('PACER lookup error:', err);
    res.status(500).json({ error: 'PACER lookup failed', details: String(err) });
  }
});

// POST /api/cases/:id/assess-strategy — re-assess strategy using persisted debtor research
router.post('/:id/assess-strategy', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const lookupResults = {
      acris:  caseData.acrisResult  as Record<string, unknown> | null,
      courts: caseData.courtHistory as Record<string, unknown> | null,
      entity: caseData.entityResult as Record<string, unknown> | null,
      ucc:    caseData.uccResult    as Record<string, unknown> | null,
      ecb:    caseData.ecbResult    as Record<string, unknown> | null,
      pacer:  caseData.pacerResult  as Record<string, unknown> | null,
    };

    const hasAnyResult = Object.values(lookupResults).some(v => v != null);
    if (!hasAnyResult) {
      res.status(400).json({ error: 'No debtor research results on file. Run at least one lookup first.' });
      return;
    }

    const caseContext = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorEntityType: caseData.debtorEntityType,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      serviceDescription: caseData.serviceDescription,
      caseStrength: caseData.caseStrength,
      paymentDueDate: caseData.paymentDueDate?.toISOString().split('T')[0],
      caseAssessment: caseData.caseAssessment,
    };

    const assessment = await assessStrategyWithResearch(caseContext as Record<string, unknown>, lookupResults);
    res.json(assessment);
  } catch (err) {
    console.error('Strategy assessment error:', err);
    res.status(500).json({ error: 'Strategy assessment failed', details: String(err) });
  }
});

// GET /api/cases/:id/demand-letter-pdf
router.get('/:id/demand-letter-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { demandLetterHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.demandLetterHtml) { res.status(400).json({ error: 'Demand letter not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.demandLetterHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="demand-letter.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Demand letter PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/final-notice-pdf
router.get('/:id/final-notice-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { finalNoticeHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.finalNoticeHtml) { res.status(400).json({ error: 'Final notice not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.finalNoticeHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="final-notice.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Final notice PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/court-form-pdf
router.get('/:id/court-form-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.filingPacketHtml && !caseData.filingPacket) {
      res.status(400).json({ error: 'Court form not yet generated' });
      return;
    }

    const outstanding = Number(caseData.amountOwed ?? 0) - Number(caseData.amountPaid ?? 0);

    // Commercial claims (≤$10k) → official CIV-SC-70 layout via pdf-lib
    if (outstanding <= 10000) {
      const formData = {
        claimantName: caseData.claimantName ?? undefined,
        claimantBusiness: caseData.claimantBusiness ?? undefined,
        claimantAddress: caseData.claimantAddress ?? undefined,
        claimantPhone: caseData.claimantPhone ?? undefined,
        debtorName: caseData.debtorName ?? undefined,
        debtorBusiness: caseData.debtorBusiness ?? undefined,
        debtorAddress: caseData.debtorAddress ?? undefined,
        debtorPhone: caseData.debtorPhone ?? undefined,
        amountClaimed: outstanding.toFixed(2),
        serviceDescription: caseData.serviceDescription ?? undefined,
        invoiceNumber: caseData.invoiceNumber ?? undefined,
        agreementDate: caseData.agreementDate?.toISOString().split('T')[0] ?? undefined,
        invoiceDate: caseData.invoiceDate?.toISOString().split('T')[0] ?? undefined,
      };
      const pdf = await fillCIVSC70(formData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="court-form-CIV-SC-70.pdf"');
      res.send(pdf);
    } else {
      // Civil/Supreme → convert AI-generated HTML to PDF
      const html = caseData.filingPacketHtml ?? '';
      const pdf = await htmlToPDF(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="court-form.pdf"');
      res.send(pdf);
    }
  } catch (err) {
    console.error('Court form PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/default-judgment-pdf
router.get('/:id/default-judgment-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { defaultJudgmentHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.defaultJudgmentHtml) { res.status(400).json({ error: 'Default judgment not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.defaultJudgmentHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="default-judgment-motion.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Default judgment PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/generate-affidavit-of-service
router.post('/:id/generate-affidavit-of-service', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      courtFormType: caseData.courtFormType,
    };

    const result = await generateAffidavitOfService(context as Record<string, unknown>);

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: { affidavitOfServiceHtml: result.html },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    console.error('Affidavit of service error:', err);
    res.status(500).json({ error: 'Affidavit generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/affidavit-of-service-pdf
router.get('/:id/affidavit-of-service-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { affidavitOfServiceHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.affidavitOfServiceHtml) { res.status(400).json({ error: 'Affidavit not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.affidavitOfServiceHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="affidavit-of-service.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Affidavit PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/generate-settlement
router.post('/:id/generate-settlement', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      serviceDescription: caseData.serviceDescription,
      invoiceNumber: caseData.invoiceNumber,
      courtFormType: caseData.courtFormType,
    };

    let result = await generateStipulationOfSettlement(context as Record<string, unknown>);

    // Verify → retry if issues found → verify again
    let stlVerification = await verifySettlement(result.html, context as Record<string, unknown>);
    let stlDidRetry = false;
    if (stlVerification.overallStatus === 'issues_found') {
      const retried = await retrySettlement(result.html, stlVerification, context as Record<string, unknown>);
      const retryV = await verifySettlement(retried.html, context as Record<string, unknown>);
      result = retried;
      stlVerification = retryV;
      stlDidRetry = true;
    }

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        settlementHtml: result.html,
        settlementVerification: { ...stlVerification, didRetry: stlDidRetry } as never,
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    console.error('Settlement generation error:', err);
    res.status(500).json({ error: 'Settlement generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/settlement-pdf
router.get('/:id/settlement-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { settlementHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.settlementHtml) { res.status(400).json({ error: 'Settlement not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.settlementHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="stipulation-of-settlement.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Settlement PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/generate-payment-plan
router.post('/:id/generate-payment-plan', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    const context = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      serviceDescription: caseData.serviceDescription,
    };

    let result = await generatePaymentPlanAgreement(context as Record<string, unknown>);

    // Verify → retry if issues found → verify again
    let ppVerification = await verifyPaymentPlan(result.html, context as Record<string, unknown>);
    let ppDidRetry = false;
    if (ppVerification.overallStatus === 'issues_found') {
      const retried = await retryPaymentPlan(result.html, ppVerification, context as Record<string, unknown>);
      const retryV = await verifyPaymentPlan(retried.html, context as Record<string, unknown>);
      result = retried;
      ppVerification = retryV;
      ppDidRetry = true;
    }

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        paymentPlanHtml: result.html,
        paymentPlanVerification: { ...ppVerification, didRetry: ppDidRetry } as never,
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    console.error('Payment plan generation error:', err);
    res.status(500).json({ error: 'Payment plan generation failed', details: String(err) });
  }
});

// GET /api/cases/:id/payment-plan-pdf
router.get('/:id/payment-plan-pdf', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { paymentPlanHtml: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (!caseData.paymentPlanHtml) { res.status(400).json({ error: 'Payment plan not yet generated' }); return; }

    const pdf = await htmlToPDF(caseData.paymentPlanHtml);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="payment-plan-agreement.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Payment plan PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: String(err) });
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
      include: { actions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }

    // Derive court from outstanding balance
    const outstanding = parseFloat(caseData.amountOwed?.toString() || '0') - parseFloat(caseData.amountPaid?.toString() || '0');
    const courtName = outstanding <= 10000
      ? 'NYC Commercial Claims Court'
      : outstanding <= 50000
      ? 'NYC Civil Court'
      : 'New York Supreme Court';

    // Find when the demand letter was generated so we can reference it by date
    const demandAction = (caseData.actions as Array<{ type: string; createdAt: Date }>)
      .find(a => a.type === 'DEMAND_LETTER_GENERATED');
    const demandLetterDate = demandAction
      ? new Date(demandAction.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    // Hard filing date: 7 days from today
    const filingDateObj = new Date();
    filingDateObj.setDate(filingDateObj.getDate() + 7);
    const filingDate = filingDateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const caseContext = {
      claimantName: caseData.claimantName,
      claimantBusiness: caseData.claimantBusiness,
      debtorName: caseData.debtorName,
      debtorBusiness: caseData.debtorBusiness,
      debtorAddress: caseData.debtorAddress,
      amountOwed: caseData.amountOwed?.toString(),
      amountPaid: caseData.amountPaid?.toString(),
      invoiceNumber: caseData.invoiceNumber,
      serviceDescription: caseData.serviceDescription,
    };

    const result = await generateFinalNotice(caseContext as Record<string, unknown>, {
      demandLetterDate,
      courtName,
      filingDate,
    });

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

    let result = await generateDefaultJudgment(context as Record<string, unknown>);

    // Verify → retry if issues found → verify again
    let djVerification = await verifyDefaultJudgment(result.html, context as Record<string, unknown>);
    let djDidRetry = false;
    if (djVerification.overallStatus === 'issues_found') {
      const retried = await retryDefaultJudgment(result.html, djVerification, context as Record<string, unknown>);
      const retryVerification = await verifyDefaultJudgment(retried.html, context as Record<string, unknown>);
      result = retried;
      djVerification = retryVerification;
      djDidRetry = true;
    }

    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: {
        defaultJudgment: result.text,
        defaultJudgmentHtml: result.html,
        defaultJudgmentVerification: { ...djVerification, didRetry: djDidRetry } as never,
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
