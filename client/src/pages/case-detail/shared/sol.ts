export function computeSOL(paymentDueDate: string | null | undefined): {
  solDate: Date | null;
  daysRemaining: number | null;
  status: 'ok' | 'warning' | 'urgent' | 'expired' | 'unknown';
  label: string;
  solDateFormatted: string | null;
} {
  if (!paymentDueDate) {
    return { solDate: null, daysRemaining: null, status: 'unknown', label: 'Unknown — payment due date not set', solDateFormatted: null };
  }
  const breach = new Date(paymentDueDate);
  if (isNaN(breach.getTime())) {
    return { solDate: null, daysRemaining: null, status: 'unknown', label: 'Unknown — invalid date', solDateFormatted: null };
  }
  // NY CPLR §213: 6 years from breach date for breach of contract (written or oral) and account stated
  const solDate = new Date(breach);
  solDate.setFullYear(solDate.getFullYear() + 6);
  const today = new Date();
  const daysRemaining = Math.floor((solDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const solDateFormatted = solDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (daysRemaining < 0) {
    return { solDate, daysRemaining, status: 'expired', label: `Expired ${Math.abs(daysRemaining)} days ago — consult an attorney immediately`, solDateFormatted };
  }
  if (daysRemaining <= 90) {
    return { solDate, daysRemaining, status: 'urgent', label: `${daysRemaining} days remaining — file immediately (expires ${solDateFormatted})`, solDateFormatted };
  }
  if (daysRemaining <= 365) {
    const months = Math.floor(daysRemaining / 30);
    return { solDate, daysRemaining, status: 'warning', label: `~${months} months remaining — file within the year (expires ${solDateFormatted})`, solDateFormatted };
  }
  const years = Math.floor(daysRemaining / 365);
  const remainingMonths = Math.floor((daysRemaining % 365) / 30);
  const label = remainingMonths > 0
    ? `${years} yr ${remainingMonths} mo remaining (expires ${solDateFormatted})`
    : `${years} yr remaining (expires ${solDateFormatted})`;
  return { solDate, daysRemaining, status: 'ok', label, solDateFormatted };
}

export const SOL_STATUS_TONE = {
  ok: 'success',
  warning: 'warning',
  urgent: 'danger',
  expired: 'danger',
  unknown: 'neutral',
} as const;
