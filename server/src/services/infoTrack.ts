/**
 * InfoTrack court e-filing integration — paid path for filing complaints
 * and default judgment motions through NYSCEF (Supreme) or EDDS (Civil pro se).
 *
 * Reclaim charges $200 service fee + the actual court filing fee passthrough.
 * InfoTrack's API is not publicly documented; shapes here are best-effort
 * and need confirmation during the user's InfoTrack onboarding.
 */

const apiKey = process.env.INFOTRACK_API_KEY;
const BASE   = process.env.INFOTRACK_API_BASE || 'https://api.infotrack.com/v1';

if (!apiKey) {
  console.warn('[infoTrack] INFOTRACK_API_KEY not set — paid e-filing will fail');
}

function authHeaders(): Record<string, string> {
  if (!apiKey) throw new Error('InfoTrack not configured');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// ─── Court fee schedule (USD, used for invoicing) ────────────────────────────

export interface FilingTrack {
  platform: 'nyscef' | 'edds' | 'commercial-claims';
  /** Filing fee in dollars */
  feeUsd: number;
}

export function pickTrackForAmount(amountOwedUsd: number, purpose: 'complaint' | 'default-judgment'): FilingTrack {
  if (purpose === 'default-judgment') {
    // Default judgment motions are typically free; some counties charge a $45 motion fee
    return amountOwedUsd > 50000
      ? { platform: 'nyscef', feeUsd: 0 }
      : { platform: 'edds', feeUsd: 45 };
  }
  // Initial complaint
  if (amountOwedUsd <= 10000) return { platform: 'commercial-claims', feeUsd: 35 };
  if (amountOwedUsd <= 50000) return { platform: 'edds', feeUsd: 45 };
  return { platform: 'nyscef', feeUsd: 210 };
}

// ─── E-filing API ────────────────────────────────────────────────────────────

export interface EFileParams {
  caseId: string;
  platform: 'nyscef' | 'edds';
  purpose: 'complaint' | 'default-judgment';
  /** Existing index number (required for default-judgment filings into an open case) */
  existingIndexNumber?: string;
  /** PDF document(s) to file */
  documents: Array<{ name: string; base64: string }>;
  /** Court routing */
  court: {
    /** e.g. "NY Supreme Court — New York County" */
    name: string;
    county: string;
    /** Optional case type for new filings */
    caseType?: string;
  };
  /** Plaintiff (creditor) info */
  plaintiff: {
    name: string;
    address: string;
    email: string;
    phone?: string;
  };
  /** Defendant (debtor) info */
  defendant: {
    name: string;
    address: string;
    email?: string;
  };
  /** Claim amount in dollars */
  amount: number;
}

export interface EFileResult {
  orderId: string;
  status: 'submitted' | 'accepted' | 'rejected';
  /** Court-assigned index number, populated after acceptance */
  indexNumber: string | null;
}

export async function submitEFiling(params: EFileParams): Promise<EFileResult> {
  const r = await fetch(`${BASE}/efilings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      external_id: params.caseId,
      platform: params.platform,
      filing_type: params.purpose === 'default-judgment' ? 'motion-default-judgment' : 'complaint',
      existing_index_number: params.existingIndexNumber,
      court: params.court,
      parties: {
        plaintiff: params.plaintiff,
        defendant: params.defendant,
      },
      claim_amount: params.amount,
      documents: params.documents,
      metadata: { caseId: params.caseId, purpose: params.purpose },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`InfoTrack submit failed: HTTP ${r.status} ${text}`);
  }
  const body = await r.json() as {
    id: string;
    status: string;
    index_number?: string;
  };
  return {
    orderId: body.id,
    status: (body.status as EFileResult['status']) || 'submitted',
    indexNumber: body.index_number ?? null,
  };
}

export async function getEFilingStatus(orderId: string): Promise<EFileResult & { rejectionReason?: string }> {
  const r = await fetch(`${BASE}/efilings/${orderId}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`InfoTrack status fetch failed: HTTP ${r.status}`);
  const body = await r.json() as {
    id: string;
    status: string;
    index_number?: string;
    rejection_reason?: string;
  };
  return {
    orderId: body.id,
    status: body.status as EFileResult['status'],
    indexNumber: body.index_number ?? null,
    rejectionReason: body.rejection_reason,
  };
}

// ─── Webhook payload ─────────────────────────────────────────────────────────

export type InfoTrackEventType =
  | 'efiling.submitted'
  | 'efiling.accepted'
  | 'efiling.rejected'
  | 'efiling.filed';

export interface InfoTrackWebhookPayload {
  event: InfoTrackEventType;
  data: {
    id: string;
    status: string;
    index_number?: string;
    rejection_reason?: string;
    metadata?: { caseId?: string; purpose?: string };
  };
}
