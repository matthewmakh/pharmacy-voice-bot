import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import casesRouter from './routes/cases';
import documentsRouter from './routes/documents';
import authRouter from './routes/auth';
import webhooksRouter from './routes/webhooks';
import portalRouter from './routes/portal';
import payoutsRouter from './routes/payouts';
import prisma from './lib/prisma';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Trust Railway's reverse proxy so express-rate-limit can read X-Forwarded-For correctly
app.set('trust proxy', 1);

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Strict limit for auth routes (prevents brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limit per user/IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
// Webhooks must be mounted BEFORE the global json parser so each handler
// can install its own body parser (Stripe needs raw body, Dropbox Sign needs
// urlencoded for multipart form data).
app.use('/api/webhooks', webhooksRouter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/cases', apiLimiter, casesRouter);
app.use('/api/cases/:caseId/documents', apiLimiter, documentsRouter);
app.use('/api/portal', apiLimiter, portalRouter);
app.use('/api/payouts', apiLimiter, payoutsRouter);

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
async function start() {
  // Reset any cases left stuck in ANALYZING/GENERATING from a previous server crash or restart.
  // These cases will never self-recover because the error handler never ran.
  try {
    const stuck = await prisma.case.updateMany({
      where: { status: { in: ['ANALYZING', 'GENERATING'] } },
      data: { status: 'ASSEMBLING' },
    });
    if (stuck.count > 0) {
      console.log(`Startup: reset ${stuck.count} stuck case(s) from ANALYZING/GENERATING → ASSEMBLING`);
    }
  } catch (err) {
    console.error('Startup cleanup failed (non-fatal):', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Collections Platform server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start();

export default app;
