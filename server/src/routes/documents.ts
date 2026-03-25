import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { upload } from '../middleware/upload';
import { extractTextFromFile, extractTextFromImage } from '../services/fileProcessor';
import { analyzeDocument } from '../services/claude';

const router = Router({ mergeParams: true });

// POST /api/cases/:caseId/documents — upload + analyze documents
router.post(
  '/',
  upload.array('files', 20),
  async (req: Request, res: Response) => {
    try {
      const { caseId } = req.params;

      const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
      if (!caseRecord) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      const results = [];

      for (const file of files) {
        try {
          // Extract text
          let extractedText: string;
          if (file.mimetype.startsWith('image/')) {
            extractedText = await extractTextFromImage(file.path);
          } else {
            extractedText = await extractTextFromFile(file.path, file.mimetype, file.originalname);
          }

          // Analyze with Claude
          const analysis = await analyzeDocument(extractedText, file.originalname, file.mimetype);

          const doc = await prisma.document.create({
            data: {
              caseId,
              filename: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              path: file.path,
              extractedText,
              classification: analysis.classification,
              confidence: analysis.confidence,
              supportsTags: analysis.supportsTags,
              extractedFacts: analysis.extractedFacts as never,
              summary: analysis.summary,
            },
          });

          results.push(doc);
        } catch (docErr) {
          console.error(`Error processing file ${file.originalname}:`, docErr);
          // Still create the document record without analysis
          const doc = await prisma.document.create({
            data: {
              caseId,
              filename: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              path: file.path,
            },
          });
          results.push(doc);
        }
      }

      // Log action
      await prisma.caseAction.create({
        data: {
          caseId,
          type: 'DOCUMENTS_UPLOADED',
          status: 'COMPLETED',
          label: `${files.length} document${files.length > 1 ? 's' : ''} uploaded and analyzed`,
          metadata: { count: files.length },
        },
      });

      // Update case status to ASSEMBLING if still DRAFT
      if (caseRecord.status === 'DRAFT') {
        await prisma.case.update({
          where: { id: caseId },
          data: { status: 'ASSEMBLING' },
        });
      }

      res.status(201).json(results);
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: 'Upload failed', details: String(err) });
    }
  }
);

// GET /api/cases/:caseId/documents
router.get('/', async (req: Request, res: Response) => {
  try {
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
    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Delete file from disk
    try {
      if (fs.existsSync(doc.path)) {
        fs.unlinkSync(doc.path);
      }
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

// GET /api/cases/:caseId/documents/:docId/download
router.get('/:docId/download', async (req: Request, res: Response) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.docId, caseId: req.params.caseId },
    });

    if (!doc || !fs.existsSync(doc.path)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${doc.originalName}"`);
    res.setHeader('Content-Type', doc.mimeType);
    res.sendFile(path.resolve(doc.path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

export default router;
