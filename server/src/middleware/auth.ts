import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
}

interface TokenPayload extends AuthUser {
  /** 'session' = long-lived login token (header only); 'dl' = short-lived download token (URL-safe). */
  scope?: 'session' | 'dl';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Fail fast in production rather than silently signing tokens with a known dev secret.
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'dev-secret-change-in-production';
})();

export function signToken(user: AuthUser): string {
  return jwt.sign({ ...user, scope: 'session' }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Short-lived, URL-safe token for opening file/PDF links in a new tab or <img>/<iframe>.
 * Lives ~10 minutes so that, unlike the 30-day session token, leakage via browser
 * history / proxy logs / Referer headers has a tightly bounded blast radius.
 */
export function signDownloadToken(user: AuthUser): string {
  return jwt.sign({ ...user, scope: 'dl' }, JWT_SECRET, { expiresIn: '10m' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const headerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  // Session tokens must arrive in the Authorization header. The query string is only
  // honored for short-lived 'dl' tokens (checked below), so a leaked file URL cannot
  // hand an attacker a 30-day session.
  const queryToken = (req.query.t as string | undefined) ?? null;
  const token = headerToken ?? queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (token === queryToken && payload.scope !== 'dl') {
      // A session token was passed in the URL — reject it.
      res.status(401).json({ error: 'Invalid token for this request' });
      return;
    }
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
