import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import casesRouter from './routes/cases';
import documentsRouter from './routes/documents';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/cases', casesRouter);
app.use('/api/cases/:caseId/documents', documentsRouter);

// ─── Static Frontend ──────────────────────────────────────────────────────────
const clientDistPath = path.join(__dirname, '../../client/dist');

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({ message: 'Collections Platform API', docs: '/api/health' });
  });
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Collections Platform server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
