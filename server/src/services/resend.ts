/**
 * Resend tracked email service.
 *
 * Sends transactional email with optional PDF attachment, tagged with caseId
 * so webhook events can be routed back to the originating case.
 */

import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'Reclaim <hello@mail.reclaimful.com>';

if (!apiKey) {
  console.warn('[resend] RESEND_API_KEY not set — email sends will fail');
}

const client = apiKey ? new Resend(apiKey) : null;

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  caseId: string;
  /** Tag for routing webhook events. Examples: "demand-letter", "final-notice", "settlement-followup" */
  kind: string;
  attachmentPdf?: Buffer;
  attachmentFilename?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  emailId: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!client) throw new Error('Resend not configured');

  const { data, error } = await client.emails.send({
    from: FROM_ADDRESS,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    replyTo: params.replyTo,
    attachments: params.attachmentPdf
      ? [{
          filename: params.attachmentFilename || 'document.pdf',
          content: params.attachmentPdf,
        }]
      : undefined,
    tags: [
      { name: 'caseId', value: params.caseId },
      { name: 'kind', value: params.kind },
    ],
  });

  if (error) throw new Error(`Resend send failed: ${error.message}`);
  if (!data?.id) throw new Error('Resend returned no email id');

  return { emailId: data.id };
}

// ─── Webhook payload types ───────────────────────────────────────────────────

export type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked';

export interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    tags?: Record<string, string>;
  };
}
