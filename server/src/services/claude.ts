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
    max_tokens: 8192,
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
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `You are drafting a FINAL NOTICE letter for a collections matter in New York. The initial demand letter was already sent and the deadline has passed without payment.

TODAY'S DATE: ${today}

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

This is the final notice before legal action. It should:
- Open with today's date (${today}) at the top of the letter
- Address the debtor by name with their correct address
- Open with a firm statement that prior demand went unanswered
- State clearly that legal action will be initiated within 7 days if payment is not received
- State the full outstanding balance (amountOwed minus amountPaid)
- Be professional but leave no ambiguity about next steps
- Mention that all costs of collection including legal fees may be sought
- Be shorter than the original demand letter — 250-350 words
- Sign off with the claimant's name and business

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

TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT YEAR: ${new Date().getFullYear()}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate a pre-filled HTML version of the CIV-SC-70 form. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${new Date().getFullYear()}) everywhere — never write a past year
- Amount claimed = outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Derive the correct filing county from debtorAddress (defendant's county determines where you file)
- Leave any court-assigned fields (index number, return date) as blank underscores

SECTION 1 — CLAIMANT INFORMATION:
- Business/Individual Name: claimantBusiness or claimantName
- Address: claimantAddress
- Phone: claimantPhone
- Email: claimantEmail

SECTION 2 — DEFENDANT INFORMATION:
- Full Legal Name: debtorBusiness or debtorName (include DBA if both exist)
- Address: debtorAddress
- Phone: debtorPhone (if known)

SECTION 3 — CLAIM DETAILS:
- Amount Claimed: outstandingBalance (state as a dollar figure)
- Invoice/Account Number(s): invoiceNumber if available
- Date of Original Transaction: agreementDate or invoiceDate (use actual date from data, formatted as MM/DD/YYYY)
- Brief Statement of Claim (3-4 sentences using actual names and facts from case data): describe what was agreed, what the claimant delivered, and what remains unpaid

SECTION 4 — CERTIFICATION (pre-filled boilerplate):
"I hereby certify that I have made a good-faith attempt to resolve this dispute prior to bringing this claim, that no other action has been filed or is pending in any court for this claim, and that the above information is true to the best of my knowledge."

Signature line + "Dated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}" (pre-filled with today's date — do NOT leave blank)

Format as clean HTML:
- Header: "CIVIL COURT OF THE CITY OF NEW YORK — COMMERCIAL CLAIMS PART"
- Subtitle: "Statement of Claim — CIV-SC-70"
- Each section in a bordered box with clear label/value pairs
- Disclaimer banner at top: "⚠ This form was pre-filled from your case data. Review every field carefully before filing. Verify the defendant's exact legal name via NYS entity records before submission."
- Print-friendly styling (max-width 700px, serif font)

Return JSON:
{
  "html": "complete HTML string",
  "formType": "Commercial Claims Court — CIV-SC-70",
  "instructions": ["5 specific steps"]
}

Instructions must be specific: the correct Commercial Claims office address for the filing county, filing fee ($25 + postage), bring 2 copies + proof of demand letter sent, filing cap (5 claims/month), court handles defendant notice (no process server needed).
Return ONLY valid JSON.`,

    civil: `You are filling out an NYC Civil Court Pro Se Summons and Complaint.

TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT YEAR: ${new Date().getFullYear()}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${new Date().getFullYear()}) everywhere — never write a past year
- Derive county from debtorAddress (e.g. "Glendale, NY" → Queens County; "Brooklyn" → Kings County; "Bronx" → Bronx County; "Staten Island" → Richmond County; Manhattan/New York → New York County)
- In the signature block, the location must match the county/city of filing — NOT "New York, New York" generically. Use the city derived from the claimant's address or the court's county
- Leave index number and date lines as blank underscores for handwriting
- The Verification block must say "State of New York" and the county of the plaintiff's address (not defendant's)
- Relief sought must use outstandingBalance (amountOwed minus amountPaid), not the full amountOwed

SUMMONS SECTION:
- Court header: "CIVIL COURT OF THE CITY OF NEW YORK" + "County of [derived from debtorAddress]"
- Index Number: blank line — [ASSIGNED BY COURT CLERK — DO NOT FILL]
- Plaintiff box: claimantBusiness or claimantName + full address + phone + email
- Defendant box: debtorBusiness or debtorName (include DBA if both exist) + full address + phone
- Summons notice: "YOU ARE HEREBY SUMMONED to appear at the Civil Court of the City of New York at the courthouse in the County listed above. If you fail to appear, judgment may be taken against you by default for the relief demanded in the complaint. You must respond to this complaint within the time period prescribed by law (20 days after personal service; 30 days if service is by other means). Failure to appear or respond may result in a default judgment being entered against you for the amount demanded, together with interest, costs, and disbursements."
- Include the specific courthouse address for the county (e.g. Queens: 89-17 Sutphin Blvd, Jamaica NY 11435; Brooklyn/Kings: 141 Livingston St, Brooklyn NY 11201; Manhattan/NY County: 111 Centre St, New York NY 10013; Bronx: 851 Grand Concourse, Bronx NY 10451; Staten Island/Richmond: 927 Castleton Ave, Staten Island NY 10310)

COMPLAINT SECTION:
- Header: "Plaintiff [claimantName or claimantBusiness], [doing business as X if applicable], appearing Pro Se, alleges as follows:"
- Cause of Action heading: pick the most accurate from: BREACH OF CONTRACT / ACCOUNT STATED / QUANTUM MERUIT (use Breach of Contract if there was an agreement; add Account Stated if there was an invoice the defendant didn't dispute; add Quantum Meruit if no written contract)
- Numbered factual allegations (use actual names, dates, amounts from case data):
  1. The Parties and Agreement — who the parties are, what was agreed, when, for how much
  2. Plaintiff's Full Performance — what was delivered/completed and when
  3. Defendant's Default and Outstanding Balance — invoice amount, partial payment if any, balance remaining, demand made, non-payment
- Relief Sought box: "WHEREFORE, Plaintiff demands judgment against Defendant in the sum of $[outstandingBalance], together with statutory interest from the date of default, costs, and disbursements of this action, and for such other and further relief as this Court deems just and proper."

SIGNATURE BLOCK:
- "Dated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}" followed by the city and state derived from claimant's address (e.g. "Jamaica, New York" not "New York, New York") — pre-fill the date, do NOT leave it blank
- Signature line + claimant's full name bold + "Plaintiff, Pro Se" + address + phone + email

VERIFICATION:
- "State of New York )"
- "County of [county of claimant's address] ) ss.:"
- "I, [claimantName], being duly sworn, depose and say that I am the Plaintiff in the above-captioned action; that I have read the foregoing Complaint and know the contents thereof; and that the same is true to my own knowledge, except as to matters therein stated to be alleged on information and belief, and as to those matters I believe them to be true."
- Signature line + printed name
- "Sworn to before me this _____ day of _____________, ${new Date().getFullYear()}"
- Notary Public signature line

Format as print-ready HTML (max-width 750px, serif font, court-document style, 1.4 line spacing).
Include disclaimer banner at top: "⚠ DISCLAIMER: This document was pre-filled from your case data. Have an attorney review before filing if possible. Fields marked [UNKNOWN — VERIFY BEFORE FILING] require your attention before submission."

Return JSON:
{
  "html": "complete HTML string",
  "formType": "NYC Civil Court — Pro Se Summons & Complaint",
  "instructions": ["5 specific numbered steps"]
}

Instructions must be specific: exact courthouse address for the county, filing fee (~$45), bring 3 copies, process server requirement (within 120 days), file Affidavit of Service after service, calendar defendant's answer deadline (20 days personal service / 30 days other).
Return ONLY valid JSON.`,

    supreme: `You are filling out a New York Supreme Court Summons with Notice.

TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT YEAR: ${new Date().getFullYear()}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${new Date().getFullYear()}) everywhere — never write a past year
- Relief sought must use outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Derive county from debtorAddress — that is where you file (defendant's county)
- County map: Glendale/Jamaica/Flushing/Astoria/Long Island City → Queens; Brooklyn/Flatbush/Bay Ridge → Kings; Bronx → Bronx; Staten Island → Richmond; Manhattan/New York/Midtown/Downtown → New York County
- Signature block location must match the city from claimant's address, not generically "New York, New York"
- Nature of Action: choose all that apply from — BREACH OF CONTRACT (if agreement exists), ACCOUNT STATED (if invoice was sent and not disputed), QUANTUM MERUIT (if no written contract but services were rendered and accepted)

DOCUMENT STRUCTURE:

HEADER (all caps, centered):
"SUPREME COURT OF THE STATE OF NEW YORK
COUNTY OF [county derived from debtorAddress]"

CAPTION (two-column):
Left: Plaintiff(s) full name(s) + address(es) + label "Plaintiff"
Right: Index No.: [PURCHASE FROM COUNTY CLERK — $210]
Center: "— against —"
Below: Defendant(s) full name(s) + address(es) + label "Defendant"
Document title: "SUMMONS WITH NOTICE"

SUMMONS (statutory CPLR language — reproduce exactly):
"TO THE ABOVE-NAMED DEFENDANT(S):
YOU ARE HEREBY SUMMONED to answer the complaint in this action and to serve a copy of your answer, or, if the complaint is not served with this summons, to serve a notice of appearance, on the Plaintiff or Plaintiff's attorney within TWENTY (20) days after the service of this summons, exclusive of the day of service (or within THIRTY (30) days after the service is complete if this summons is not personally delivered to you within the State of New York); and in case of your failure to appear or answer, judgment will be taken against you by default for the relief demanded in the notice set forth below."

NOTICE OF NATURE OF ACTION AND RELIEF SOUGHT:
- Nature of Action: [list applicable causes — Breach of Contract / Account Stated / Quantum Meruit]
- Brief factual basis (2-3 sentences using actual names, dates, amounts from case data): what was agreed, what was delivered, what remains unpaid
- Relief Sought: "Judgment against Defendant(s) in the sum of $[outstandingBalance], together with statutory interest from [invoiceDate or agreementDate or 'the date of default'], costs and disbursements of this action, and such other and further relief as the Court deems just and proper."

SIGNATURE BLOCK:
"Dated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}     [city from claimant's address], New York" — pre-fill the date, do NOT leave it blank
Blank signature line
"[claimantName or claimantBusiness]"
"Plaintiff Pro Se"
claimant address, phone, email

Format as official court document HTML (max-width 750px, serif font, 1.5 line spacing, all-caps section headers).
Include banner at top: "⚠ IMPORTANT: This Summons with Notice was pre-filled from your case data. Review every field before filing. Have an attorney review if possible. This is a legal pleading."

Return JSON:
{
  "html": "complete HTML string",
  "formType": "Supreme Court of the State of New York — Summons with Notice",
  "instructions": ["5 specific steps"]
}

Instructions must cover: purchase index number from County Clerk ($210), file Summons with Notice, serve defendant within 120 days via licensed process server (CPLR Article 3), file notarized Affidavit of Service, file RJI (Request for Judicial Intervention) within 60 days of filing to get a judge assigned.
Return ONLY valid JSON.`,
  };

  // ── Pass 1: Generate ────────────────────────────────────────────────────────
  const genResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: trackPrompts[track] }],
  });

  const genContent = genResponse.content[0];
  if (genContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  let result: CourtFormResult;
  try {
    result = JSON.parse(extractJson(genContent.text)) as CourtFormResult;
    result.formType = result.formType || formMeta.formType;
  } catch {
    result = {
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

  return result;
}

// Exported separately so the route can orchestrate: generate → verify → retry if needed → verify retry
export async function retryCourtForm(
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>,
  track: 'commercial' | 'civil' | 'supreme',
  formType: string
): Promise<CourtFormResult> {
  const issues = verification.checks.filter(c => c.status !== 'ok');
  const issueList = issues
    .map(c => `- ${c.field}: expected "${c.expected ?? 'not in case data'}", found "${c.found ?? 'missing'}". Note: ${c.note}`)
    .join('\n');

  const retryPrompt = `You previously generated a court form that failed verification. You must regenerate it, correcting only the specific issues listed below. Do not change anything that was already correct.

ORIGINAL FORM (for reference — your previous output):
${originalHtml.slice(0, 4000)}

VERIFICATION ISSUES TO FIX (${issues.length} problem${issues.length === 1 ? '' : 's'}):
${issueList}

${verification.blankFields.length > 0 ? `FIELDS STILL BLANK (fill if the data is available in case data, otherwise leave as [UNKNOWN — VERIFY BEFORE FILING]):\n${verification.blankFields.join(', ')}` : ''}

SOURCE CASE DATA (ground truth — use this to correct the issues above):
${JSON.stringify(caseData, null, 2)}

TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT YEAR: ${new Date().getFullYear()}

Rules:
- Fix every issue listed above using the case data as ground truth
- Keep everything that was already verified as correct
- Do not invent any facts not present in the case data
- Signature date must be today's date — do not leave it blank
- Use [UNKNOWN — VERIFY BEFORE FILING] only for fields genuinely missing from case data

Return the corrected form as JSON:
{
  "html": "complete corrected HTML string",
  "formType": "${formType}",
  "instructions": ["same 5 steps as before unless corrections require changes"]
}

Return ONLY valid JSON.`;

  const retryResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: retryPrompt }],
  });

  const retryContent = retryResponse.content[0];
  if (retryContent.type !== 'text') throw new Error('Unexpected response type from Claude on retry');

  try {
    const retryResult = JSON.parse(extractJson(retryContent.text)) as CourtFormResult;
    retryResult.formType = retryResult.formType || formType;
    return retryResult;
  } catch {
    // Retry parse failed — return original rather than an error state
    return { html: originalHtml, formType, instructions: [] };
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

export interface VerificationCheck {
  field: string;
  status: 'ok' | 'missing' | 'mismatch' | 'hallucinated';
  expected: string | null;
  found: string | null;
  note: string;
}

export interface CourtFormVerification {
  overallStatus: 'verified' | 'review_needed' | 'issues_found';
  checks: VerificationCheck[];
  summary: string;
  blankFields: string[];
  verifiedAt: string;
}

export async function verifyCourtForm(
  formHtml: string,
  caseData: Record<string, unknown>
): Promise<CourtFormVerification> {
  const prompt = `You are an adversarial reviewer checking a pre-filled court form for accuracy. Your job is to catch hallucinations, wrong facts, missing fields, and any discrepancy between the generated document and the source case data.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

GENERATED COURT FORM HTML:
${formHtml.slice(0, 6000)}

Systematically extract every factual claim from the generated form and verify it against the source case data.

Check each of the following fields if they appear in the document:
- Plaintiff/claimant name and business name
- Plaintiff address, phone, email
- Defendant/debtor name and business name
- Defendant address, phone
- Amount claimed (must equal outstandingBalance = amountOwed minus amountPaid, NOT the full amountOwed)
- Invoice number
- Agreement date / transaction date
- Payment due date
- Service description / nature of claim
- County of filing (must match defendant's address)
- Courthouse name and address (must match county)
- Date on the document (must be today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})
- Year references (must all be ${new Date().getFullYear()})
- Signature block city/location (must derive from plaintiff's address, not be generic)

For each check, determine:
- "ok": the form matches the case data exactly
- "missing": the field was needed but left blank or marked UNKNOWN
- "mismatch": the form contains a value that contradicts the case data
- "hallucinated": the form contains a specific fact (name, number, date, address) that does not appear anywhere in the case data and was not derivable from it

Also identify any fields left blank or marked [UNKNOWN — VERIFY BEFORE FILING].

Return a JSON object:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [
    {
      "field": "field name",
      "status": "ok" | "missing" | "mismatch" | "hallucinated",
      "expected": "what the case data says (or null if not in case data)",
      "found": "what appears in the generated form (or null if absent)",
      "note": "brief explanation, empty string if ok"
    }
  ],
  "summary": "1-2 sentence plain-language summary of verification result",
  "blankFields": ["list of field names that are blank or marked UNKNOWN"]
}

Status rules:
- "verified": all checked fields match, no hallucinations, 0-1 missing fields that are genuinely not available
- "review_needed": 2-3 missing fields OR minor uncertainty, no clear errors
- "issues_found": any mismatch, any hallucination, or more than 3 missing required fields

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const verifyContent = response.content[0];
  if (verifyContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(verifyContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return {
      overallStatus: 'review_needed',
      checks: [],
      summary: 'Verification could not be completed automatically. Please review the form manually before filing.',
      blankFields: [],
      verifiedAt: new Date().toISOString(),
    };
  }
}
