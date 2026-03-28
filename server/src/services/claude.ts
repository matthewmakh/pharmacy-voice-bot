import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 4,
  timeout: 120000,
});

const MODEL = 'claude-sonnet-4-6';

// Extract JSON object from Claude response — handles markdown fences and preamble text
function extractJson(raw: string): string {
  // Try to find a JSON object by locating first { and last }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  // Fallback: strip markdown code fences
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

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
    system: 'You are a document analysis assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as DocumentAnalysis;
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
    system: 'You are a legal case analysis assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as CaseSynthesis;
  } catch (e) {
    console.error('Failed to parse Claude case synthesis. Raw response:', content.text);
    console.error('Parse error:', e);
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
    return JSON.parse(extractJson(content.text)) as DemandLetterResult;
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

export async function generateFinalNotice(
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const prompt = `You are drafting a FINAL NOTICE letter for a collections matter in New York. The initial demand letter was already sent and the deadline has passed without payment.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

This is the final notice before legal action. It should:
- Open with a firm statement that prior demand went unanswered
- State clearly that legal action will be initiated within 7 days if payment is not received
- Reference the original demand letter date if known
- State the full amount now owed (include any interest if applicable)
- Be professional but leave no ambiguity about next steps
- Mention that all costs of collection including legal fees may be sought
- Be shorter than the original demand letter — 250-350 words

Return JSON with:
{
  "text": "plain text version",
  "html": "HTML version with <p> tags"
}

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as DemandLetterResult;
  } catch {
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

export interface CourtFormResult {
  html: string;
  formType: string;
  instructions: string[];
}

export async function generateCourtForm(
  caseData: Record<string, unknown>,
  track: 'commercial' | 'civil' | 'supreme'
): Promise<CourtFormResult> {
  const formMeta = {
    commercial: {
      formType: 'Commercial Claims Court — CIV-SC-70',
      fee: '$25',
      office: 'NYC Civil Court Commercial Claims Clerk',
      maxAmount: '$10,000',
    },
    civil: {
      formType: 'NYC Civil Court — Pro Se Summons & Complaint',
      fee: '$45',
      office: 'NYC Civil Court Clerk',
      maxAmount: '$50,000',
    },
    supreme: {
      formType: 'Supreme Court of the State of New York — Summons with Notice',
      fee: '$210 (Index Number)',
      office: 'County Clerk (Supreme Court)',
      maxAmount: 'Unlimited',
    },
  }[track];

  const trackPrompts = {
    commercial: `You are filling out NYC Commercial Claims Court form CIV-SC-70.

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate a pre-filled HTML version of the CIV-SC-70 form. The form must include these sections, filled with case data. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields:

SECTION 1 — CLAIMANT INFORMATION:
- Business/Individual Name (claimantBusiness or claimantName)
- Address
- Phone

SECTION 2 — DEFENDANT INFORMATION:
- Full Legal Name (debtorBusiness or debtorName)
- DBA (if applicable)
- Address (debtorAddress)
- Phone (if known)

SECTION 3 — CLAIM DETAILS:
- Amount Claimed (amountOwed minus amountPaid)
- Invoice/Account Number(s)
- Date of Original Transaction (agreementDate or invoiceDate)
- Brief Statement of Claim (2-4 sentences: what was agreed, what was delivered, what remains unpaid)

SECTION 4 — CERTIFICATION:
Pre-fill with: "I certify that I have made a good faith effort to resolve this matter prior to filing this claim."

Format as clean HTML with:
- A header: "CIVIL COURT OF THE CITY OF NEW YORK — COMMERCIAL CLAIMS PART"
- "Form CIV-SC-70" subtitle
- Each section in a bordered box with label/value pairs
- A disclaimer at the bottom: "This form was pre-filled from your case data. Review every field carefully before filing."
- Print-friendly styling (max-width 700px, serif font, 1in margins equivalent)

Return JSON:
{
  "html": "complete HTML string",
  "formType": "Commercial Claims Court — CIV-SC-70",
  "instructions": ["specific step 1", "specific step 2", "specific step 3", "specific step 4", "specific step 5"]
}

Instructions should be specific NYC steps: where to go, what to bring, cost, copies needed.
Return ONLY valid JSON.`,

    civil: `You are filling out an NYC Civil Court Pro Se Summons and Complaint.

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

SUMMONS SECTION:
- Court: "CIVIL COURT OF THE CITY OF NEW YORK, COUNTY OF [county derived from debtorAddress, or UNKNOWN]"
- Index Number: [ASSIGNED BY COURT CLERK — do not fill]
- Plaintiff: claimantBusiness or claimantName + address
- Defendant: debtorBusiness/debtorName + address
- Notice to Defendant boilerplate: "YOU ARE HEREBY SUMMONED to appear at the Civil Court of the City of New York at the courthouse in the county listed above. If you fail to appear, judgment may be taken against you by default for the relief demanded in the complaint."

COMPLAINT SECTION:
- Cause of Action: Breach of Contract / Account Stated (pick most applicable from case data)
- Factual Allegations (numbered paragraphs, 3-5 sentences using case data):
  1. Agreement allegation
  2. Performance allegation
  3. Default/non-payment allegation
- Relief Sought: "Plaintiff demands judgment against Defendant in the sum of $[amountOwed] together with interest, costs, and disbursements."

Format as print-ready HTML (max-width 750px, serif font, court-document style).
Include disclaimer: "This document was pre-filled from your case data. Have an attorney review before filing if possible."

Return JSON:
{
  "html": "complete HTML string",
  "formType": "NYC Civil Court — Pro Se Summons & Complaint",
  "instructions": ["5 specific steps"]
}

Instructions must include: where to file (60 Centre Street or borough courthouse), index number purchase, fee amount, copies needed, service requirements.
Return ONLY valid JSON.`,

    supreme: `You are filling out a New York Supreme Court Summons with Notice.

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

The document must contain:

HEADER:
"SUPREME COURT OF THE STATE OF NEW YORK
COUNTY OF [county from debtorAddress or UNKNOWN]"

CAPTION:
Plaintiff name(s) and address(es) vs. Defendant name(s) and address(es)
Index No.: [PURCHASE FROM COUNTY CLERK — $210 filing fee]

SUMMONS:
"TO THE ABOVE-NAMED DEFENDANT(S):
YOU ARE HEREBY SUMMONED to answer the complaint in this action and to serve a copy of your answer, or, if the complaint is not served with this summons, to serve a notice of appearance, on the Plaintiff's attorney within TWENTY (20) days after the service of this summons, exclusive of the day of service (or within THIRTY (30) days after the service is complete if this summons is not personally delivered to you within the State of New York); and in case of your failure to appear or answer, judgment will be taken against you by default for the relief demanded in the notice set forth below."

NOTICE:
- Nature of Action: Breach of Contract / Account Stated / Quantum Meruit (most applicable)
- The relief sought: "Judgment against Defendant in the sum of $[amountOwed], together with interest from [invoiceDate or agreementDate], costs and disbursements of this action."

SIGNATURE BLOCK:
"Dated: [TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}]
Plaintiff Pro Se: [claimantName or claimantBusiness]
Address: [claimant address if known]"

Format as official court document HTML (max-width 750px, serif font, 1.5 line spacing, all-caps headers).
Include banner: "IMPORTANT: Review every field. Have an attorney review this document before filing if possible. This is your legal pleading."

Return JSON:
{
  "html": "complete HTML string",
  "formType": "Supreme Court of the State of New York — Summons with Notice",
  "instructions": ["5 specific steps including index number purchase, service requirements under CPLR, RJI filing"]
}

Return ONLY valid JSON.`,
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: trackPrompts[track] }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(content.text)) as CourtFormResult;
    // Ensure formType is set correctly
    result.formType = result.formType || formMeta.formType;
    return result;
  } catch {
    // Fallback: return basic structure
    return {
      html: `<div style="font-family: serif; max-width: 700px; margin: 0 auto; padding: 2rem;"><h2>${formMeta.formType}</h2><p>Form generation failed. Please try again.</p></div>`,
      formType: formMeta.formType,
      instructions: [
        `File at: ${formMeta.office}`,
        `Filing fee: ${formMeta.fee}`,
        'Bring 3 copies of all documents',
        'Bring a valid government-issued ID',
        'Review all fields before submitting',
      ],
    };
  }
}

export async function generateDefaultJudgment(
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `You are preparing a Motion for Default Judgment for a New York collections matter. The defendant was served but failed to appear or answer within the required time period.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Today's date: ${today}

Generate a Motion for Default Judgment package. Include these sections:

1. NOTICE OF MOTION
   - Court caption (plaintiff v. defendant, index number if known or [INDEX NO.])
   - "PLEASE TAKE NOTICE that upon the annexed affidavit of [claimant name], sworn to [date], and all prior proceedings, Plaintiff will move this Court for an Order granting default judgment..."
   - Relief requested: default judgment in the sum of $[amount] plus interest, costs, disbursements

2. AFFIDAVIT IN SUPPORT
   - Party identification
   - Facts establishing: (a) valid service of summons, (b) defendant's failure to appear or answer, (c) the underlying debt (agreement, services rendered, amount owed)
   - Statement that defendant has not paid and has not contacted plaintiff
   - Sworn signature block with notary acknowledgment form

3. PROPOSED ORDER / JUDGMENT
   - "IT IS HEREBY ORDERED that Plaintiff is granted default judgment against Defendant [name] in the sum of $[amount], together with statutory interest from [date], costs of $[filing fee], and disbursements."

4. AFFIDAVIT OF SERVICE (BLANK TEMPLATE)
   - Who served what document, on what date, by what method, at what address
   - For completion by process server or plaintiff

Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.
Format as court-document HTML (serif font, proper caption, numbered paragraphs, signature lines).

Return JSON:
{
  "text": "plain text version",
  "html": "complete HTML with proper court document formatting"
}

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as DemandLetterResult;
  } catch {
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
