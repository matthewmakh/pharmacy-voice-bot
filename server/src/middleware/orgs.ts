import { Request, Response, NextFunction } from 'express';
import { userOrgIds, ensurePersonalOrg } from '../lib/org';

/**
 * Loads the authenticated user's organization ids onto req.orgIds. Case routes scope
 * their queries by these. Must run after requireAuth. Self-heals: if a user somehow
 * has no membership yet, a personal org is created on the fly.
 */
export async function loadOrgs(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    let ids = await userOrgIds(req.user.id);
    if (ids.length === 0) {
      await ensurePersonalOrg(req.user);
      ids = await userOrgIds(req.user.id);
    }
    req.orgIds = ids;
    next();
  } catch (err) {
    console.error('loadOrgs failed:', err);
    res.status(500).json({ error: 'Failed to resolve organization' });
  }
}
