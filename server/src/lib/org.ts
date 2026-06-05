/**
 * Organization helpers for multi-tenancy.
 *
 * Every user gets a personal Organization (created on register, or backfilled at
 * startup for pre-existing accounts). A Case belongs to an Organization, and every
 * member of that org can see it — which is what lets a firm/team share cases. Access
 * is scoped by organization membership, not by the individual creator.
 */
import prisma from './prisma';

/** Find or create the user's personal (OWNER) organization; returns its id. */
export async function ensurePersonalOrg(user: { id: string; email: string; name?: string | null }): Promise<string> {
  const existing = await prisma.membership.findFirst({ where: { userId: user.id, role: 'OWNER' }, select: { organizationId: true } });
  if (existing) return existing.organizationId;
  const base = user.name?.trim() || user.email.split('@')[0];
  const org = await prisma.organization.create({
    data: { name: `${base}'s workspace`, memberships: { create: { userId: user.id, role: 'OWNER' } } },
  });
  return org.id;
}

/** All organization ids the user belongs to (the visibility scope for cases). */
export async function userOrgIds(userId: string): Promise<string[]> {
  const ms = await prisma.membership.findMany({ where: { userId }, select: { organizationId: true } });
  return ms.map((m) => m.organizationId);
}

/** The org new cases should be created in (the user's own OWNER org). */
export async function primaryOrgId(userId: string): Promise<string | null> {
  const owner = await prisma.membership.findFirst({ where: { userId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { organizationId: true } });
  if (owner) return owner.organizationId;
  const any = await prisma.membership.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { organizationId: true } });
  return any?.organizationId ?? null;
}

/** True if the case is within one of the given orgs (the access check for writes). */
export async function caseInScope(caseId: string, orgIds: string[]): Promise<boolean> {
  if (orgIds.length === 0) return false;
  const c = await prisma.case.findFirst({ where: { id: caseId, organizationId: { in: orgIds } }, select: { id: true } });
  return !!c;
}
