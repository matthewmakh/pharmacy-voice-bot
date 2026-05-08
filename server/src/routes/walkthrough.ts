/**
 * DIY filing walkthrough — step-by-step guide for users who want to file
 * with the court themselves rather than paying for InfoTrack or handing
 * off to an attorney.
 *
 * Three platforms:
 *   nyscef            — NY Supreme Court e-filing (claims > $50k typically)
 *   edds              — NY Civil Court e-filing for pro se (claims $10k–$50k)
 *   commercial-claims — In-person filing at NYC Civil Court (claims ≤ $10k)
 *
 * Two purposes (steps differ slightly for each):
 *   complaint          — initial Summons + Complaint
 *   default-judgment   — Motion for Default Judgment package
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// ─── Step content ────────────────────────────────────────────────────────────

export interface WalkthroughStep {
  title: string;
  body: string; // markdown-lite: paragraphs separated by \n\n
  link?: { label: string; url: string };
  needsInput?: { field: string; label: string; placeholder?: string };
  estimatedMinutes?: number;
}

type WalkthroughType = 'nyscef' | 'edds' | 'commercial-claims';
type WalkthroughPurpose = 'complaint' | 'default-judgment';

function steps(type: WalkthroughType, purpose: WalkthroughPurpose): WalkthroughStep[] {
  if (type === 'nyscef') return nyscefSteps(purpose);
  if (type === 'edds') return eddsSteps(purpose);
  return commercialClaimsSteps(purpose);
}

function nyscefSteps(purpose: WalkthroughPurpose): WalkthroughStep[] {
  const isDefault = purpose === 'default-judgment';
  return [
    {
      title: 'Sign in to NYSCEF',
      body: `NYSCEF is the NYS courts' e-filing portal. If you don't have an account, register first — registration is free and takes ~5 minutes.\n\nUse the same email you've registered the case under so the court can match documents to you.`,
      link: { label: 'Open NYSCEF login', url: 'https://iappscontent.courts.state.ny.us/NYSCEF/live/login.htm' },
      estimatedMinutes: 5,
    },
    isDefault
      ? {
          title: 'Open your existing case',
          body: `Search for your case by Index Number from the NYSCEF dashboard. Click into the case to see the existing filings.`,
          needsInput: { field: 'existingIndexNumber', label: 'Existing index number', placeholder: 'e.g. 156789/2025' },
          estimatedMinutes: 2,
        }
      : {
          title: 'Begin a new case',
          body: `Click **Begin a New Case** → choose **Authorized Case Type**. Select **Civil — Action: Money / Contract** for breach-of-contract collections.`,
          estimatedMinutes: 3,
        },
    {
      title: 'Enter the parties',
      body: `Add yourself (or your business) as the **Plaintiff**, and the debtor as the **Defendant**.\n\nYour case file already has these names — copy them exactly to match the documents we generated for you.`,
      estimatedMinutes: 3,
    },
    {
      title: 'Upload your filing PDF',
      body: isDefault
        ? `Upload the **Default Judgment Motion package** PDF (download it from this page first).\n\nThe upload must be PDF/A — text-searchable, no JavaScript, no flattened layers. Our generated PDF is already compliant.`
        : `Upload your **Summons & Complaint** PDF (download from the Filing tab in this app).\n\nNYSCEF requires PDF/A: text-searchable, no JavaScript, no flattened layers. Our generated PDF is already compliant.`,
      estimatedMinutes: 2,
    },
    {
      title: 'Pay the filing fee',
      body: isDefault
        ? `**Default judgment motions are typically free** — no separate filing fee. Some counties charge a $45 motion fee; check the prompt. NYSCEF accepts credit card or attorney trust account.`
        : `Filing fees:\n\n- Index number purchase: **$210** (Supreme Court, claims > $1,000)\n- Small Claims (Civil Court): **$15**\n\nNYSCEF accepts credit card.`,
      estimatedMinutes: 2,
    },
    {
      title: 'Submit and capture confirmation',
      body: `Click **Submit** and wait for the confirmation page. Save the confirmation PDF and **note the Index Number** the court assigns you (e.g. 156789/2025).`,
      needsInput: { field: 'indexNumber', label: 'Court-assigned Index Number', placeholder: 'e.g. 156789/2025' },
      estimatedMinutes: 2,
    },
    {
      title: 'Mark this case as filed',
      body: `Once you have the index number, click **Done — mark as filed** below. We'll record the filing date and method on this case so it shows up in your timeline.`,
      estimatedMinutes: 1,
    },
  ];
}

function eddsSteps(purpose: WalkthroughPurpose): WalkthroughStep[] {
  const isDefault = purpose === 'default-judgment';
  return [
    {
      title: 'Open EDDS',
      body: `EDDS is the **Electronic Document Delivery System** — used for pro se filings to NY Civil Court (and other courts that don't yet accept NYSCEF). It's free to use, no login required.`,
      link: { label: 'Open EDDS', url: 'https://iapps.courts.state.ny.us/edds/' },
      estimatedMinutes: 1,
    },
    {
      title: 'Select your court',
      body: `Choose **NYC Civil Court** and the borough where you're filing:\n- New York County (Manhattan)\n- Kings (Brooklyn)\n- Queens\n- Bronx\n- Richmond (Staten Island)\n\nFile in the borough where the debtor lives or does business.`,
      estimatedMinutes: 1,
    },
    {
      title: 'Enter your contact info',
      body: `EDDS will email you the court's response (typically within 1–2 business days). Use a real email you check often.`,
      estimatedMinutes: 1,
    },
    {
      title: 'Upload your filing PDF',
      body: isDefault
        ? `Upload the **Default Judgment Motion package** PDF from this app's Filing tab.`
        : `Upload your **Summons & Complaint** PDF from this app's Filing tab.`,
      estimatedMinutes: 2,
    },
    {
      title: 'Pay the fee or note "in forma pauperis"',
      body: `Civil Court filing fee: **$45** (cases up to $25k) or **$95** (cases > $25k). EDDS does not collect payment online — the court clerk will email you a payment link or instructions.\n\nIf you cannot afford the fee, you can apply to file *in forma pauperis* (poor person status) on the EDDS form.`,
      estimatedMinutes: 2,
    },
    {
      title: 'Submit and wait for confirmation',
      body: `Click **Submit**. EDDS gives you a delivery receipt immediately. The court clerk reviews within 1–2 business days and emails you the assigned **Index Number** (or asks for corrections).`,
      needsInput: { field: 'indexNumber', label: 'Court-assigned Index Number', placeholder: 'e.g. CV-12345-25/NY' },
      estimatedMinutes: 1,
    },
    {
      title: 'Mark this case as filed',
      body: `When you receive the index number from the clerk, click **Done — mark as filed** below.`,
      estimatedMinutes: 1,
    },
  ];
}

function commercialClaimsSteps(_purpose: WalkthroughPurpose): WalkthroughStep[] {
  return [
    {
      title: 'Print two copies of the form',
      body: `Commercial Claims (max $10,000) is filed **in person** — there's no e-filing. Print 2 complete copies of the **Notice of Claim** (CIV-SC-70) we generated for you on the Filing tab. Bring a third copy for your own records.`,
      estimatedMinutes: 5,
    },
    {
      title: 'Find your borough\'s Commercial Claims clerk',
      body: `File in the borough where the debtor's business is located. Walk-in, no appointment needed:\n\n- **Manhattan**: 111 Centre Street, Room 117\n- **Brooklyn**: 141 Livingston Street, Room 204\n- **Queens**: 89-17 Sutphin Boulevard, Room 109\n- **Bronx**: 851 Grand Concourse, Room 410\n- **Staten Island**: 927 Castleton Avenue\n\nHours generally 9 AM – 5 PM weekdays.`,
      estimatedMinutes: 30,
    },
    {
      title: 'Bring ID and payment',
      body: `The clerk will accept money order, certified check, or credit card. Filing fee:\n\n- Claims **up to $1,000**: **$25**\n- Claims **$1,000 – $10,000**: **$35**\n\nBring photo ID. If filing as a business, bring proof of authority (corp authorization or partnership agreement).`,
      estimatedMinutes: 2,
    },
    {
      title: 'File at the clerk window',
      body: `Hand the clerk both copies of the form. They will:\n\n1. Stamp them with the index number and filing date\n2. Schedule a hearing (typically 30–70 days out)\n3. Mail the defendant a copy via certified mail (handled by the court)\n4. Return one stamped copy to you\n\nKeep the stamped copy — that's your proof of filing.`,
      needsInput: { field: 'indexNumber', label: 'Index Number / Hearing Date', placeholder: 'e.g. CC-12345-25/NY · Hearing 12/15/25' },
      estimatedMinutes: 15,
    },
    {
      title: 'Mark this case as filed',
      body: `Once the clerk gives you the stamped copy, click **Done — mark as filed** below. We'll record the date and index number on the case.`,
      estimatedMinutes: 1,
    },
  ];
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const startSchema = z.object({
  type: z.enum(['nyscef', 'edds', 'commercial-claims']),
  purpose: z.enum(['complaint', 'default-judgment']),
});

router.post('/:id/walkthrough/start', async (req: Request, res: Response) => {
  try {
    const { type, purpose } = startSchema.parse(req.body);
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    await prisma.case.update({
      where: { id: c.id },
      data: {
        walkthroughType: type,
        walkthroughPurpose: purpose,
        walkthroughStep: 0,
        walkthroughStartedAt: new Date(),
        walkthroughCompletedAt: null,
        walkthroughNotes: {},
      },
    });

    return res.json({ steps: steps(type, purpose), step: 0 });
  } catch (err) {
    console.error('walkthrough start error:', err);
    return res.status(500).json({ error: 'Failed to start walkthrough' });
  }
});

const advanceSchema = z.object({
  step: z.number().int().min(0),
  noteKey: z.string().optional(),
  noteValue: z.string().optional(),
});

router.post('/:id/walkthrough/advance', async (req: Request, res: Response) => {
  try {
    const { step, noteKey, noteValue } = advanceSchema.parse(req.body);
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (!c.walkthroughType) return res.status(400).json({ error: 'No walkthrough in progress' });

    const notes = (c.walkthroughNotes as Record<string, string> | null) ?? {};
    if (noteKey && noteValue !== undefined) notes[noteKey] = noteValue;

    await prisma.case.update({
      where: { id: c.id },
      data: { walkthroughStep: step, walkthroughNotes: notes as never },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('walkthrough advance error:', err);
    return res.status(500).json({ error: 'Failed to advance walkthrough' });
  }
});

const completeSchema = z.object({
  indexNumber: z.string().optional(),
});

router.post('/:id/walkthrough/complete', async (req: Request, res: Response) => {
  try {
    const { indexNumber } = completeSchema.parse(req.body);
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (!c.walkthroughType) return res.status(400).json({ error: 'No walkthrough in progress' });

    const filingUpdates =
      c.walkthroughPurpose === 'default-judgment'
        ? {
            defaultJudgmentFiledAt: new Date(),
            defaultJudgmentFilingMethod: 'diy',
            defaultJudgmentIndexNumber: indexNumber || null,
          }
        : {};

    const updated = await prisma.case.update({
      where: { id: c.id },
      data: {
        walkthroughCompletedAt: new Date(),
        ...filingUpdates,
        actions: {
          create: {
            type: 'FILING_PREPARED',
            label: `DIY filing complete via ${c.walkthroughType}${indexNumber ? ` (Index #${indexNumber})` : ''}`,
            metadata: { type: c.walkthroughType, purpose: c.walkthroughPurpose, indexNumber } as never,
          },
        },
      },
      include: { actions: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    return res.json({ case: updated });
  } catch (err) {
    console.error('walkthrough complete error:', err);
    return res.status(500).json({ error: 'Failed to complete walkthrough' });
  }
});

router.post('/:id/walkthrough/abandon', async (req: Request, res: Response) => {
  try {
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    await prisma.case.update({
      where: { id: c.id },
      data: {
        walkthroughType: null,
        walkthroughPurpose: null,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
        walkthroughCompletedAt: null,
        walkthroughNotes: {} as never,
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('walkthrough abandon error:', err);
    return res.status(500).json({ error: 'Failed to abandon walkthrough' });
  }
});

router.get('/:id/walkthrough/steps', async (req: Request, res: Response) => {
  try {
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!c || !c.walkthroughType) return res.status(404).json({ error: 'No walkthrough' });
    return res.json({
      type: c.walkthroughType,
      purpose: c.walkthroughPurpose,
      step: c.walkthroughStep,
      notes: c.walkthroughNotes,
      completedAt: c.walkthroughCompletedAt,
      steps: steps(
        c.walkthroughType as WalkthroughType,
        (c.walkthroughPurpose as WalkthroughPurpose) || 'complaint',
      ),
    });
  } catch (err) {
    console.error('walkthrough get error:', err);
    return res.status(500).json({ error: 'Failed to load walkthrough' });
  }
});

export default router;
