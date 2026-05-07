/**
 * Dropbox Sign (formerly HelloSign) e-signature service.
 *
 * Sends a PDF for signature by claimant + debtor. Both parties get an
 * emailed link from Dropbox Sign; on completion we receive a webhook with
 * the signed PDF URL.
 */

import * as DropboxSign from '@dropbox/sign';

const apiKey = process.env.DROPBOX_SIGN_API_KEY;
const TEST_MODE = process.env.NODE_ENV !== 'production';

if (!apiKey) {
  console.warn('[dropboxSign] DROPBOX_SIGN_API_KEY not set — e-signature sends will fail');
}

function api(): DropboxSign.SignatureRequestApi {
  if (!apiKey) throw new Error('Dropbox Sign not configured');
  const a = new DropboxSign.SignatureRequestApi();
  a.username = apiKey;
  return a;
}

export interface Signer {
  email: string;
  name: string;
  order: number;   // 0 = signs first, 1 = next, ...
}

export interface SendForSignatureParams {
  title: string;
  subject: string;
  message: string;
  signers: Signer[];
  pdfBuffer: Buffer;
  pdfFilename: string;
  caseId: string;
  /** "settlement" | "payment-plan" — routes the webhook event */
  kind: string;
}

export interface SendForSignatureResult {
  signatureRequestId: string;
  /** map of signer email → individual signature id (for embedded flows later) */
  signatureIds: Record<string, string>;
}

export async function sendForSignature(
  params: SendForSignatureParams,
): Promise<SendForSignatureResult> {
  const signatureRequestApi = api();

  const data: DropboxSign.SignatureRequestSendRequest = {
    title: params.title,
    subject: params.subject,
    message: params.message,
    signers: params.signers.map((s) => ({
      emailAddress: s.email,
      name: s.name,
      order: s.order,
    })),
    files: [{
      value: params.pdfBuffer,
      options: {
        filename: params.pdfFilename,
        contentType: 'application/pdf',
      },
    }],
    testMode: TEST_MODE,
    metadata: {
      caseId: params.caseId,
      kind: params.kind,
    },
  };

  const result = await signatureRequestApi.signatureRequestSend(data);
  const sr = result.body.signatureRequest;
  if (!sr?.signatureRequestId) throw new Error('Dropbox Sign returned no request id');

  const signatureIds: Record<string, string> = {};
  for (const s of sr.signatures ?? []) {
    if (s.signerEmailAddress && s.signatureId) {
      signatureIds[s.signerEmailAddress] = s.signatureId;
    }
  }

  return {
    signatureRequestId: sr.signatureRequestId,
    signatureIds,
  };
}

/**
 * Download the final signed PDF after all signers complete.
 */
export async function downloadSignedPdf(signatureRequestId: string): Promise<Buffer> {
  const signatureRequestApi = api();
  const result = await signatureRequestApi.signatureRequestFiles(
    signatureRequestId,
    'pdf',
  );
  // SDK returns the body as a Buffer for binary downloads.
  return result.body as unknown as Buffer;
}

// ─── Webhook payload types ───────────────────────────────────────────────────

export type DropboxSignEventType =
  | 'signature_request_sent'
  | 'signature_request_viewed'
  | 'signature_request_signed'
  | 'signature_request_all_signed'
  | 'signature_request_email_bounce'
  | 'signature_request_remind'
  | 'signature_request_canceled'
  | 'signature_request_declined';

export interface DropboxSignWebhookPayload {
  event: {
    event_type: DropboxSignEventType;
    event_time: string;
    event_hash: string;
  };
  signature_request?: {
    signature_request_id: string;
    is_complete: boolean;
    metadata?: { caseId?: string; kind?: string };
    signatures?: Array<{
      signature_id: string;
      signer_email_address: string;
      status_code: string;
      signed_at?: number;
    }>;
  };
}
