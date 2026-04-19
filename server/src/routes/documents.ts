import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { upload } from '../middleware/upload';
import { extractTextFromFile, extractTextFromImage } from '../services/fileProcessor';
import { analyzeDocument } from '../services/claude';
import { requireAuth } from '../middleware/auth';

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Verify the case belongs to the authenticated user
async function verifyOwnership(caseId: string, userId: string): Promise<boolean> {
  const c = await prisma.case.findUnique({ where: { id: caseId, userId }, select: { id: true } });
  return !!c;
}

// Run Claude analysis on a document in the background — fire and forget
async function analyzeDocumentInBackground(docId: string, filePath: string, mimeType: string, originalName: string) {
  const attempt = async () => {
    let extractedText: string;
    if (mimeType.startsWith('image/')) {
      extractedText = await extractTextFromImage(filePath);
    } else {
      extractedText = await extractTextFromFile(filePath, mimeType, originalName);
    }

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
    // Wait 10s then retry once — handles transient Claude timeouts
    await new Promise((resolve) => setTimeout(resolve, 10000));
    try {
      await attempt();
    } catch (secondErr) {
      console.error(`Background analysis attempt 2 failed for doc ${docId}:`, secondErr);
      await prisma.document.update({
        where: { id: docId },
        data: { analysisError: true },
      }).catch(() => {});
    }
  }
}

// POST /api/cases/:caseId/documents — save files immediately, analyze in background
router.post(
  '/',
  upload.array('files', 20),
  async (req: Request, res: Response) => {
    try {
      const { caseId } = req.params;

      const caseRecord = await prisma.case.findUnique({ where: { id: caseId, userId: req.user!.id } });
      if (!caseRecord) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      // Save all records immediately so the response is fast
      const docs = await Promise.all(
        files.map((file) =>
          prisma.document.create({
            data: {
              caseId,
              filename: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              path: file.path,
              // classification null = still being analyzed
            },
          })
        )
      );

      // Log upload action
      await prisma.caseAction.create({
        data: {
          caseId,
          type: 'DOCUMENTS_UPLOADED',
          status: 'COMPLETED',
          label: `${files.length} document${files.length > 1 ? 's' : ''} uploaded`,
          metadata: { count: files.length },
        },
      });

      // Update case to ASSEMBLING if still DRAFT
      if (caseRecord.status === 'DRAFT') {
        await prisma.case.update({
          where: { id: caseId },
          data: { status: 'ASSEMBLING' },
        });
      }

      // Respond immediately — analysis continues in background
      res.status(201).json(docs);

      // Kick off background analysis for each file (does not block response)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const doc = docs[i];
        analyzeDocumentInBackground(doc.id, file.path, file.mimetype, file.originalname);
      }
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: 'Upload failed', details: String(err) });
    }
  }
);

// GET /api/cases/:caseId/documents
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!await verifyOwnership(req.params.caseId, req.user!.id)) {
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
    if (!await verifyOwnership(req.params.caseId, req.user!.id)) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    try {
      if (fs.existsSync(doc.path)) fs.unlinkSync(doc.path);
    } catch (fsErr) {
      console.warn('Could not delete file from disk:', fsErr);
    }

    await prisma.document.delete({ where: { id: doc.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// GET /api/cases/:caseId/documents/:docId/view — serve inline for preview
router.get('/:docId/view', async (req: Request, res: Response) => {
  try {
    if (!await verifyOwnership(req.params.caseId, req.user!.id)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc || !fs.existsSync(doc.path)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
    res.setHeader('Content-Type', doc.mimeType);
    res.sendFile(path.resolve(doc.path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to view file' });
  }
});

// GET /api/cases/:caseId/documents/:docId/download
router.get('/:docId/download', async (req: Request, res: Response) => {
  try {
    if (!await verifyOwnership(req.params.caseId, req.user!.id)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc || !fs.existsSync(doc.path)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    res.setHeader('Content-Type', doc.mimeType);
    res.sendFile(path.resolve(doc.path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// POST /api/cases/:caseId/documents/:docId/reanalyze — re-trigger analysis for a failed document
router.post('/:docId/reanalyze', async (req: Request, res: Response) => {
  try {
    if (!await verifyOwnership(req.params.caseId, req.user!.id)) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Reset error state so the UI shows "Analyzing..." again
    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { analysisError: false, classification: null },
    });

    res.json(updated);

    // Fire off analysis again — same pattern as original upload
    analyzeDocumentInBackground(doc.id, doc.path, doc.mimeType, doc.originalName);
  } catch (err) {
    console.error('Reanalyze error:', err);
    res.status(500).json({ error: 'Failed to queue reanalysis' });
  }
});

export default router;
