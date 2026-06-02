/**
 * Document verification — deterministic where it counts, LLM only where it helps.
 *
 * The previous design used a second Claude call to "verify" each generated document,
 * then a third to retry. That was unreliable (an LLM hallucinating about another LLM's
 * output), self-contradicting (it flagged the injected courthouse address as
 * "hallucinated", so the retry prompt had to argue back), and the dominant cost/latency
 * driver. Checking whether the right party name, amount, and dates appear in the HTML is
 * a string/number comparison — so we do it in code: fast, free, and actually correct.
 *
 * `reviseDocument` is the single shared corrector — one Claude call, only invoked when
 * the deterministic check finds fixable issues. It replaces five near-identical retry
 * functions.
 */

import { generateHTML } from '../lib/anthropic';
import { outstandingBalance, formatMoney } from '../lib/legal';
import { countyForDocument } from '../lib/county';
import type { CourtFormVerification, VerificationCheck, DemandLetterResult } from './claude';

export type DocKind = 'demand-letter' | 'final-notice' | 'court-form' | 'default-judgment' | 'settlement' | 'payment-plan';

const KIND_LABEL: Record<DocKind, string> = {
  'demand-letter': 'demand letter',
  'final-notice': 'pre-filing notice',
  'court-form': 'court form',
  'default-judgment': 'motion for default judgment',
  'settlement': 'stipulation of settlement',
  'payment-plan': 'payment plan agreement',
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
}
/** Lowercased, punctuation-squashed text for tolerant name matching. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, '').replace(/[^a-z0-9$\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Deterministically verify that a generated document reflects the case facts.
 * Returns the same CourtFormVerification shape the frontend already renders.
 */
export function verifyDocumentFacts(kind: DocKind, html: string, caseData: Record<string, unknown>): CourtFormVerification {
  const rawText = stripTags(html);
  const hay = squash(rawText);
  const has = (needle: string): boolean => {
    const n = squash(needle);
    return n.length > 0 && hay.includes(n);
  };

  const checks: VerificationCheck[] = [];

  // Parties — at least one of name/business for each side must appear.
  const claimant = str(caseData.claimantBusiness) ?? str(caseData.claimantName);
  const debtor = str(caseData.debtorBusiness) ?? str(caseData.debtorName);
  if (claimant) {
    const ok = has(claimant);
    checks.push({ field: 'Claimant / Creditor name', status: ok ? 'ok' : 'missing', expected: claimant, found: ok ? claimant : null, note: ok ? '' : 'Claimant name from the case data does not appear in the document.' });
  }
  if (debtor) {
    const ok = has(debtor);
    checks.push({ field: 'Debtor / Defendant name', status: ok ? 'ok' : 'missing', expected: debtor, found: ok ? debtor : null, note: ok ? '' : 'Debtor name from the case data does not appear in the document.' });
  }

  // Money. Settlement deliberately leaves the settlement amount blank, but the FULL
  // original debt must appear (default/acceleration clause); every other document
  // should reflect the outstanding balance.
  const owed = Number(caseData.amountOwed ?? 0) || 0;
  const outstanding = outstandingBalance(caseData.amountOwed as number, caseData.amountPaid as number);
  const target = kind === 'settlement' ? owed : outstanding;
  const targetLabel = kind === 'settlement' ? 'Original debt amount' : 'Outstanding balance';
  if (target > 0) {
    const ok = hasMoney(rawText, target);
    checks.push({ field: targetLabel, status: ok ? 'ok' : 'mismatch', expected: `$${formatMoney(target)}`, found: ok ? `$${formatMoney(target)}` : null, note: ok ? '' : `The expected amount $${formatMoney(target)} (${kind === 'settlement' ? 'amountOwed' : 'amountOwed − amountPaid'}) was not found in the document.` });
  }

  // Invoice number, when present in the data.
  const invoiceNumber = str(caseData.invoiceNumber);
  if (invoiceNumber) {
    const ok = has(invoiceNumber);
    checks.push({ field: 'Invoice number', status: ok ? 'ok' : 'missing', expected: invoiceNumber, found: ok ? invoiceNumber : null, note: ok ? '' : 'Invoice number from the case data does not appear in the document.' });
  }

  // Blank placeholders the generator could not fill.
  const blankFields: string[] = [];
  const unknownCount = (html.match(/\[UNKNOWN/gi) || []).length;
  if (unknownCount > 0) blankFields.push(`${unknownCount} field(s) marked “[UNKNOWN — VERIFY BEFORE FILING]”`);

  const hardIssues = checks.filter((c) => c.status === 'missing' || c.status === 'mismatch');
  let overallStatus: CourtFormVerification['overallStatus'];
  let summary: string;
  if (hardIssues.length > 0) {
    overallStatus = 'issues_found';
    summary = `Automated fact check found ${hardIssues.length} item(s) that don't match your case data and should be corrected.`;
  } else if (blankFields.length > 0) {
    overallStatus = 'review_needed';
    summary = `All key facts match your case data. ${unknownCount} field(s) were left blank because the information wasn't on file — fill these in before filing.`;
  } else {
    overallStatus = 'verified';
    summary = 'Automated fact check passed: all key party names and amounts match your case data.';
  }

  return { overallStatus, checks, summary, blankFields, verifiedAt: new Date().toISOString() };
}

function hasMoney(text: string, n: number): boolean {
  const variants = [
    formatMoney(n), // 4,500.00
    Math.round(n).toLocaleString('en-US'), // 4,500
    n.toFixed(2), // 4500.00
    String(Math.round(n)), // 4500
  ];
  return variants.some((v) => text.includes(v));
}

/**
 * Ask Claude to fix the specific issues the deterministic check found, returning the
 * full corrected document. One call, shared across all document kinds.
 */
export async function reviseDocument(
  kind: DocKind,
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>,
): Promise<DemandLetterResult> {
  const issues = verification.checks.filter((c) => c.status !== 'ok');
  if (issues.length === 0) return { text: originalHtml, html: originalHtml };

  const issueList = issues
    .map((c) => `- ${c.field}: expected "${c.expected ?? '(from case data)'}" but it does not appear correctly in the document. ${c.note}`)
    .join('\n');

  const owed = Number(caseData.amountOwed ?? 0) || 0;
  const outstanding = outstandingBalance(caseData.amountOwed as number, caseData.amountPaid as number);
  const amountLine = kind === 'settlement'
    ? `- Original debt (for the default/acceleration clause): $${formatMoney(owed)}. Leave the negotiated settlement amount as a blank placeholder.`
    : `- Outstanding balance (the correct amount to use): $${formatMoney(outstanding)} (= amountOwed − amountPaid).`;

  let venueLine = '';
  if (kind === 'court-form' || kind === 'default-judgment') {
    const { county, civilAddr } = countyForDocument(caseData.debtorAddress as string | null);
    venueLine = `\n- Filing county: ${county}. Courthouse: ${civilAddr}. Do not change these — they are authoritative.`;
  }

  const prompt = `You previously generated a ${KIND_LABEL[kind]}. An automated fact check against the source case data found issues. Regenerate the FULL document with only these issues corrected — keep everything else identical.

SOURCE CASE DATA (absolute ground truth):
${JSON.stringify(caseData, null, 2)}

${amountLine}${venueLine}

ISSUES TO FIX:
${issueList}

If the case data genuinely does not contain a value, leave it as "[UNKNOWN — VERIFY BEFORE FILING]" rather than inventing it.

ORIGINAL DOCUMENT HTML (correct everything else; reproduce it):
${originalHtml.slice(0, 12000)}

Return ONLY the complete corrected HTML document. No JSON, no markdown, no code fences, no commentary. Use inline styles only.`;

  const html = await generateHTML({
    system: 'You are a legal document preparation assistant. The source case data always wins. Return only raw HTML — no JSON, no markdown, no code fences, no commentary.',
    prompt,
    maxTokens: 8192,
    label: `reviseDocument:${kind}`,
  });
  return { text: html, html: html || originalHtml };
}
