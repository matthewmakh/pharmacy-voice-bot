import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 4, // built-in retry with backoff for 429/503
  timeout: 120000,
});

const MODEL = 'claude-sonnet-4-6';

export interface DocumentAnalysis {
  classification: string;
  confidence: number;
  supportsTags: string[];
  extractedFacts: Record<string, unknown>;
  summary: string;
}

export interface CaseSynthesis {
  timeline: Array<{ date: string; event: string; source?: string }>;
  caseSummary: string;
  missingInfo: string[];
  caseStrength: 'strong' | 'moderate' | 'weak';
  extractedFacts: Record<string, unknown>;
  evidenceSummary: Record<string, unknown>;
}

export interface DemandLetterResult {
  text: string;
  html: string;
}

export async function analyzeDocument(
  extractedText: string,
  filename: string,
  mimeType: string
): Promise<DocumentAnalysis> {
  const prompt = `You are analyzing a business document as part of a collections/dispute case.

Document name: ${filename}
Document type: ${mimeType}
Document text:
---
${extractedText.slice(0, 8000)}
---

Analyze this document and return a JSON object with exactly these fields:
{
  "classification": one of ["contract", "invoice", "proof_of_work", "communication", "payment_record", "business_record", "screenshot", "other"],
  "confidence": number 0-1 representing confidence in classification,
  "supportsTags": array of applicable tags from ["agreement_exists", "work_completed", "amount_owed", "payment_terms", "non_payment", "prior_notice", "partial_payment", "debtor_acknowledgment", "delivery_confirmed", "service_described"],
  "extractedFacts": {
    "claimantName": string or null,
    "claimantBusiness": string or null,
    "debtorName": string or null,
    "debtorBusiness": string or null,
    "debtorAddress": string or null,
    "amount": number or null,
    "amountPaid": number or null,
    "invoiceNumber": string or null,
    "invoiceDate": string (ISO date) or null,
    "dueDate": string (ISO date) or null,
    "agreementDate": string (ISO date) or null,
    "serviceStartDate": string (ISO date) or null,
    "serviceEndDate": string (ISO date) or null,
    "paymentTerms": string or null,
    "serviceDescription": string or null,
    "relevantDates": [{"date": "ISO date string", "event": "description"}],
    "keyStatements": ["important quote 1", "important quote 2"]
  },
  "summary": "1-2 sentence summary of what this document is and what it shows"
}

Return ONLY valid JSON. No markdown, no explanation.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(content.text) as DocumentAnalysis;
  } catch {
    console.error('Failed to parse Claude document analysis:', content.text);
    return {
      classification: 'other',
      confidence: 0.3,
      supportsTags: [],
      extractedFacts: {},
      summary: 'Document uploaded (analysis parsing error)',
    };
  }
}

export async function synthesizeCase(
  documents: Array<{
    originalName: string;
    classification: string | null;
    extractedFacts: Record<string, unknown> | null;
    supportsTags: string[];
    summary: string | null;
  }>,
  userProvidedFacts: Record<string, unknown>
): Promise<CaseSynthesis> {
  const docsContext = documents
    .map(
      (d, i) =>
        `Document ${i + 1}: ${d.originalName}
Type: ${d.classification || 'unknown'}
Summary: ${d.summary || 'N/A'}
Supports: ${d.supportsTags.join(', ') || 'none identified'}
Facts: ${JSON.stringify(d.extractedFacts || {}, null, 2)}`
    )
    .join('\n\n---\n\n');

  const prompt = `You are synthesizing a business collections case from uploaded documents.

USER-PROVIDED CASE FACTS:
${JSON.stringify(userProvidedFacts, null, 2)}

UPLOADED DOCUMENTS (${documents.length} total):
${docsContext}

Synthesize this into a structured case analysis. Return a JSON object with exactly these fields:
{
  "timeline": [
    {"date": "ISO date string or 'unknown'", "event": "clear description of what happened", "source": "document name or 'user-provided'"}
  ],
  "caseSummary": "2-3 paragraph plain-language summary of the dispute, what happened, and where things stand",
  "missingInfo": ["list of specific missing information that would strengthen the case, e.g. 'Written contract', 'Invoice with payment terms', 'Proof of delivery'"],
  "caseStrength": "strong" | "moderate" | "weak",
  "extractedFacts": {
    "claimantName": "best guess from all sources",
    "claimantBusiness": "...",
    "debtorName": "...",
    "debtorBusiness": "...",
    "debtorAddress": "...",
    "amountOwed": number or null,
    "amountPaid": number or null,
    "serviceDescription": "...",
    "agreementDate": "ISO date or null",
    "invoiceDate": "ISO date or null",
    "paymentDueDate": "ISO date or null",
    "hasWrittenContract": boolean,
    "invoiceNumber": "... or null"
  },
  "evidenceSummary": {
    "hasContract": boolean,
    "hasInvoice": boolean,
    "hasProofOfWork": boolean,
    "hasCommunication": boolean,
    "hasPaymentRecord": boolean,
    "documentCount": number,
    "strongestEvidence": "description of most compelling evidence"
  }
}

Sort timeline chronologically. Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(content.text) as CaseSynthesis;
  } catch {
    console.error('Failed to parse Claude case synthesis:', content.text);
    return {
      timeline: [],
      caseSummary: 'Analysis could not be completed. Please review the uploaded documents manually.',
      missingInfo: [],
      caseStrength: 'moderate',
      extractedFacts: {},
      evidenceSummary: {},
    };
  }
}

export async function generateDemandLetter(
  caseData: Record<string, unknown>,
  strategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH'
): Promise<DemandLetterResult> {
  const strategyDescriptions = {
    QUICK_ESCALATION:
      'Firm and urgent. Deadline of 7 days. Strong language about legal consequences. Professional but direct.',
    STANDARD_RECOVERY:
      'Professional and firm. Deadline of 14 days. Standard legal consequence language. Balanced tone.',
    GRADUAL_APPROACH:
      'Professional and measured. Deadline of 21 days. Softer language about next steps. Cooperative tone.',
  };

  const deadline =
    strategy === 'QUICK_ESCALATION' ? 7 : strategy === 'STANDARD_RECOVERY' ? 14 : 21;

  const prompt = `You are drafting a professional business demand letter for a collections matter in New York.

STRATEGY: ${strategy}
Tone guidance: ${strategyDescriptions[strategy]}
Payment deadline: ${deadline} days from date of letter

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Write a complete, professional demand letter. Use these modular sections:

1. DATE AND HEADER (today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})
2. RECIPIENT ADDRESS BLOCK
3. RE: LINE (clear subject line with amount and matter description)
4. FORMAL SALUTATION
5. OPENING PARAGRAPH - formal demand statement with strategy-appropriate tone
6. BACKGROUND/AGREEMENT PARAGRAPH - describe the business relationship and agreement
7. SERVICES RENDERED PARAGRAPH - describe work performed and when
8. OUTSTANDING BALANCE PARAGRAPH - state exact amounts, invoice details, due date
9. PRIOR CONTACT PARAGRAPH (if any prior contact was made, include it; otherwise omit)
10. DEMAND PARAGRAPH - specific demand with ${deadline}-day deadline
11. CONSEQUENCES PARAGRAPH - what happens if not paid (with strategy-appropriate language)
12. CLOSING AND SIGNATURE BLOCK

Important rules:
- Only assert facts supported by the case data
- If a fact is unknown, use placeholder like [DATE] or [ADDRESS] rather than guessing
- Letter should be 400-600 words
- Use proper business letter formatting
- For New York matters, you may reference potential litigation in small claims or civil court as appropriate

Return a JSON object with:
{
  "text": "plain text version of the full letter",
  "html": "HTML version with proper formatting (use <p>, <br>, <strong>, <address> tags)"
}

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(content.text) as DemandLetterResult;
  } catch {
    // If JSON parse fails, try to extract the text directly
    const text = content.text;
    return {
      text,
      html: `<div style="font-family: serif; max-width: 700px; margin: 0 auto; padding: 2rem;">${text
        .split('\n\n')
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('')}</div>`,
    };
  }
}
