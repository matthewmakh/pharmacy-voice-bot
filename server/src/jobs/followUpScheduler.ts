/**
 * Auto follow-up cadence scheduler (BullMQ on Redis).
 *
 * When a demand letter is sent, the case enters a per-strategy cadence:
 *   QUICK_ESCALATION:  days 0, 3, 7, 10, 14
 *   STANDARD_RECOVERY: days 0, 7, 14, 21, 28
 *   GRADUAL_APPROACH:  days 0, 14, 30, 45, 60
 *
 * Each step sends a Resend email reminding the debtor of the open balance.
 * Cancel triggers (checked at job execution time):
 *   - case.amountCollectedCents > 0     → debtor paid via portal
 *   - case.settlementSignedAt           → settlement was signed
 *   - case.defendantDisputeText         → debtor filed a dispute
 *   - case.followUpEnabled === false    → manually disabled
 *
 * Redis is optional in dev: if REDIS_URL is unset the scheduler logs a
 * warning and becomes a no-op. The rest of the app keeps working.
 */

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../lib/prisma';
import { sendEmail } from './../services/resend';

const redisUrl = process.env.REDIS_URL;

interface FollowUpJobData {
  caseId: string;
  stepIndex: number;
}

const QUEUE_NAME = 'follow-up';

const CADENCE: Record<string, number[]> = {
  QUICK_ESCALATION:  [0, 3, 7, 10, 14],
  STANDARD_RECOVERY: [0, 7, 14, 21, 28],
  GRADUAL_APPROACH:  [0, 14, 30, 45, 60],
};

let connection: IORedis | null = null;
let queue: Queue<FollowUpJobData> | null = null;
let worker: Worker<FollowUpJobData> | null = null;

function init() {
  if (!redisUrl) {
    console.warn('[follow-up] REDIS_URL not set — scheduler is disabled');
    return;
  }
  if (connection) return;

  connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue<FollowUpJobData>(QUEUE_NAME, { connection });

  worker = new Worker<FollowUpJobData>(
    QUEUE_NAME,
    async (job: Job<FollowUpJobData>) => processFollowUpStep(job.data),
    { connection, concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[follow-up] job ${job?.id} failed:`, err);
  });
}

init();

// ─── Public API ──────────────────────────────────────────────────────────────

export async function startFollowUpForCase(caseId: string): Promise<void> {
  if (!queue) return;

  const c = await prisma.case.findUnique({ where: { id: caseId } });
  if (!c || !c.strategy) return;

  const cadence = CADENCE[c.strategy] || CADENCE.STANDARD_RECOVERY;

  await prisma.case.update({
    where: { id: caseId },
    data: {
      followUpEnabled: true,
      followUpStartedAt: new Date(),
      followUpStepIndex: 0,
      followUpNextRunAt: new Date(Date.now() + cadence[1] * 24 * 60 * 60 * 1000),
    },
  });

  // Schedule each step. Step 0 = day 0 (just sent), so we start at index 1.
  for (let i = 1; i < cadence.length; i++) {
    const delayMs = cadence[i] * 24 * 60 * 60 * 1000;
    await queue.add(
      `case-${caseId}-step-${i}`,
      { caseId, stepIndex: i },
      {
        delay: delayMs,
        jobId: `${caseId}:${i}`, // dedup: re-scheduling won't double-add
        removeOnComplete: { age: 30 * 24 * 60 * 60 }, // keep 30d for debugging
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
  }
}

export async function cancelFollowUpForCase(caseId: string): Promise<void> {
  if (!queue) return;

  const c = await prisma.case.findUnique({ where: { id: caseId } });
  if (!c?.strategy) return;

  const cadence = CADENCE[c.strategy] || CADENCE.STANDARD_RECOVERY;
  for (let i = 1; i < cadence.length; i++) {
    const job = await queue.getJob(`${caseId}:${i}`);
    if (job) await job.remove();
  }

  await prisma.case.update({
    where: { id: caseId },
    data: { followUpEnabled: false, followUpNextRunAt: null },
  });
}

// ─── Worker logic ────────────────────────────────────────────────────────────

async function processFollowUpStep(data: FollowUpJobData): Promise<void> {
  const c = await prisma.case.findUnique({ where: { id: data.caseId } });
  if (!c) return;

  // Cancel triggers — silently skip if any are met
  if (!c.followUpEnabled) return;
  if (c.amountCollectedCents && c.amountCollectedCents > 0) return;
  if (c.settlementSignedAt) return;
  if (c.defendantDisputeText) return;
  if (!c.debtorEmail) return;

  const claimantName = c.claimantBusiness || c.claimantName || 'Reclaim';
  const portalUrl = c.portalToken
    ? `${process.env.PUBLIC_BASE_URL || 'http://localhost:5173'}/respond/${c.portalToken}`
    : null;

  const subject = `Reminder: payment due to ${claimantName}`;
  const html = buildFollowUpHtml({
    claimantName,
    amountOwed: c.amountOwed?.toString() || '',
    invoiceNumber: c.invoiceNumber || null,
    portalUrl,
    stepIndex: data.stepIndex,
  });

  await sendEmail({
    to: c.debtorEmail,
    subject,
    html,
    caseId: c.id,
    kind: `follow-up-step-${data.stepIndex}`,
    replyTo: c.claimantEmail || undefined,
  });

  await prisma.case.update({
    where: { id: c.id },
    data: {
      followUpStepIndex: data.stepIndex,
      followUpNextRunAt: nextScheduledRun(c.strategy, data.stepIndex),
      actions: {
        create: {
          type: 'FOLLOW_UP_SENT',
          label: `Follow-up email step ${data.stepIndex} sent`,
        },
      },
    },
  });
}

function nextScheduledRun(strategy: string | null, currentStepIndex: number): Date | null {
  if (!strategy) return null;
  const cadence = CADENCE[strategy];
  if (!cadence) return null;
  const next = cadence[currentStepIndex + 1];
  if (next === undefined) return null;
  return new Date(Date.now() + (next - cadence[currentStepIndex]) * 24 * 60 * 60 * 1000);
}

function buildFollowUpHtml(opts: {
  claimantName: string;
  amountOwed: string;
  invoiceNumber: string | null;
  portalUrl: string | null;
  stepIndex: number;
}): string {
  const amount = opts.amountOwed
    ? `$${Number(opts.amountOwed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : '';
  const tone = opts.stepIndex >= 4
    ? 'This is the last reminder before this matter is escalated. Please respond today.'
    : opts.stepIndex >= 2
      ? 'We have not received payment or a response from you. Please act now to avoid escalation.'
      : 'This is a friendly reminder that the balance below remains outstanding.';

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
<p>Hello,</p>
<p>${tone}</p>
<table style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;width:100%">
<tr><td style="padding:4px 0"><strong>Claimant:</strong></td><td>${opts.claimantName}</td></tr>
${amount ? `<tr><td style="padding:4px 0"><strong>Amount due:</strong></td><td>${amount}</td></tr>` : ''}
${opts.invoiceNumber ? `<tr><td style="padding:4px 0"><strong>Invoice:</strong></td><td>${opts.invoiceNumber}</td></tr>` : ''}
</table>
${opts.portalUrl
  ? `<p style="margin-top:24px"><a href="${opts.portalUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Pay or respond</a></p>`
  : '<p>Please contact the claimant to resolve this balance.</p>'}
<p style="color:#6b7280;font-size:12px;margin-top:32px">If you believe this email is in error, please reply to let us know.</p>
</body></html>`;
}

// ─── Convenience: cancel-on-event hook (called from webhooks/portal) ─────────

export async function cancelOnPaymentOrSettlement(caseId: string): Promise<void> {
  await cancelFollowUpForCase(caseId);
}
