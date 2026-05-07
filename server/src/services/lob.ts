/**
 * Lob certified mail service.
 *
 * Sends a PDF (rendered upstream by services/pdf.ts) as a USPS Certified Mail
 * Return Receipt (RRR) letter, with delivery tracking via webhook.
 */

import LobFactory from 'lob';

const apiKey = process.env.LOB_API_KEY;

if (!apiKey) {
  console.warn('[lob] LOB_API_KEY not set — certified mail sends will fail');
}

const Lob = apiKey ? LobFactory(apiKey) : null;

export interface USAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;     // 2-letter
  zip: string;       // 5 or 9 digit
  company?: string;
}

export interface SendCertifiedLetterParams {
  to: USAddress;
  from: USAddress;
  pdfBuffer: Buffer;
  description: string;
  caseId: string;
  /** "demand-letter" | "final-notice" | "pre-filing-notice" etc. */
  kind: string;
}

export interface SendCertifiedLetterResult {
  letterId: string;
  trackingNumber: string | null;
  expectedDeliveryDate: string | null;
}

export async function sendCertifiedLetter(
  params: SendCertifiedLetterParams,
): Promise<SendCertifiedLetterResult> {
  if (!Lob) throw new Error('Lob not configured');

  const result = await Lob.letters.create({
    to: lobAddress(params.to),
    from: lobAddress(params.from),
    file: params.pdfBuffer,
    color: false,
    double_sided: false,
    address_placement: 'top_first_page',
    use_type: 'operational',
    extra_service: 'certified_return_receipt',
    description: params.description,
    metadata: {
      caseId: params.caseId,
      kind: params.kind,
    },
  });

  return {
    letterId: result.id,
    trackingNumber: result.tracking_number ?? null,
    expectedDeliveryDate: result.expected_delivery_date ?? null,
  };
}

// ─── Address parsing ─────────────────────────────────────────────────────────

/**
 * Best-effort parse of a freeform US address into structured fields.
 * Returns null if it can't extract a 2-letter state and ZIP — caller should
 * then prompt the user for a structured address.
 *
 * Accepts shapes like:
 *   "123 Main St, New York, NY 10001"
 *   "123 Main St Apt 4B, Brooklyn, NY 11201-1234"
 *   "Acme Inc, 123 Main St, New York, NY 10001"
 */
export function parseUSAddress(
  freeform: string,
  fallbackName: string,
): USAddress | null {
  if (!freeform) return null;
  const cleaned = freeform.replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const tail = parts[parts.length - 1];
  const stateZipMatch = tail.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!stateZipMatch) return null;

  const state = stateZipMatch[1];
  const zip = stateZipMatch[2];
  const city = parts[parts.length - 2];

  // Everything before [city, state zip] is the street(s) + optional company prefix
  const head = parts.slice(0, parts.length - 2);
  let company: string | undefined;
  let addressLine1: string;
  let addressLine2: string | undefined;

  if (head.length === 1) {
    addressLine1 = head[0];
  } else if (head.length === 2) {
    addressLine1 = head[0];
    addressLine2 = head[1];
  } else {
    // 3+: assume first is company, last two are street lines
    company = head[0];
    addressLine1 = head[head.length - 2];
    addressLine2 = head[head.length - 1];
  }

  return {
    name: fallbackName || company || 'Recipient',
    company,
    addressLine1,
    addressLine2,
    city,
    state,
    zip,
  };
}

function lobAddress(addr: USAddress) {
  return {
    name: addr.name,
    company: addr.company,
    address_line1: addr.addressLine1,
    address_line2: addr.addressLine2,
    address_city: addr.city,
    address_state: addr.state,
    address_zip: addr.zip,
    address_country: 'US',
  };
}

// ─── Webhook payload types ───────────────────────────────────────────────────

export type LobEventType =
  | 'letter.created'
  | 'letter.rendered_pdf'
  | 'letter.in_transit'
  | 'letter.in_local_area'
  | 'letter.processed_for_delivery'
  | 'letter.re-routed'
  | 'letter.returned_to_sender'
  | 'letter.delivered';

export interface LobWebhookPayload {
  id: string;
  event_type: { id: LobEventType };
  body: {
    id: string; // letter id
    metadata?: { caseId?: string; kind?: string };
    tracking_number?: string;
    tracking_events?: Array<{ name: string; time: string; details?: string }>;
  };
}
