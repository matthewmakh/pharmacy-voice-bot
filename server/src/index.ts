import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import casesRouter from './routes/cases';
import documentsRouter from './routes/documents';
import authRouter from './routes/auth';
import orgsRouter from './routes/orgs';
import webhooksRouter from './routes/webhooks';
import portalRouter from './routes/portal';
import payoutsRouter from './routes/payouts';
import handoffRouter from './routes/handoff';
import attorneyRouter from './routes/attorney';
import prisma from './lib/prisma';
import { storageHealthWarning } from './lib/storage';
import { ensurePersonalOrg, primaryOrgId } from './lib/org';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Trust Railway's reverse proxy so express-rate-limit can read X-Forwarded-For correctly
app.set('trust proxy', 1);

// ─── Security headers ───────────────────────────────────────────────────────────
// CSP is tailored so it does not break the Vite SPA or the inline-styled legal
// documents we render in blob tabs, while still blocking foreign scripts/frames.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

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

app.get('/api/health/phase-a', (_req, res) => {
  const env = process.env;
  res.json({
    timestamp: new Date().toISOString(),
    vendors: {
      lob:           keyState(env.LOB_API_KEY, env.LOB_API_KEY?.startsWith('test_') ? 'test' : 'live'),
      resend:        keyState(env.RESEND_API_KEY),
      dropboxSign:   keyState(env.DROPBOX_SIGN_API_KEY),
      stripe:        keyState(env.STRIPE_SECRET_KEY, env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'test' : 'live'),
    },
    webhookSecrets: {
      stripe: !!env.STRIPE_WEBHOOK_SECRET,
    },
    sender: {
      domain: env.EMAIL_SENDER_DOMAIN ?? null,
      from:   env.EMAIL_FROM_ADDRESS ?? null,
    },
    redis:  env.REDIS_URL ? 'configured' : 'unset (follow-up scheduler is a no-op)',
    publicBaseUrl: env.PUBLIC_BASE_URL ?? null,
  });
});

function keyState(key: string | undefined, mode?: string): { configured: boolean; mode?: string } {
  return { configured: !!key, ...(mode ? { mode } : {}) };
}

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/orgs', apiLimiter, orgsRouter);
app.use('/api/cases', apiLimiter, casesRouter);
app.use('/api/cases/:caseId/documents', apiLimiter, documentsRouter);
app.use('/api/portal', apiLimiter, portalRouter);
app.use('/api/payouts', apiLimiter, payoutsRouter);
app.use('/api/handoff', apiLimiter, handoffRouter);
app.use('/api/attorney', apiLimiter, attorneyRouter);

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
  const warning = storageHealthWarning();
  if (warning) console.warn(`\n⚠ ${warning}\n`);

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

  // Multi-tenancy backfill (idempotent): give every pre-existing user a personal org
  // and assign every unscoped case to its creator's org. Safe to run on every boot.
  try {
    const usersWithoutOrg = await prisma.user.findMany({ where: { memberships: { none: {} } }, select: { id: true, email: true, name: true } });
    for (const u of usersWithoutOrg) await ensurePersonalOrg(u);

    const orphanCases = await prisma.case.findMany({ where: { organizationId: null, userId: { not: null } }, select: { id: true, userId: true } });
    for (const c of orphanCases) {
      const orgId = await primaryOrgId(c.userId!);
      if (orgId) await prisma.case.update({ where: { id: c.id }, data: { organizationId: orgId } });
    }
    if (usersWithoutOrg.length || orphanCases.length) {
      console.log(`Startup: provisioned ${usersWithoutOrg.length} org(s), assigned ${orphanCases.length} case(s) to an org`);
    }
  } catch (err) {
    console.error('Org backfill failed (non-fatal):', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Collections Platform server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start();

export default app;
