export interface SolResult {
  solDate: Date | null;
  daysRemaining: number | null;
  status: 'ok' | 'warning' | 'urgent' | 'expired' | 'unknown';
  label: string;
  solDateFormatted: string | null;
  /** True when the clock was restarted by a later acknowledgment / partial payment. */
  resetByAcknowledgment?: boolean;
}

/**
 * NY CPLR §213: 6 years from breach (the missed payment due date) for breach of
 * contract and account stated. Under GOL §17-101 / §17-107, a written acknowledgment
 * of the debt or a partial payment RESTARTS the limitations period — so when a later
 * acknowledgment date is known, the clock runs from there. (The previous version
 * ignored this and could show "expired" on a debt that had actually been revived,
 * contradicting the app's own settlement/payment-plan language.)
 */
export function computeSOL(paymentDueDate: string | null | undefined, acknowledgmentDate?: string | null): SolResult {
  const breach = paymentDueDate ? new Date(paymentDueDate) : null;
  const ack = acknowledgmentDate ? new Date(acknowledgmentDate) : null;
  const breachValid = !!(breach && !isNaN(breach.getTime()));
  const ackValid = !!(ack && !isNaN(ack.getTime()));

  if (!breachValid && !ackValid) {
    return { solDate: null, daysRemaining: null, status: 'unknown', label: 'Unknown — payment due date not set', solDateFormatted: null };
  }

  // Anchor = the later of breach and a qualifying acknowledgment.
  let anchor = breachValid ? breach! : ack!;
  let resetByAcknowledgment = false;
  if (ackValid && (!breachValid || ack! > anchor)) {
    anchor = ack!;
    resetByAcknowledgment = breachValid;
  }

  const solDate = new Date(anchor);
  solDate.setFullYear(solDate.getFullYear() + 6);
  const today = new Date();
  const daysRemaining = Math.floor((solDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const solDateFormatted = solDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const resetNote = resetByAcknowledgment ? ' (clock restarted by acknowledgment/partial payment)' : '';

  if (daysRemaining < 0) {
    return { solDate, daysRemaining, status: 'expired', label: `Expired ${Math.abs(daysRemaining)} days ago — consult an attorney immediately`, solDateFormatted, resetByAcknowledgment };
  }
  if (daysRemaining <= 90) {
    return { solDate, daysRemaining, status: 'urgent', label: `${daysRemaining} days remaining — file immediately (expires ${solDateFormatted})${resetNote}`, solDateFormatted, resetByAcknowledgment };
  }
  if (daysRemaining <= 365) {
    const months = Math.floor(daysRemaining / 30);
    return { solDate, daysRemaining, status: 'warning', label: `~${months} months remaining — file within the year (expires ${solDateFormatted})${resetNote}`, solDateFormatted, resetByAcknowledgment };
  }
  const years = Math.floor(daysRemaining / 365);
  const remainingMonths = Math.floor((daysRemaining % 365) / 30);
  const base = remainingMonths > 0 ? `${years} yr ${remainingMonths} mo remaining` : `${years} yr remaining`;
  return { solDate, daysRemaining, status: 'ok', label: `${base} (expires ${solDateFormatted})${resetNote}`, solDateFormatted, resetByAcknowledgment };
}

/** Compute the SOL for a case, accounting for the most recent acknowledgment/partial payment. */
export function solForCase(c: { paymentDueDate: string | null; actions?: Array<{ type: string; createdAt: string }> }): SolResult {
  const lastPayment = (c.actions ?? [])
    .filter((a) => a.type === 'PAYMENT_RECEIVED')
    .map((a) => a.createdAt)
    .sort()
    .pop() ?? null;
  return computeSOL(c.paymentDueDate, lastPayment);
}

export const SOL_STATUS_TONE = {
  ok: 'success',
  warning: 'warning',
  urgent: 'danger',
  expired: 'danger',
  unknown: 'neutral',
} as const;
