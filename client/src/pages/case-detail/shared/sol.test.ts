import { describe, it, expect } from 'vitest';
import { computeSOL, solForCase } from './sol';

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

describe('computeSOL', () => {
  it('is unknown when no due date is set', () => {
    expect(computeSOL(null).status).toBe('unknown');
  });

  it('reports years remaining for a recent breach', () => {
    const dueDate = isoDaysFromNow(-30); // 30 days ago → ~6yr remaining
    const r = computeSOL(dueDate);
    expect(r.status).toBe('ok');
    expect(r.daysRemaining! > 365 * 5).toBe(true);
  });

  it('reports expired when the 6-year window has passed', () => {
    const dueDate = isoDaysFromNow(-365 * 7); // 7 years ago
    const r = computeSOL(dueDate);
    expect(r.status).toBe('expired');
  });

  it('restarts the clock from a later acknowledgment / partial payment', () => {
    const dueDate = isoDaysFromNow(-365 * 7); // would be expired on its own
    const ack = isoDaysFromNow(-10); // acknowledged 10 days ago
    const r = computeSOL(dueDate, ack);
    expect(r.status).not.toBe('expired');
    expect(r.resetByAcknowledgment).toBe(true);
  });
});

describe('solForCase', () => {
  it('uses the most recent PAYMENT_RECEIVED action as the acknowledgment date', () => {
    const r = solForCase({
      paymentDueDate: isoDaysFromNow(-365 * 7),
      actions: [
        { type: 'CASE_CREATED', createdAt: isoDaysFromNow(-400) },
        { type: 'PAYMENT_RECEIVED', createdAt: isoDaysFromNow(-5) },
      ],
    });
    expect(r.status).not.toBe('expired');
    expect(r.resetByAcknowledgment).toBe(true);
  });
});
