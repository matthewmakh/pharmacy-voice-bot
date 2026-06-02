import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { synthesizeCase, generateDemandLetter, generateFinalNotice, generateCourtForm, generateDefaultJudgment, assessStrategyWithResearch, generateAffidavitOfService, generateStipulationOfSettlement, generatePaymentPlanAgreement, verifyCaseSynthesis, extractIntakeFromDocuments } from '../services/claude';
import { verifyDocumentFacts, reviseDocument } from '../services/verify';
import { fillCIVSC70, htmlToPDF } from '../services/pdf';
import { trackForAmount, outstandingBalance } from '../lib/legal';
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

// In-process guard against double-submitting a long-running job for the same case.
// Combined with the DB status check, this makes generation idempotent under rapid
// double-clicks: the second request returns 409 instead of firing a duplicate job
// (duplicate AI spend + last-write-wins corruption).
const activeJobs = new Set<string>();
function acquireJob(caseId: string): boolean {
  if (activeJobs.has(caseId)) return false;
  activeJobs.add(caseId);
  return true;
}
function releaseJob(caseId: string): void {
  activeJobs.delete(caseId);
}

// Statuses from which a fresh generation/analysis may be (re)started.
const BUSY_STATUSES = new Set(['ANALYZING', 'GENERATING']);

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

const actionSchema = z.object({
  type: z.enum([
    'CASE_CREATED', 'CASE_UPDATED', 'DOCUMENTS_UPLOADED', 'AI_ANALYSIS_COMPLETED', 'STRATEGY_SELECTED',
    'DEMAND_LETTER_GENERATED', 'FINAL_NOTICE_GENERATED', 'FILING_PACKET_GENERATED', 'COURT_FORM_GENERATED',
    'DEFAULT_JUDGMENT_GENERATED', 'EMAIL_SENT', 'CERTIFIED_MAIL_SENT', 'REMINDER_SENT', 'FINAL_NOTICE_SENT',
    'LAWYER_REVIEW_REQUESTED', 'FILING_PREPARED', 'SERVICE_INITIATED', 'PAYMENT_RECEIVED', 'CASE_CLOSED',
  ]),
  notes: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
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
    // Bounded read so the dashboard query stays cheap as a user accumulates cases.
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const cases = await prisma.case.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
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

// POST /api/cases/draft — create an empty DRAFT case so docs can be attached before final submit
router.post('/draft', async (req: Request, res: Response) => {
  try {
    const newCase = await prisma.case.create({
      data: {
        status: 'DRAFT',
        userId: req.user!.id,
      },
      include: { documents: true, actions: true },
    });
    res.status(201).json(newCase);
  } catch (err) {
    console.error('Draft case creation error:', err);
    res.status(500).json({ error: 'Failed to create draft case' });
  }
});

// POST /api/cases/:id/submit-draft — finalize a DRAFT case (set fields, flip to ASSEMBLING, log creation)
router.post('/:id/submit-draft', async (req: Request, res: Response) => {
  try {
    const data = updateCaseSchema.parse(req.body);

    const existing = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      select: { status: true, debtorName: true, debtorBusiness: true },
    });
    if (!existing) { res.status(404).json({ error: 'Case not found' }); return; }
    if (existing.status !== 'DRAFT') {
      res.status(400).json({ error: 'Case is no longer a draft' });
      return;
    }

    const title =
      data.title ||
      (data.debtorBusiness || data.debtorName || existing.debtorBusiness || existing.debtorName || 'Unknown Debtor') +
        (data.amountOwed ? ` — $${data.amountOwed.toLocaleString()}` : '');

    const updated = await prisma.case.update({
      where: { id: req.params.id },
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
        industry: data.industry,
        notes: data.notes,
        status: 'ASSEMBLING',
        actions: {
          create: { type: 'CASE_CREATED', status: 'COMPLETED', label: 'Case created' },
        },
      },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error('Submit draft error:', err);
      res.status(500).json({ error: 'Failed to submit draft' });
    }
  }
});

// POST /api/cases/:id/autofill — extract intake fields from uploaded documents
// Returns the field map without persisting; the frontend merges it into the form
// and persists on final submit via PATCH /:id.
router.post('/:id/autofill', async (req: Request, res: Response) => {
  try {
    const caseData = await prisma.case.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      include: { documents: true },
    });
    if (!caseData) { res.status(404).json({ error: 'Case not found' }); return; }
    if (caseData.status !== 'DRAFT') {
      res.status(400).json({ error: 'Autofill is only available for draft cases' });
      return;
    }
    if (caseData.documents.length === 0) {
      res.status(400).json({ error: 'No documents attached to extract from' });
      return;
    }

    // Wait up to 60s for any in-flight per-document analysis to complete (we need extractedText).
    // The documents POST route fires extraction in the background; analysisError===false && classification===null means still running.
    const deadline = Date.now() + 60_000;
    let docs = caseData.documents;
    while (Date.now() < deadline) {
      const stillPending = docs.some(d => !d.analysisError && d.classification === null);
      if (!stillPending) break;
      await new Promise(r => setTimeout(r, 2000));
      docs = await prisma.document.findMany({ where: { caseId: caseData.id } });
    }

    const ready = docs
      .filter(d => typeof d.extractedText === 'string' && d.extractedText.length > 0)
      .map(d => ({ id: d.id, originalName: d.originalName, extractedText: d.extractedText! }));

    if (ready.length === 0) {
      res.status(422).json({ error: 'Could not extract text from any uploaded documents' });
      return;
    }

    const result = await extractIntakeFromDocuments(ready);
    res.json(result);
  } catch (err) {
    console.error('Autofill error:', err);
    res.status(500).json({ error: 'Autofill failed', details: String(err) });
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
    console.log(`[analyze] start case=${caseId} docs=${docInputs.length}`);
    const synthesis = await synthesizeCase(docInputs, userFacts);
    console.log(`[analyze] synthesis ok case=${caseId}`);

    // Verify is best-effort: if it fails (timeout, rate limit, parse error),
    // we still persist the synthesis result rather than throwing away a good analysis.
    let analysisVerification: Awaited<ReturnType<typeof verifyCaseSynthesis>> | null = null;
    try {
      analysisVerification = await verifyCaseSynthesis(synthesis, docInputs, userFacts);
      console.log(`[analyze] verify ok case=${caseId} status=${analysisVerification.overallStatus}`);
    } catch (verr) {
      console.error(`[analyze] verify failed case=${caseId} — persisting synthesis without verification:`, verr);
    }

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
  } finally {
    releaseJob(caseId);
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
    let dlVerification = verifyDocumentFacts('demand-letter', result.html, caseContext);
    let dlDidRetry = false;
    if (dlVerification.overallStatus === 'issues_found') {
      result = await reviseDocument('demand-letter', result.html, dlVerification, caseContext);
      dlVerification = verifyDocumentFacts('demand-letter', result.html, caseContext);
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
  } finally {
    releaseJob(caseId);
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

    // Guard against double-submit: a case already analyzing/generating must not kick
    // off a second job (wasted AI spend + racing writes).
    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
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
    releaseJob(req.params.id);
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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }

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
    releaseJob(req.params.id);
    console.error('Letter generation error:', err);
    res.status(500).json({ error: 'Letter generation failed', details: String(err) });
  }
});

// POST /api/cases/:id/actions — log a manual action
router.post('/:id/actions', async (req: Request, res: Response) => {
  try {
    const { type, notes, metadata } = actionSchema.parse(req.body);

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
        metadata: metadata as never,
      },
    });

    // Apply the payment first — whether it fully clears the balance decides the status.
    let resolvedByPayment = false;
    if (type === 'PAYMENT_RECEIVED' && metadata?.amount != null) {
      const paymentAmount = parseFloat(String(metadata.amount));
      if (!isNaN(paymentAmount) && paymentAmount > 0) {
        // Atomic increment avoids the lost-update race of read-then-write.
        const updated = await prisma.case.update({
          where: { id: req.params.id },
          data: { amountPaid: { increment: paymentAmount } },
          select: { amountOwed: true, amountPaid: true },
        });
        resolvedByPayment = outstandingBalance(updated.amountOwed?.toString(), updated.amountPaid?.toString()) <= 0;
      }
    }

    // Status transitions. A PARTIAL payment must not close the case — only a payment
    // that clears the balance resolves it (the previous code resolved on any payment).
    const statusMap: Record<string, string> = {
      EMAIL_SENT: 'SENT',
      CERTIFIED_MAIL_SENT: 'SENT',
      REMINDER_SENT: 'AWAITING_RESPONSE',
      FINAL_NOTICE_SENT: 'ESCALATING',
      CASE_CLOSED: 'CLOSED',
    };
    let nextStatus: string | undefined = statusMap[type];
    if (type === 'PAYMENT_RECEIVED') nextStatus = resolvedByPayment ? 'RESOLVED' : 'AWAITING_RESPONSE';
    if (nextStatus) {
      await prisma.case.update({ where: { id: req.params.id, userId: req.user!.id }, data: { status: nextStatus as never } });
    }

    res.status(201).json(action);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.errors[0].message }); return; }
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

async function generateSettlementInBackground(caseId: string, context: Record<string, unknown>, priorStatus: string) {
  try {
    let result = await generateStipulationOfSettlement(context);
    let stlVerification = verifyDocumentFacts('settlement', result.html, context);
    let stlDidRetry = false;
    if (stlVerification.overallStatus === 'issues_found') {
      result = await reviseDocument('settlement', result.html, stlVerification, context);
      stlVerification = verifyDocumentFacts('settlement', result.html, context);
      stlDidRetry = true;
    }
    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: priorStatus as never,
        settlementHtml: result.html,
        settlementVerification: { ...stlVerification, didRetry: stlDidRetry } as never,
      },
    });
  } catch (err) {
    console.error(`Background settlement generation failed for case ${caseId}:`, err);
    await prisma.case.update({ where: { id: caseId }, data: { status: priorStatus as never } }).catch(() => {});
  } finally {
    releaseJob(caseId);
  }
}

async function generatePaymentPlanInBackground(caseId: string, context: Record<string, unknown>, priorStatus: string) {
  try {
    let result = await generatePaymentPlanAgreement(context);
    let ppVerification = verifyDocumentFacts('payment-plan', result.html, context);
    let ppDidRetry = false;
    if (ppVerification.overallStatus === 'issues_found') {
      result = await reviseDocument('payment-plan', result.html, ppVerification, context);
      ppVerification = verifyDocumentFacts('payment-plan', result.html, context);
      ppDidRetry = true;
    }
    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: priorStatus as never,
        paymentPlanHtml: result.html,
        paymentPlanVerification: { ...ppVerification, didRetry: ppDidRetry } as never,
      },
    });
  } catch (err) {
    console.error(`Background payment plan generation failed for case ${caseId}:`, err);
    await prisma.case.update({ where: { id: caseId }, data: { status: priorStatus as never } }).catch(() => {});
  } finally {
    releaseJob(caseId);
  }
}

const GENERATION_FAILED_MARKER = 'Form generation failed';

async function generateCourtFormInBackground(caseId: string, context: Record<string, unknown>, track: 'commercial' | 'civil' | 'supreme', priorStatus: string) {
  try {
    let form = await generateCourtForm(context, track);
    // A generation failure (parse/truncation) is not a content issue — retry generation
    // once directly rather than feeding an error string into the fact checker.
    if (form.html.includes(GENERATION_FAILED_MARKER)) {
      form = await generateCourtForm(context, track);
    }
    if (form.html.includes(GENERATION_FAILED_MARKER)) {
      await prisma.case.update({
        where: { id: caseId },
        data: {
          status: priorStatus as never,
          filingPacketHtml: form.html,
          filingPacket: form.formType,
          courtFormType: form.formType,
          courtFormInstructions: form.instructions as never,
          courtFormVerification: { overallStatus: 'issues_found', checks: [], summary: 'Form generation failed after two attempts. This is usually a temporary issue — please try again.', blankFields: [], verifiedAt: new Date().toISOString(), didRetry: false, generationFailed: true } as never,
          actions: { create: { type: 'COURT_FORM_GENERATED', status: 'FAILED', label: 'Court form generation failed' } },
        },
      });
      return;
    }

    let verification = verifyDocumentFacts('court-form', form.html, context);
    let didRetry = false;
    if (verification.overallStatus === 'issues_found') {
      const revised = await reviseDocument('court-form', form.html, verification, context);
      form = { ...form, html: revised.html };
      verification = verifyDocumentFacts('court-form', form.html, context);
      didRetry = true;
    }

    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: priorStatus as never,
        filingPacketHtml: form.html,
        filingPacket: form.formType,
        courtFormType: form.formType,
        courtFormInstructions: form.instructions as never,
        courtFormVerification: { ...verification, didRetry } as never,
        actions: { create: { type: 'COURT_FORM_GENERATED', status: 'COMPLETED', label: `Court form generated: ${form.formType}${didRetry ? ' (auto-corrected)' : ''}`, metadata: { overallStatus: verification.overallStatus, didRetry } } },
      },
    });
  } catch (err) {
    console.error(`Background court form generation failed for case ${caseId}:`, err);
    await prisma.case.update({ where: { id: caseId }, data: { status: priorStatus as never } }).catch(() => {});
  } finally {
    releaseJob(caseId);
  }
}

async function generateDefaultJudgmentInBackground(caseId: string, context: Record<string, unknown>, priorStatus: string) {
  try {
    let result = await generateDefaultJudgment(context);
    let djVerification = verifyDocumentFacts('default-judgment', result.html, context);
    let djDidRetry = false;
    if (djVerification.overallStatus === 'issues_found') {
      result = await reviseDocument('default-judgment', result.html, djVerification, context);
      djVerification = verifyDocumentFacts('default-judgment', result.html, context);
      djDidRetry = true;
    }
    await prisma.case.update({
      where: { id: caseId },
      data: {
        status: priorStatus as never,
        defaultJudgment: result.text,
        defaultJudgmentHtml: result.html,
        defaultJudgmentVerification: { ...djVerification, didRetry: djDidRetry } as never,
        actions: { create: { type: 'DEFAULT_JUDGMENT_GENERATED', status: 'COMPLETED', label: 'Default judgment motion generated' } },
      },
    });
  } catch (err) {
    console.error(`Background default judgment generation failed for case ${caseId}:`, err);
    await prisma.case.update({ where: { id: caseId }, data: { status: priorStatus as never } }).catch(() => {});
  } finally {
    releaseJob(caseId);
  }
}

async function generateFinalNoticeInBackground(caseId: string, context: Record<string, unknown>, noticeCtx: { demandLetterDate: string | null; courtName: string; filingDate: string }, priorStatus: string) {
  try {
    const result = await generateFinalNotice(context, noticeCtx);
    await prisma.case.update({
      where: { id: caseId },
      data: {
        finalNotice: result.text,
        finalNoticeHtml: result.html,
        status: 'ESCALATING',
        actions: { create: { type: 'FINAL_NOTICE_GENERATED', status: 'COMPLETED', label: 'Final notice generated' } },
      },
    });
  } catch (err) {
    console.error(`Background final notice generation failed for case ${caseId}:`, err);
    await prisma.case.update({ where: { id: caseId }, data: { status: priorStatus as never } }).catch(() => {});
  } finally {
    releaseJob(caseId);
  }
}

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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }

    const priorStatus = caseData.status;
    const updatedCase = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updatedCase);

    generateSettlementInBackground(caseData.id, context as Record<string, unknown>, priorStatus);
  } catch (err) {
    releaseJob(req.params.id);
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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }

    const priorStatus = caseData.status;
    const updatedCase = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updatedCase);

    generatePaymentPlanInBackground(caseData.id, context as Record<string, unknown>, priorStatus);
  } catch (err) {
    releaseJob(req.params.id);
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
    const outstanding = outstandingBalance(caseData.amountOwed?.toString(), caseData.amountPaid?.toString());
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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }
    const priorStatus = caseData.status;
    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);

    // Runs in the background (the AI call can take 30–60s) — the frontend polls while GENERATING.
    generateFinalNoticeInBackground(caseData.id, caseContext as Record<string, unknown>, { demandLetterDate, courtName, filingDate }, priorStatus);
  } catch (err) {
    releaseJob(req.params.id);
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
    const outstanding = outstandingBalance(caseData.amountOwed?.toString(), caseData.amountPaid?.toString());
    const track = trackForAmount(outstanding);

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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }
    const priorStatus = caseData.status;
    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);

    // Generate → fact-check → revise runs in the background (multiple AI calls) — the
    // frontend polls while GENERATING. Previously this ran inline and routinely exceeded
    // the client's 120s timeout.
    generateCourtFormInBackground(caseData.id, context as Record<string, unknown>, track, priorStatus);
  } catch (err) {
    releaseJob(req.params.id);
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

    if (BUSY_STATUSES.has(caseData.status) || !acquireJob(caseData.id)) {
      res.status(409).json({ error: 'This case is already being processed. Please wait for it to finish.' });
      return;
    }
    const priorStatus = caseData.status;
    const updated = await prisma.case.update({
      where: { id: req.params.id },
      data: { status: 'GENERATING' },
      include: { documents: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(updated);

    // Generate → fact-check → revise in the background — the frontend polls while GENERATING.
    generateDefaultJudgmentInBackground(caseData.id, context as Record<string, unknown>, priorStatus);
  } catch (err) {
    releaseJob(req.params.id);
    console.error('Default judgment error:', err);
    res.status(500).json({ error: 'Default judgment generation failed', details: String(err) });
  }
});

export default router;
