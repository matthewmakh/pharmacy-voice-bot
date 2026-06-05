import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { upload } from '../middleware/upload';
import { extractText } from '../services/fileProcessor';
import { analyzeDocument } from '../services/claude';
import { requireAuth } from '../middleware/auth';
import { loadOrgs } from '../middleware/orgs';
import { storage } from '../lib/storage';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(loadOrgs);

// MIME types we are willing to render inline in the browser. Everything else is forced
// to download, so an attacker cannot get an uploaded HTML/SVG payload to execute
// same-origin (there are no security headers stripping this risk otherwise).
const INLINE_SAFE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Run async tasks with a concurrency cap so a 20-file upload doesn't fire 20 Claude
// calls at once and trip Anthropic's per-minute budget.
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        await fn(items[idx]);
      } catch (err) {
        console.error('runWithConcurrency task error:', err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function verifyOwnership(caseId: string, orgIds: string[]): Promise<boolean> {
  const c = await prisma.case.findFirst({ where: { id: caseId, organizationId: { in: orgIds } }, select: { id: true } });
  return !!c;
}

// Fire-and-forget per-document analysis with one retry on transient failure.
async function analyzeDocumentInBackground(docId: string, key: string, mimeType: string, originalName: string) {
  const attempt = async () => {
    const buffer = await storage.getBuffer(key);
    const extractedText = await extractText(buffer, mimeType, originalName);
    const analysis = await analyzeDocument(extractedText, originalName, mimeType);
    await prisma.document.update({
      where: { id: docId },
      data: {
        extractedText,
        classification: analysis.classification,
        confidence: analysis.confidence,
        supportsTags: analysis.supportsTags,
        extractedFacts: analysis.extractedFacts as never,
        summary: analysis.summary,
        analysisError: false,
      },
    });
  };

  try {
    await attempt();
  } catch (firstErr) {
    console.error(`Background analysis attempt 1 failed for doc ${docId}:`, firstErr);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    try {
      await attempt();
    } catch (secondErr) {
      console.error(`Background analysis attempt 2 failed for doc ${docId}:`, secondErr);
      await prisma.document.update({ where: { id: docId }, data: { analysisError: true } }).catch(() => {});
    }
  }
}

// POST /api/cases/:caseId/documents — persist to durable storage, analyze in background
router.post('/', upload.array('files', 20), async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    if (!(await verifyOwnership(caseId, req.orgIds!))) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    // Move each staged temp file into durable storage; the key is the generated filename.
    const docs = await Promise.all(
      files.map(async (file) => {
        await storage.putFromPath(file.path, file.filename, file.mimetype);
        return prisma.document.create({
          data: {
            caseId,
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: file.filename, // storage key, not an absolute path
          },
        });
      }),
    );

    await prisma.caseAction.create({
      data: {
        caseId,
        type: 'DOCUMENTS_UPLOADED',
        status: 'COMPLETED',
        label: `${files.length} document${files.length > 1 ? 's' : ''} uploaded`,
        metadata: { count: files.length },
      },
    });

    res.status(201).json(docs);

    const tasks = files.map((file, i) => ({ file, doc: docs[i] }));
    void runWithConcurrency(tasks, 3, async ({ file, doc }) => {
      await analyzeDocumentInBackground(doc.id, doc.path, file.mimetype, file.originalname);
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed', details: String(err) });
  }
});

// GET /api/cases/:caseId/documents
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!(await verifyOwnership(req.params.caseId, req.orgIds!))) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    const docs = await prisma.document.findMany({
      where: { caseId: req.params.caseId },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// DELETE /api/cases/:caseId/documents/:docId
router.delete('/:docId', async (req: Request, res: Response) => {
  try {
    if (!(await verifyOwnership(req.params.caseId, req.orgIds!))) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    const doc = await prisma.document.findFirst({ where: { id: req.params.docId, caseId: req.params.caseId } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    await storage.delete(doc.path).catch((e) => console.warn('Could not delete object from storage:', e));
    await prisma.document.delete({ where: { id: doc.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Shared handler for view (inline) and download (attachment).
async function serveFile(req: Request, res: Response, mode: 'inline' | 'attachment') {
  if (!(await verifyOwnership(req.params.caseId, req.orgIds!))) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const doc = await prisma.document.findFirst({ where: { id: req.params.docId, caseId: req.params.caseId } });
  if (!doc || !(await storage.exists(doc.path))) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  // Never let the browser sniff a different content type, and only render known-safe
  // types inline — anything else is forced to download.
  const disposition = mode === 'inline' && INLINE_SAFE.has(doc.mimeType) ? 'inline' : 'attachment';
  const buffer = await storage.getBuffer(doc.path);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', INLINE_SAFE.has(doc.mimeType) ? doc.mimeType : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.originalName)}"`);
  res.send(buffer);
}

router.get('/:docId/view', (req, res) => serveFile(req, res, 'inline').catch((err) => { console.error(err); res.status(500).json({ error: 'Failed to view file' }); }));
router.get('/:docId/download', (req, res) => serveFile(req, res, 'attachment').catch((err) => { console.error(err); res.status(500).json({ error: 'Failed to download file' }); }));

// POST /api/cases/:caseId/documents/:docId/reanalyze
router.post('/:docId/reanalyze', async (req: Request, res: Response) => {
  try {
    if (!(await verifyOwnership(req.params.caseId, req.orgIds!))) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    const doc = await prisma.document.findFirst({ where: { id: req.params.docId, caseId: req.params.caseId } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { analysisError: false, classification: null },
    });
    res.json(updated);
    void analyzeDocumentInBackground(doc.id, doc.path, doc.mimeType, doc.originalName);
  } catch (err) {
    console.error('Reanalyze error:', err);
    res.status(500).json({ error: 'Failed to queue reanalysis' });
  }
});

export default router;
