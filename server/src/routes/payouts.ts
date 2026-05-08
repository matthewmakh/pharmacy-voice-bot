/**
 * Stripe Connect payout management for the user (claimant).
 *
 * Routes:
 *   GET  /api/payouts/status       — current Connect account state
 *   POST /api/payouts/onboarding   — start (or resume) Express onboarding
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import {
  createConnectAccount,
  createConnectOnboardingLink,
  getAccountStatus,
} from '../services/stripe';

const router = Router();
router.use(requireAuth);

router.get('/status', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.stripeAccountId) {
      return res.json({
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
    }

    // Refresh status from Stripe (so we don't drift from cached DB state)
    try {
      const status = await getAccountStatus(user.stripeAccountId);
      // Mirror chargesEnabled/payoutsEnabled into our DB
      if (
        user.stripeAccountChargesEnabled !== status.chargesEnabled
        || user.stripeAccountPayoutsEnabled !== status.payoutsEnabled
      ) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            stripeAccountChargesEnabled: status.chargesEnabled,
            stripeAccountPayoutsEnabled: status.payoutsEnabled,
          },
        });
      }
      return res.json({ accountId: user.stripeAccountId, ...status });
    } catch (err) {
      console.warn('[payouts] Stripe status fetch failed; returning cached:', err);
      return res.json({
        accountId: user.stripeAccountId,
        chargesEnabled: user.stripeAccountChargesEnabled,
        payoutsEnabled: user.stripeAccountPayoutsEnabled,
        detailsSubmitted: user.stripeAccountChargesEnabled || user.stripeAccountPayoutsEnabled,
      });
    }
  } catch (err) {
    console.error('payouts status error:', err);
    return res.status(500).json({ error: 'Failed to load payout status' });
  }
});

router.post('/onboarding', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let accountId = user.stripeAccountId;
    if (!accountId) {
      accountId = await createConnectAccount(user.email);
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeAccountId: accountId },
      });
    }

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
    const url = await createConnectOnboardingLink(
      accountId,
      `${baseUrl}/settings/payouts`,
      `${baseUrl}/settings/payouts?onboarded=1`,
    );

    return res.json({ accountId, onboardingUrl: url });
  } catch (err) {
    console.error('payouts onboarding error:', err);
    return res.status(500).json({ error: 'Failed to start Stripe onboarding' });
  }
});

export default router;
