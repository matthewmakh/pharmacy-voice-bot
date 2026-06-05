/**
 * Centralized New York legal constants and derivations.
 *
 * Every statutory figure, deadline, and court-routing threshold lives here so it
 * is asserted from code — never recalled by the language model. Prompts inject
 * these values; verification checks against them. If the law changes, change it
 * once, here.
 */

// ─── Statutory figures ──────────────────────────────────────────────────────────

/** CPLR §5004 — statutory pre/post-judgment interest for commercial (non-consumer) debt. */
export const STATUTORY_INTEREST_RATE = 9; // percent per annum

/**
 * Consumer-debt judgments accrue at 2% under the 2022 amendment to CPLR §5004(a).
 * B2B commercial debt (this product's domain) remains at 9%. Surfaced so callers
 * can flag the distinction when a debtor is an individual.
 */
export const CONSUMER_JUDGMENT_INTEREST_RATE = 2;

/** CPLR §213(2) — six-year limitations period for breach of contract and account stated. */
export const SOL_YEARS_CONTRACT = 6;

/** CPLR §320(a) — answer deadlines after service of a summons. */
export const ANSWER_DAYS_PERSONAL_SERVICE = 20;
export const ANSWER_DAYS_OTHER_SERVICE = 30;

/** CPLR §306-b — a summons must be served within 120 days of filing. */
export const SERVICE_WINDOW_DAYS = 120;

/** CPLR §5231 — income execution caps wage garnishment at 10% of gross wages. */
export const WAGE_GARNISHMENT_PCT = 10;

// ─── Court routing by outstanding balance ───────────────────────────────────────

export type CourtTrack = 'commercial' | 'civil' | 'supreme';

export const COMMERCIAL_CLAIMS_LIMIT = 10_000; // NYC Civil Court — Commercial Claims Part
export const CIVIL_COURT_LIMIT = 50_000; // NYC Civil Court jurisdictional limit

export interface TrackMeta {
  track: CourtTrack;
  formType: string;
  /** Plain-language fee description for instructions. */
  fee: string;
  office: string;
  maxAmount: string;
  /** Court name as it should read in a document caption. */
  courtName: string;
}

export const TRACK_META: Record<CourtTrack, TrackMeta> = {
  commercial: {
    track: 'commercial',
    formType: 'Commercial Claims Court — CIV-SC-70',
    fee: '$25 (plus postage)',
    office: 'NYC Civil Court — Commercial Claims Clerk',
    maxAmount: '$10,000',
    courtName: 'Civil Court of the City of New York — Commercial Claims Part',
  },
  civil: {
    track: 'civil',
    formType: 'NYC Civil Court — Pro Se Summons & Complaint',
    fee: '~$45',
    office: 'NYC Civil Court Clerk',
    maxAmount: '$50,000',
    courtName: 'Civil Court of the City of New York',
  },
  supreme: {
    track: 'supreme',
    formType: 'Supreme Court of the State of New York — Summons with Notice',
    fee: '$210 (index number)',
    office: 'County Clerk (Supreme Court)',
    maxAmount: 'Unlimited',
    courtName: 'Supreme Court of the State of New York',
  },
};

/** Route an outstanding balance to the correct NY court track. */
export function trackForAmount(outstanding: number): CourtTrack {
  if (outstanding <= COMMERCIAL_CLAIMS_LIMIT) return 'commercial';
  if (outstanding <= CIVIL_COURT_LIMIT) return 'civil';
  return 'supreme';
}

/** Single source of truth for outstanding balance: amountOwed − amountPaid, never negative. */
export function outstandingBalance(
  amountOwed: number | string | null | undefined,
  amountPaid: number | string | null | undefined,
): number {
  const owed = Number(amountOwed ?? 0) || 0;
  const paid = Number(amountPaid ?? 0) || 0;
  return Math.max(0, owed - paid);
}

/** Money formatter shared by prompts, PDFs, and verification (e.g. 4500 → "4,500.00"). */
export function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
