/**
 * Proof.com integration — unified vendor for notary (Proof Notarize / RON),
 * process service (Proof Serve), identity verification, and e-signature.
 *
 * API base: https://api.proof.com (Notarize), https://api.proofserve.com (Serve).
 * Both use bearer-token auth with the same `PROOF_API_KEY`.
 *
 * NOTE: shapes here are best-effort against published docs. Until Proof's
 * sales engineer confirms our endpoint/auth in the kickoff call, treat any
 * field shape as provisional. The public types (Params/Result) are stable
 * — vendor-specific request bodies are kept in private buildBody() helpers
 * so we can adjust without rippling changes through callers.
 */

const apiKey = process.env.PROOF_API_KEY;
const NOTARIZE_BASE = process.env.PROOF_NOTARIZE_BASE || 'https://api.proof.com/v1';
const SERVE_BASE    = process.env.PROOF_SERVE_BASE    || 'https://api.proofserve.com/v1';

if (!apiKey) {
  console.warn('[proof] PROOF_API_KEY not set — notary + process service calls will fail');
}

function authHeaders(): Record<string, string> {
  if (!apiKey) throw new Error('Proof not configured');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// ─── Remote Online Notarization (RON) ────────────────────────────────────────

export interface NotarizeParams {
  /** Person who needs to be notarized (typically the claimant signing an affidavit) */
  signer: { firstName: string; lastName: string; email: string };
  /** PDF (base64-encoded) or hosted URL */
  document: { name: string; base64?: string; url?: string };
  /** caseId for webhook routing */
  caseId: string;
  /** "scra-affidavit" | "affidavit-of-service" | etc. */
  kind: string;
}

export interface NotarizeResult {
  notarizationId: string;
  /** Magic link the signer follows to attend their RON session */
  signerUrl: string;
  status: 'pending' | 'in-session' | 'completed' | 'failed';
}

export async function createNotarization(params: NotarizeParams): Promise<NotarizeResult> {
  const r = await fetch(`${NOTARIZE_BASE}/notarizations`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      signers: [{
        first_name: params.signer.firstName,
        last_name: params.signer.lastName,
        email: params.signer.email,
      }],
      documents: [{
        resource: params.document.url
          ? { kind: 'url', url: params.document.url }
          : { kind: 'base64', name: params.document.name, content: params.document.base64 },
      }],
      external_id: params.caseId,
      metadata: { caseId: params.caseId, kind: params.kind },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Proof notarize failed: HTTP ${r.status} ${text}`);
  }
  const body = await r.json() as {
    id: string;
    signer_url?: string;
    sign_url?: string;
    status: string;
  };
  return {
    notarizationId: body.id,
    signerUrl: body.signer_url || body.sign_url || '',
    status: (body.status as NotarizeResult['status']) || 'pending',
  };
}

export async function getNotarizationStatus(notarizationId: string): Promise<{
  status: NotarizeResult['status'];
  signedPdfUrl: string | null;
}> {
  const r = await fetch(`${NOTARIZE_BASE}/notarizations/${notarizationId}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`Proof status fetch failed: HTTP ${r.status}`);
  const body = await r.json() as {
    status: string;
    signed_document_url?: string;
    completed_document?: { url?: string };
  };
  return {
    status: body.status as NotarizeResult['status'],
    signedPdfUrl: body.signed_document_url || body.completed_document?.url || null,
  };
}

// ─── Process Serve ───────────────────────────────────────────────────────────

export interface ServeParams {
  /** Person/entity to be served */
  recipient: {
    firstName?: string;
    lastName?: string;
    businessName?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;     // 2-letter
    zip: string;
  };
  /** Document(s) to serve — typically the Summons + Complaint */
  document: { name: string; base64?: string; url?: string };
  /** Court info for the filing — needed by the process server affidavit */
  court: {
    name: string;     // e.g. "NY County Civil Court"
    indexNumber?: string;
  };
  /** Service rush level */
  rush?: 'standard' | 'rush' | 'same-day';
  caseId: string;
  /** Optional notes for the server (gate codes, best times, etc.) */
  notes?: string;
}

export interface ServeResult {
  jobId: string;
  status: 'pending' | 'attempted' | 'served' | 'unsuccessful';
  /** Affidavit of service URL (populated once served) */
  affidavitUrl: string | null;
}

export async function requestProcessService(params: ServeParams): Promise<ServeResult> {
  const recipientName =
    params.recipient.businessName
    || `${params.recipient.firstName ?? ''} ${params.recipient.lastName ?? ''}`.trim();

  const r = await fetch(`${SERVE_BASE}/jobs`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      recipient: {
        name: recipientName,
        is_business: !!params.recipient.businessName,
        address: {
          line1: params.recipient.addressLine1,
          line2: params.recipient.addressLine2,
          city: params.recipient.city,
          state: params.recipient.state,
          postal_code: params.recipient.zip,
          country: 'US',
        },
      },
      documents: [{
        name: params.document.name,
        url: params.document.url,
        base64: params.document.base64,
      }],
      court: {
        name: params.court.name,
        case_number: params.court.indexNumber,
      },
      rush: params.rush || 'standard',
      external_id: params.caseId,
      metadata: { caseId: params.caseId },
      notes: params.notes,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Proof Serve failed: HTTP ${r.status} ${text}`);
  }
  const body = await r.json() as { id: string; status?: string };
  return {
    jobId: body.id,
    status: (body.status as ServeResult['status']) || 'pending',
    affidavitUrl: null,
  };
}

export async function getServeStatus(jobId: string): Promise<ServeResult> {
  const r = await fetch(`${SERVE_BASE}/jobs/${jobId}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Proof Serve status fetch failed: HTTP ${r.status}`);
  const body = await r.json() as {
    id: string;
    status: string;
    affidavit_url?: string;
    affidavit?: { url?: string };
  };
  return {
    jobId: body.id,
    status: body.status as ServeResult['status'],
    affidavitUrl: body.affidavit_url || body.affidavit?.url || null,
  };
}

// ─── Webhook payload (both products use a unified webhook envelope) ──────────

export type ProofEventType =
  | 'notarization.completed'
  | 'notarization.failed'
  | 'service.attempted'
  | 'service.served'
  | 'service.unsuccessful';

export interface ProofWebhookPayload {
  event: ProofEventType;
  data: {
    id: string; // notarizationId or jobId
    status: string;
    metadata?: { caseId?: string; kind?: string };
    signed_document_url?: string;
    affidavit_url?: string;
  };
}
