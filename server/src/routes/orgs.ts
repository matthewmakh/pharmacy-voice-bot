import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { loadOrgs } from '../middleware/orgs';

const router = Router();
router.use(requireAuth);
router.use(loadOrgs);

async function roleIn(userId: string, organizationId: string): Promise<'OWNER' | 'ADMIN' | 'MEMBER' | null> {
  const m = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

// GET /api/orgs — organizations the user belongs to
router.get('/', async (req: Request, res: Response) => {
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.id },
      select: { role: true, organization: { select: { id: true, name: true, _count: { select: { memberships: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role, memberCount: m.organization._count.memberships })));
  } catch (err) {
    console.error('List orgs error:', err);
    res.status(500).json({ error: 'Failed to load organizations' });
  }
});

// GET /api/orgs/:id/members
router.get('/:id/members', async (req: Request, res: Response) => {
  try {
    if (!(await roleIn(req.user!.id, req.params.id))) { res.status(404).json({ error: 'Organization not found' }); return; }
    const members = await prisma.membership.findMany({
      where: { organizationId: req.params.id },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.createdAt })));
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// POST /api/orgs/:id/invite — add an existing Reclaim user to the org by email
router.post('/:id/invite', async (req: Request, res: Response) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const myRole = await roleIn(req.user!.id, req.params.id);
    if (!myRole) { res.status(404).json({ error: 'Organization not found' }); return; }
    if (myRole === 'MEMBER') { res.status(403).json({ error: 'Only owners and admins can add members' }); return; }

    const user = await prisma.user.findFirst({ where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } }, select: { id: true, name: true, email: true } });
    if (!user) { res.status(404).json({ error: 'No Reclaim account uses that email. Ask them to sign up first, then invite them.' }); return; }

    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: req.params.id } },
      create: { userId: user.id, organizationId: req.params.id, role: 'MEMBER' },
      update: {},
    });
    res.status(201).json({ userId: user.id, name: user.name, email: user.email, role: 'MEMBER' });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'A valid email is required' }); return; }
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// DELETE /api/orgs/:id/members/:userId — remove a member
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const myRole = await roleIn(req.user!.id, req.params.id);
    if (!myRole) { res.status(404).json({ error: 'Organization not found' }); return; }
    const removingSelf = req.params.userId === req.user!.id;
    if (myRole === 'MEMBER' && !removingSelf) { res.status(403).json({ error: 'Only owners and admins can remove members' }); return; }

    // Never strip the last owner — it would orphan the org and its cases.
    const target = await prisma.membership.findUnique({ where: { userId_organizationId: { userId: req.params.userId, organizationId: req.params.id } }, select: { role: true } });
    if (!target) { res.status(404).json({ error: 'Member not found' }); return; }
    if (target.role === 'OWNER') {
      const owners = await prisma.membership.count({ where: { organizationId: req.params.id, role: 'OWNER' } });
      if (owners <= 1) { res.status(400).json({ error: 'Cannot remove the last owner of an organization' }); return; }
    }

    await prisma.membership.delete({ where: { userId_organizationId: { userId: req.params.userId, organizationId: req.params.id } } });
    res.json({ success: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// PATCH /api/orgs/:id — rename (owner only)
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    if ((await roleIn(req.user!.id, req.params.id)) !== 'OWNER') { res.status(403).json({ error: 'Only the owner can rename the organization' }); return; }
    const org = await prisma.organization.update({ where: { id: req.params.id }, data: { name }, select: { id: true, name: true } });
    res.json(org);
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'A valid name is required' }); return; }
    console.error('Rename org error:', err);
    res.status(500).json({ error: 'Failed to rename organization' });
  }
});

export default router;
