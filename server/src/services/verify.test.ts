import { describe, it, expect } from 'vitest';
import { verifyDocumentFacts } from './verify';

const caseData = {
  claimantBusiness: 'Acme Services LLC',
  debtorBusiness: 'Client Corp Inc.',
  amountOwed: '5000.00',
  amountPaid: '500.00',
  invoiceNumber: 'INV-2024-001',
};

describe('verifyDocumentFacts', () => {
  it('passes when all key facts appear in the document', () => {
    const html = `<p>From Acme Services LLC to Client Corp Inc. — outstanding balance $4,500.00 on invoice INV-2024-001.</p>`;
    const v = verifyDocumentFacts('demand-letter', html, caseData);
    expect(v.overallStatus).toBe('verified');
  });

  it('flags issues_found when the outstanding amount is wrong/absent', () => {
    // Uses the full owed amount, not the outstanding balance.
    const html = `<p>Acme Services LLC v. Client Corp Inc. — amount due $5,000.00, invoice INV-2024-001.</p>`;
    const v = verifyDocumentFacts('demand-letter', html, caseData);
    expect(v.overallStatus).toBe('issues_found');
    expect(v.checks.some((c) => c.field === 'Outstanding balance' && c.status === 'mismatch')).toBe(true);
  });

  it('flags issues_found when a party name is missing', () => {
    const html = `<p>Demand for $4,500.00 on invoice INV-2024-001 from Acme Services LLC.</p>`;
    const v = verifyDocumentFacts('demand-letter', html, caseData);
    expect(v.overallStatus).toBe('issues_found');
    expect(v.checks.some((c) => c.field.includes('Debtor') && c.status === 'missing')).toBe(true);
  });

  it('checks the FULL owed amount for a settlement (settlement amount stays blank)', () => {
    const html = `<p>Acme Services LLC and Client Corp Inc. — original debt $5,000.00. Settlement amount: [TO BE NEGOTIATED].</p>`;
    const v = verifyDocumentFacts('settlement', html, caseData);
    expect(v.overallStatus).toBe('verified');
  });

  it('returns review_needed when fields are left as [UNKNOWN] but key facts match', () => {
    const html = `<p>Acme Services LLC v. Client Corp Inc., $4,500.00, invoice INV-2024-001. Address: [UNKNOWN — VERIFY BEFORE FILING].</p>`;
    const v = verifyDocumentFacts('court-form', html, caseData);
    expect(v.overallStatus).toBe('review_needed');
    expect(v.blankFields.length).toBeGreaterThan(0);
  });
});
