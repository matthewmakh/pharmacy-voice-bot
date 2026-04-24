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

export interface MissingInfoItem {
  item: string;
  consequence: string;
  impact: 'high' | 'medium' | 'low';
  workaround?: string;
}

export interface CaseAssessment {
  primaryCauseOfAction: {
    theory: 'breach_of_written_contract' | 'breach_of_oral_contract' | 'account_stated' | 'quantum_meruit';
    reasoning: string;
    elements: Array<{
      element: string;
      satisfied: boolean;
      evidence: string | null;
      gap: string | null;
    }>;
  };
  alternativeCauses: string[];
  counterclaimRisk: {
    level: 'low' | 'medium' | 'high';
    reasoning: string;
    signals: string[];
  };
  debtorEntityNotes: string | null;
  recommendedStrategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';
  strategyReasoning: string;
}

export interface CaseSynthesis {
  timeline: Array<{ date: string; event: string; source?: string }>;
  caseSummary: string;
  missingInfo: MissingInfoItem[];
  caseStrength: 'strong' | 'moderate' | 'weak';
  extractedFacts: Record<string, unknown>;
  evidenceSummary: Record<string, unknown>;
  caseAssessment: CaseAssessment;
}

export type IntakeFieldName =
  | 'claimantName'
  | 'claimantBusiness'
  | 'claimantAddress'
  | 'claimantEmail'
  | 'claimantPhone'
  | 'debtorName'
  | 'debtorBusiness'
  | 'debtorAddress'
  | 'debtorEmail'
  | 'debtorPhone'
  | 'debtorEntityType'
  | 'amountOwed'
  | 'amountPaid'
  | 'serviceDescription'
  | 'agreementDate'
  | 'serviceStartDate'
  | 'serviceEndDate'
  | 'invoiceDate'
  | 'paymentDueDate'
  | 'hasWrittenContract'
  | 'invoiceNumber'
  | 'industry';

export interface IntakeFieldExtraction {
  value: string | number | boolean | null;
  confidence: 'high' | 'medium' | 'low';
  sourceDocId: string | null;
  sourceExcerpt: string | null;
}

export type IntakeAutofillResult = Record<IntakeFieldName, IntakeFieldExtraction>;

const INTAKE_FIELD_NAMES: IntakeFieldName[] = [
  'claimantName', 'claimantBusiness', 'claimantAddress', 'claimantEmail', 'claimantPhone',
  'debtorName', 'debtorBusiness', 'debtorAddress', 'debtorEmail', 'debtorPhone', 'debtorEntityType',
  'amountOwed', 'amountPaid', 'serviceDescription',
  'agreementDate', 'serviceStartDate', 'serviceEndDate', 'invoiceDate', 'paymentDueDate',
  'hasWrittenContract', 'invoiceNumber', 'industry',
];

function emptyIntakeResult(): IntakeAutofillResult {
  const result = {} as IntakeAutofillResult;
  for (const name of INTAKE_FIELD_NAMES) {
    result[name] = { value: null, confidence: 'low', sourceDocId: null, sourceExcerpt: null };
  }
  return result;
}

export async function extractIntakeFromDocuments(
  documents: Array<{ id: string; originalName: string; extractedText: string }>,
): Promise<IntakeAutofillResult> {
  if (documents.length === 0) return emptyIntakeResult();

  const docsContext = documents
    .map(
      (d, i) =>
        `=== Document ${i + 1} (id: ${d.id}, filename: ${d.originalName}) ===
${d.extractedText.slice(0, 12000)}`
    )
    .join('\n\n');

  const prompt = `You are pre-filling a New York B2B collections case intake form by extracting fields from the user's uploaded documents (contracts, invoices, emails, etc.). The user will review and edit your suggestions, so accuracy matters more than completeness — when in doubt, return null.

CRITICAL RULES:
1. Extract ONLY what is explicitly stated or strongly evidenced in the documents. NEVER invent or guess.
2. Return value: null with confidence: "low" for any field not evidenced — do NOT fabricate plausible-sounding values.
3. The CLAIMANT is the user's own business (the party owed money). The DEBTOR is the other party. Be careful not to swap them — the claimant is whoever issued the invoices and is suing/collecting; the debtor is the recipient who owes payment.
4. claimantEmail and claimantPhone rarely appear in invoices the claimant sent — these are the user's own contact info. Return null unless the documents explicitly contain them (e.g., on the claimant's letterhead).
5. Confidence rubric:
   - "high" = stated verbatim in the document
   - "medium" = clearly inferable from context (e.g., debtor address from the "Bill To" section)
   - "low" = guess (prefer null over a low-confidence guess)
6. sourceDocId: the document id (from the "id:" header) where you found this fact. null if not found.
7. sourceExcerpt: a ≤20-word verbatim quote from the source document. null if not found.
8. Dates must be ISO format (YYYY-MM-DD).
9. amountOwed and amountPaid must be numbers (no currency symbol, no commas).
10. hasWrittenContract is a boolean — true if a signed/executed written agreement exists in the documents.
11. debtorEntityType must be one of: "LLC", "Corporation", "Sole Proprietor", "Partnership", "Individual", "Unknown".

DOCUMENTS:
${docsContext}

Return a single JSON object with EXACTLY these fields. Each field MUST be an object of shape {"value": ..., "confidence": "high"|"medium"|"low", "sourceDocId": "..." or null, "sourceExcerpt": "..." or null}:

{
  "claimantName": { ... },
  "claimantBusiness": { ... },
  "claimantAddress": { ... },
  "claimantEmail": { ... },
  "claimantPhone": { ... },
  "debtorName": { ... },
  "debtorBusiness": { ... },
  "debtorAddress": { ... },
  "debtorEmail": { ... },
  "debtorPhone": { ... },
  "debtorEntityType": { ... },
  "amountOwed": { ... },
  "amountPaid": { ... },
  "serviceDescription": { ... },
  "agreementDate": { ... },
  "serviceStartDate": { ... },
  "serviceEndDate": { ... },
  "invoiceDate": { ... },
  "paymentDueDate": { ... },
  "hasWrittenContract": { ... },
  "invoiceNumber": { ... },
  "industry": { ... }
}

Return ONLY valid JSON. No markdown, no explanation.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a document extraction assistant for a legal intake form. Always respond with valid JSON only. Never invent values — return null when uncertain.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  let parsed: Partial<IntakeAutofillResult>;
  try {
    parsed = JSON.parse(extractJson(content.text)) as Partial<IntakeAutofillResult>;
  } catch (err) {
    console.error('Failed to parse intake autofill JSON:', content.text);
    throw new Error(`Intake extraction returned invalid JSON: ${String(err)}`);
  }

  // Validate every field is present and has the right shape; fill in blanks defensively
  const validDocIds = new Set(documents.map(d => d.id));
  const result = emptyIntakeResult();
  for (const name of INTAKE_FIELD_NAMES) {
    const f = parsed[name];
    if (f && typeof f === 'object' && 'value' in f) {
      const conf = f.confidence === 'high' || f.confidence === 'medium' || f.confidence === 'low' ? f.confidence : 'low';
      const sourceDocId = typeof f.sourceDocId === 'string' && validDocIds.has(f.sourceDocId) ? f.sourceDocId : null;
      result[name] = {
        value: f.value === undefined ? null : f.value,
        confidence: conf,
        sourceDocId,
        sourceExcerpt: typeof f.sourceExcerpt === 'string' ? f.sourceExcerpt : null,
      };
    }
  }
  return result;
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
${extractedText.slice(0, 15000)}
---

Analyze this document and return a JSON object with exactly these fields:
{
  "classification": one of ["contract", "invoice", "proof_of_work", "communication", "payment_record", "business_record", "screenshot", "other"],
  "confidence": number 0-1 representing confidence in classification,
  "supportsTags": array of all applicable tags from the list below (include every tag that applies):
    "agreement_exists"       — a formal or informal agreement was made between the parties
    "work_completed"         — deliverables, services, or goods were actually provided
    "amount_owed"            — an explicit dollar amount is stated as due
    "payment_terms"          — states when payment is due or what the terms are
    "non_payment"            — evidence the invoice or balance was not paid
    "prior_notice"           — debtor was previously notified of the debt before this case
    "partial_payment"        — at least some payment was made (implies debtor acknowledged the deal)
    "debtor_acknowledgment"  — debtor explicitly acknowledged the debt or agreed to pay
    "delivery_confirmed"     — proof that goods or services were received by the debtor
    "service_described"      — the nature of the services or goods is specifically described,
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
    "isSignedOrExecuted": true if signatures, initials, or explicit acceptance appear in the document — otherwise false or null,
    "disputedByDebtor": true if the debtor disputes the work, invoice, or amounts in this document — otherwise false or null,
    "lateFeesMentioned": true if late fees, interest rate, or penalty clause is referenced — otherwise false or null,
    "partialPaymentEvidence": true if a payment is shown even if not the full amount — otherwise false or null,
    "relevantDates": [{"date": "ISO date string", "event": "description"}],
    "keyStatements": [
      "3-5 quotes most legally significant for a collections claim: explicit amounts, agreements, delivery confirmations, non-payment references, or debtor admissions. Omit filler text."
    ]
  },
  "summary": "1-2 sentence summary of what this document is and what it shows for a collections claim"
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

  const prompt = `You are a New York collections attorney synthesizing a B2B debt collection case from uploaded documents and user-provided facts. Your analysis will drive a legal workflow — be precise, honest, and grounded in the actual case data.

USER-PROVIDED CASE FACTS:
${JSON.stringify(userProvidedFacts, null, 2)}

UPLOADED DOCUMENTS (${documents.length} total):
${docsContext}

Return a single JSON object with exactly these fields:

{
  "timeline": [
    {"date": "ISO date string or 'unknown'", "event": "clear description of what happened", "source": "document name or 'user-provided'"}
  ],

  "caseSummary": "2-3 paragraph plain-language summary of the dispute, what happened, and where things stand. Include the legal relationship, what was agreed, what was delivered, and what remains unpaid.",

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
  },

  "missingInfo": [
    {
      "item": "name of missing item, e.g. 'Written contract'",
      "consequence": "specific legal consequence of this gap — what theory it weakens, what element it leaves unproven, how a defendant could exploit it",
      "impact": "high" | "medium" | "low",
      "workaround": "if a substitute or mitigation exists, describe it — otherwise omit this field"
    }
  ],

  "caseAssessment": {
    "primaryCauseOfAction": {
      "theory": one of: "breach_of_written_contract" | "breach_of_oral_contract" | "account_stated" | "quantum_meruit",
      "reasoning": "1-2 sentences explaining why this is the strongest theory given the available evidence",
      "elements": [
        {
          "element": "specific legal element, e.g. 'Valid written contract existed between the parties'",
          "satisfied": true | false,
          "evidence": "which document or fact satisfies this element, or null if not satisfied",
          "gap": "what is missing if not satisfied, or null if satisfied"
        }
      ]
    },
    "alternativeCauses": ["list of additional theories to plead in the alternative, e.g. 'Account stated', 'Quantum meruit / unjust enrichment'"],
    "counterclaimRisk": {
      "level": "low" | "medium" | "high",
      "reasoning": "1-2 sentences explaining your assessment",
      "signals": ["list of specific signals observed in the case data that informed this rating — both risk-elevating and risk-reducing"]
    },
    "debtorEntityNotes": "Based on the debtor entity type, explain the enforcement path after judgment: what tools are available (wage garnishment, bank levy, property lien), what is NOT available, and any practical notes about collecting from this type of entity. If entity type is unknown, flag this and recommend verification via NYS entity records.",
    "recommendedStrategy": "QUICK_ESCALATION" | "STANDARD_RECOVERY" | "GRADUAL_APPROACH",
    "strategyReasoning": "1-2 sentences explaining why this strategy fits this specific case — reference the SOL position if payment due date is known, case strength, counterclaim risk, and debtor behavior signals"
  }
}

CAUSE OF ACTION GUIDE (use to select primaryCauseOfAction):
- breach_of_written_contract: Requires a signed/written agreement (contract, SOW, proposal, or email chain forming a contract). Elements: (1) valid written contract, (2) plaintiff performed, (3) defendant breached by non-payment, (4) damages.
- breach_of_oral_contract: For verbal or implied agreements with no written record. Same elements but harder to prove.
- account_stated: Powerful when invoices were sent, received, and not disputed within a reasonable time. Elements: (1) prior business dealings, (2) invoice/statement sent, (3) defendant received and did not dispute, (4) balance unpaid. Does not require a formal contract.
- quantum_meruit: Fallback when no contract exists. Elements: (1) services rendered in good faith, (2) defendant accepted the benefit, (3) failure to pay would unjustly enrich defendant. Damages = reasonable value of services.
In NY practice, plead all applicable theories in the alternative. Pick the strongest as primary.

COUNTERCLAIM RISK SIGNALS:
Risk-elevating: explicit written dispute of invoice or work quality; fixed-price contract with vague/broad scope; no written acceptance or delivery confirmation; long delay between service completion and invoicing; communications suggesting debtor is unhappy with the work.
Risk-reducing: partial payment by debtor (implies acceptance); detailed written SOW with specific deliverables; written delivery confirmation or sign-off; client references the work positively in communications; invoice went undisputed for an extended period.

INDUSTRY-SPECIFIC COUNTERCLAIM RISK MODIFIERS (apply if industry is known):
These reflect real-world litigation patterns — adjust the base risk level accordingly and name the industry in your signals list:
- Creative / Design / Marketing: elevate risk — "deliverables weren't what I envisioned" is the most common B2B defense in these disputes; subjective quality standards make it hard to prove complete performance
- Technology / Software: elevate risk — same as creative; scope creep, bug disputes, and "it doesn't work as promised" are standard defenses
- Construction / Contracting: elevate risk — delay claims, change orders, material substitutions, and "you didn't finish" defenses are common and often well-documented on the debtor's side
- Professional Services (consulting, accounting, legal): baseline risk — engagement letters typically define scope clearly; harder for debtor to dispute what was delivered
- Healthcare / Medical: lower risk — services are specific and documentable; denial of service receipt is unusual
- Retail / Wholesale / Distribution: lower risk — goods delivered is a binary fact; disputes are about quantity/quality, not the transaction itself
- Real Estate: baseline risk — varies widely by deal type
- Transportation / Logistics: lower risk — delivery records are usually clear
- Financial Services: baseline risk

PRIOR COURT CASE MODIFIERS (apply if priorCourtCases data is available in userProvidedFacts):
If the debtor has prior court cases as defendant: mention this in signals; if 3+ prior cases as defendant, this is a meaningful risk-elevating signal — serial litigants often file reflexive counterclaims; also elevates QUICK_ESCALATION preference.
If the debtor has prior judgments paid: slightly risk-reducing — they can be collected from.
If the debtor has multiple active cases as defendant: consider noting possible insolvency risk in strategyReasoning.

ENTITY ENFORCEMENT GUIDE:
- Individual / Sole Proprietor: wage garnishment (10% gross wages, CPLR §5231), bank levy, property lien — all tools available
- LLC: bank levy (business accounts only), lien on business real property — wage garnishment NOT applicable; cannot touch personal assets without piercing the veil; post-judgment disclosure (§5224 subpoena) is often needed to locate bank accounts
- Corporation: same as LLC enforcement; note that piercing the corporate veil requires showing fraud or complete domination
- LLP / Partnership: similar to LLC for enforcement; individual partners may have personal liability depending on partnership structure — flag for attorney review
- Unknown entity: flag for verification via NYS entity records at apps.dos.ny.gov; enforcement path cannot be fully assessed until entity type is confirmed

STRATEGY SELECTION GUIDE:
- QUICK_ESCALATION: SOL approaching (under 1 year remaining), debtor appears defunct or unresponsive, strong case with clear docs, debtor has 3+ prior suits as defendant, or time is clearly of the essence
- STANDARD_RECOVERY: Typical case — clear claim, some uncertainty about debtor's willingness to engage, no urgency signals
- GRADUAL_APPROACH: Ongoing business relationship worth preserving, dispute risk is elevated, partial payments suggest good faith, or claim is weak and negotiation is preferable

MISSING INFO IMPACT GUIDE:
- high: case theory is fundamentally weakened or a required element cannot be proven
- medium: evidence is weakened but case is still viable; defendant has ammunition to challenge
- low: minor gap; unlikely to affect outcome significantly

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
      caseAssessment: {
        primaryCauseOfAction: {
          theory: 'breach_of_written_contract',
          reasoning: 'Unable to determine — re-run analysis.',
          elements: [],
        },
        alternativeCauses: [],
        counterclaimRisk: { level: 'medium', reasoning: 'Unable to determine — re-run analysis.', signals: [] },
        debtorEntityNotes: null,
        recommendedStrategy: 'STANDARD_RECOVERY',
        strategyReasoning: 'Unable to determine — re-run analysis.',
      },
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
  caseData: Record<string, unknown>,
  context: {
    demandLetterDate: string | null;
    courtName: string;
    filingDate: string;
  }
): Promise<DemandLetterResult> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const outstanding = (parseFloat(String(caseData.amountOwed || '0')) - parseFloat(String(caseData.amountPaid || '0'))).toFixed(2);
  const priorDemand = context.demandLetterDate
    ? `Our demand letter dated ${context.demandLetterDate} has gone unanswered.`
    : `Our prior demand for payment has gone unanswered.`;

  const prompt = `You are drafting a NOTICE OF IMMINENT LEGAL ACTION — the final communication before a lawsuit is filed. This is NOT a demand letter. Do not re-explain the dispute or the business relationship. The debtor has already received a full demand letter and ignored it.

TODAY: ${today}
PRIOR DEMAND: ${priorDemand}
COURT WHERE FILING WILL OCCUR: ${context.courtName}
FILING WILL COMMENCE ON OR AFTER: ${context.filingDate}
OUTSTANDING BALANCE: $${outstanding}
CLAIMANT: ${caseData.claimantBusiness || caseData.claimantName}
DEBTOR: ${caseData.debtorBusiness || caseData.debtorName}
DEBTOR ADDRESS: ${caseData.debtorAddress || '[address on file]'}

Write the notice with exactly these components, in this order:

1. Date line (today: ${today}, flush left)
2. Debtor name and address block
3. Centered bold header: NOTICE OF IMMINENT LEGAL ACTION
4. Centered subheader: Final Opportunity to Cure — Payment Required by ${context.filingDate}
5. One sentence: "${priorDemand}"
6. One sentence: "Unless payment in full of $${outstanding} is received on or before ${context.filingDate}, [claimant name/business] will file a complaint in ${context.courtName} without further notice or communication."
7. One sentence: "In addition to the principal amount, we will seek filing costs, service of process fees, and post-judgment interest at the statutory rate of 9% per annum."
8. One sentence: "No further communications will be sent prior to filing."
9. Signature block: claimant name and business, date

Total word count: 100–150 words. No background. No explanation of the dispute. No pleasantries.

Return JSON:
{
  "text": "plain text version",
  "html": "HTML version — date and address block flush left, header and subheader centered and bold, body paragraphs left-aligned, signature block left-aligned. Use <p>, <strong>, <div style='text-align:center'> tags. No external CSS classes."
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

// ── Verified courthouse address lookup ─────────────────────────────────────────
// Source: NYC Courts official website. Verify at nycourts.gov if fees or locations change.

function deriveCounty(debtorAddress: string | null | undefined): string {
  if (!debtorAddress) return 'Queens';
  const a = debtorAddress.toLowerCase();
  if (a.includes('manhattan') || a.includes(', ny 100') || a.includes('new york, ny 100') || a.includes('midtown') || a.includes('tribeca') || a.includes('soho') || a.includes('harlem') || a.includes('upper east') || a.includes('upper west') || a.includes('lower east') || a.includes('lower west') || a.includes('greenwich village') || a.includes('chelsea, ny') || a.includes('hell\'s kitchen')) return 'New York';
  if (a.includes('brooklyn') || a.includes('kings county') || a.includes(' ny 112') || a.includes('flatbush') || a.includes('bay ridge') || a.includes('park slope') || a.includes('bed-stuy') || a.includes('williamsburg') || a.includes('bushwick') || a.includes('bensonhurst') || a.includes('crown heights') || a.includes('cobble hill') || a.includes('carroll gardens')) return 'Kings';
  if (a.includes('bronx') || a.includes(', ny 104')) return 'Bronx';
  if (a.includes('staten island') || a.includes('richmond county') || a.includes(', ny 103')) return 'Richmond';
  // Queens neighborhoods / zip patterns
  if (a.includes('queens') || a.includes('jamaica') || a.includes('flushing') || a.includes('astoria') || a.includes('long island city') || a.includes('glendale') || a.includes('forest hills') || a.includes('bayside') || a.includes('ridgewood') || a.includes('rego park') || a.includes('jackson heights') || a.includes('corona') || a.includes('howard beach') || a.includes('ozone park') || a.includes(', ny 113') || a.includes(', ny 114') || a.includes(', ny 116')) return 'Queens';
  return 'Queens'; // default for NYC-area unknowns
}

const CIVIL_COURT_ADDRESSES: Record<string, { address: string; borough: string }> = {
  'New York': { address: '111 Centre Street, Room 410, New York, NY 10013', borough: 'Manhattan' },
  'Kings':    { address: '141 Livingston Street, Brooklyn, NY 11201', borough: 'Brooklyn' },
  'Queens':   { address: '89-17 Sutphin Boulevard, Jamaica, NY 11435', borough: 'Queens' },
  'Bronx':    { address: '851 Grand Concourse, Bronx, NY 10451', borough: 'Bronx' },
  'Richmond': { address: '927 Castleton Avenue, Staten Island, NY 10310', borough: 'Staten Island' },
};

const SUPREME_COURT_ADDRESSES: Record<string, { address: string; borough: string }> = {
  'New York': { address: '60 Centre Street, New York, NY 10007', borough: 'Manhattan' },
  'Kings':    { address: '360 Adams Street, Brooklyn, NY 11201', borough: 'Brooklyn' },
  'Queens':   { address: '88-11 Sutphin Boulevard, Jamaica, NY 11435', borough: 'Queens' },
  'Bronx':    { address: '851 Grand Concourse, Bronx, NY 10451', borough: 'Bronx' },
  'Richmond': { address: '18 Richmond Terrace, Staten Island, NY 10301', borough: 'Staten Island' },
};

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

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const year = new Date().getFullYear();
  const county = deriveCounty(caseData.debtorAddress as string | null);
  const civilAddr = CIVIL_COURT_ADDRESSES[county] ?? CIVIL_COURT_ADDRESSES['Queens'];
  const supremeAddr = SUPREME_COURT_ADDRESSES[county] ?? SUPREME_COURT_ADDRESSES['Queens'];

  const trackPrompts = {
    commercial: `You are filling out NYC Commercial Claims Court form CIV-SC-70.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${civilAddr.address}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate a pre-filled HTML version of the CIV-SC-70 form. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${year}) everywhere — never write a past year
- Amount claimed = outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Filing county is ${county} County — use this, do not re-derive
- Courthouse address is ${civilAddr.address} — use this exactly, do not change or guess
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

Instructions must use the exact courthouse address already provided: ${civilAddr.address} (${county} County Commercial Claims). Include: filing fee ($25 + postage), bring 2 copies of this form + proof that a demand letter was sent, filing cap is 5 commercial claims per month per claimant, the court handles notice to the defendant — no process server required.
Return ONLY valid JSON.`,

    civil: `You are filling out an NYC Civil Court Pro Se Summons and Complaint.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${civilAddr.address}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

═══════════════════════════════════════════════════
PARTY NAMING — DERIVE ONCE, USE VERBATIM THROUGHOUT THE ENTIRE DOCUMENT:

Plaintiff:
  - If BOTH claimantName AND claimantBusiness are present → use "${caseData.claimantName ? `${caseData.claimantName}, individually and d/b/a ${caseData.claimantBusiness}` : caseData.claimantBusiness}"
  - If only claimantBusiness → use claimantBusiness alone
  - If only claimantName → use claimantName alone
Use this exact format in the caption box, complaint header, signature block, and relief paragraph. Never vary it.

Defendant:
  - If BOTH debtorName AND debtorBusiness are present → use both: in the caption list debtorBusiness first, then debtorName individually. In the complaint body use "Defendant debtorName, individually and d/b/a debtorBusiness"
  - If only debtorBusiness → use debtorBusiness alone
  - If only debtorName → use debtorName alone
Use this exact format everywhere. Never vary it.

═══════════════════════════════════════════════════
HANDLING MISSING INFORMATION:
- Required structural fields (party addresses, dollar amounts, invoice number if referenced): use [UNKNOWN — VERIFY BEFORE FILING]
- Optional factual details not present in the case data (secondary businesses, additional entities defendant may operate, extra names): OMIT the allegation entirely. Do not mention facts you cannot state. Do not write [UNKNOWN] for optional details.
- Notary blanks in the verification section (signature line, "Sworn to before me this ___ day of ___", commission expiration): these are intentionally blank for wet-ink completion with the notary in person. Do NOT mark them [UNKNOWN] — leave them as blank underscores.

═══════════════════════════════════════════════════
AUTHORITATIVE DATES — use single specific dates, never ranges or "approximately":
- Payment due date: use paymentDueDate as one exact date formatted "Month DD, YYYY". Do not write a range. Do not write "approximately." If there is only one date available, use it as stated.
- Invoice date: use invoiceDate formatted "Month DD, YYYY"
- Agreement date: use agreementDate formatted "Month DD, YYYY"
In the complaint body, always state dates as a single specific date ("On [date], ..."). Never express uncertainty about dates.

═══════════════════════════════════════════════════
CRITICAL RULES:
- Use CURRENT YEAR (${year}) everywhere — never write a past year
- Filing county is ${county} County — use this, do not re-derive
- Courthouse address is ${civilAddr.address} — use this exactly, do not change or guess
- In the signature block, the location must match the county/city of filing — NOT "New York, New York" generically. Use the city derived from the claimant's address or the court's county
- Leave index number and date lines as blank underscores for handwriting
- The Verification block must say "State of New York" and the county of the plaintiff's address (not defendant's)
- Relief sought must use outstandingBalance (amountOwed minus amountPaid), not the full amountOwed

SUMMONS SECTION:
- Court header: "CIVIL COURT OF THE CITY OF NEW YORK" + "County of ${county}"
- Index Number: blank line — [ASSIGNED BY COURT CLERK — DO NOT FILL]
- Plaintiff box: use the Plaintiff format defined above + full address + phone + email
- Defendant box: use the Defendant format defined above + full address + phone
- Summons notice: "YOU ARE HEREBY SUMMONED to appear at the Civil Court of the City of New York at the courthouse in the County listed above. If you fail to appear, judgment may be taken against you by default for the relief demanded in the complaint. You must respond to this complaint within the time period prescribed by law (20 days after personal service; 30 days if service is by other means). Failure to appear or respond may result in a default judgment being entered against you for the amount demanded, together with interest, costs, and disbursements."
- Courthouse address: ${civilAddr.address} — use this exactly

COMPLAINT SECTION:
- Header: "Plaintiff [use Plaintiff format defined above], appearing Pro Se, alleges as follows:"
- Cause of Action heading: pick the most accurate from: BREACH OF CONTRACT / ACCOUNT STATED / QUANTUM MERUIT (use Breach of Contract if there was an agreement; add Account Stated if there was an invoice the defendant didn't dispute; add Quantum Meruit if no written contract)
- Numbered factual allegations (use actual names, single specific dates, amounts from case data):
  1. The Parties — who the parties are using the exact formats defined above. Do NOT mention secondary businesses or entities unless they are explicitly named in the case data.
  2. The Agreement — what was agreed, when (exact date), for how much
  3. Plaintiff's Full Performance — what was delivered/completed and when
  4. Invoice Rendered — invoice number, exact invoice date, exact payment due date (single date, no ranges)
  5. Partial Payment and Outstanding Balance — amount paid, amount remaining
  6. Account Stated (if invoice exists and was not disputed) — invoice establishes account stated
  7. Quantum Meruit in the alternative (if no written contract)
  8. Demand for Payment — demand was made, defendant refused
- Relief Sought box: "WHEREFORE, Plaintiff demands judgment against Defendant in the sum of $[outstandingBalance], together with statutory interest from the date of default, costs, and disbursements of this action, and for such other and further relief as this Court deems just and proper."

SIGNATURE BLOCK:
- "Dated: ${today}" followed by the city and state derived from claimant's address — pre-fill the date, do NOT leave it blank
- Signature line + claimant's full name bold + "Plaintiff, Pro Se" + address + phone + email

VERIFICATION:
- "State of New York )"
- "County of [county of claimant's address] ) ss.:"
- "I, [claimantName], being duly sworn, depose and say that I am the Plaintiff in the above-captioned action; that I have read the foregoing Complaint and know the contents thereof; and that the same is true to my own knowledge, except as to matters therein stated to be alleged on information and belief, and as to those matters I believe them to be true."
- Signature line + printed name + "Plaintiff, Pro Se"
- "Sworn to before me this _____ day of _____________, ${year}" — leave as blank underscores, NOT [UNKNOWN]
- Notary Public signature line — blank underscore
- "My Commission Expires: ___________" — blank underscore

Format as print-ready HTML (max-width 750px, serif font, court-document style, 1.4 line spacing).
Include disclaimer banner at top: "⚠ DISCLAIMER: This document was pre-filled from your case data. Have an attorney review before filing if possible. Fields marked [UNKNOWN — VERIFY BEFORE FILING] require your attention before submission."

Return JSON:
{
  "html": "complete HTML string",
  "formType": "NYC Civil Court — Pro Se Summons & Complaint",
  "instructions": ["5 specific numbered steps"]
}

Instructions must use the exact courthouse address already provided: ${civilAddr.address} (${county} County Civil Court). Include: filing fee (~$45), bring 3 copies, you must hire a licensed NY process server to serve the defendant within 120 days of filing, file the notarized Affidavit of Service with the clerk after service, calendar the defendant's answer deadline (20 days after personal service, 30 days after other service methods).
Return ONLY valid JSON.`,

    supreme: `You are filling out a New York Supreme Court Summons with Notice.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${supremeAddr.address}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${year}) everywhere — never write a past year
- Relief sought must use outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Filing county is ${county} County — use this, do not re-derive
- Courthouse address is ${supremeAddr.address} — use this exactly, do not change or guess
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
"Dated: ${today}     [city from claimant's address], New York" — pre-fill the date, do NOT leave it blank
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

Instructions must use the exact courthouse address already provided: ${supremeAddr.address} (${county} County Supreme Court). Include: purchase an index number from the County Clerk ($210) before filing, file the Summons with Notice, serve the defendant within 120 days via a licensed process server (CPLR Article 3), file the notarized Affidavit of Service with the clerk promptly after service, file an RJI (Request for Judicial Intervention) within 60 days of the first filing to get a judge assigned.
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
  const verified = verification.checks.filter(c => c.status === 'ok');

  const issueList = issues
    .map(c => `[${c.status.toUpperCase()}] ${c.field}\n  Expected: ${c.expected ?? '(not in case data)'}\n  Found: ${c.found ?? '(missing)'}\n  Verifier note: ${c.note}`)
    .join('\n\n');

  const verifiedList = verified
    .map(c => `✓ ${c.field}: "${c.found}"`)
    .join('\n');

  const county = deriveCounty(caseData.debtorAddress as string | null);
  const civilAddr = CIVIL_COURT_ADDRESSES[county] ?? CIVIL_COURT_ADDRESSES['Queens'];
  const supremeAddr = SUPREME_COURT_ADDRESSES[county] ?? SUPREME_COURT_ADDRESSES['Queens'];
  const reinjectedAddr = track === 'supreme' ? supremeAddr : civilAddr;

  const retryPrompt = `You previously generated a court form. An adversarial verification pass found issues. Your job is to regenerate the form with corrections — but read these rules carefully before acting.

═══════════════════════════════════════════════════
VERIFICATION SUMMARY FROM CHECKER:
${verification.summary}
═══════════════════════════════════════════════════

SOURCE CASE DATA (absolute ground truth — always wins over the verifier):
${JSON.stringify(caseData, null, 2)}

HARDCODED VERIFIED COURTHOUSE ADDRESSES (do not change, do not remove — injected from verified lookup table, not from AI):
- Filing county: ${county} County
- Courthouse address for this case: ${reinjectedAddr.address} (${reinjectedAddr.borough})
- If the verifier flagged these as wrong or hallucinated, ignore that — they are correct. Do not replace them with different addresses.

TODAY'S DATE (explicitly provided — not a hallucination): ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT YEAR: ${new Date().getFullYear()}

═══════════════════════════════════════════════════
FIELDS VERIFIED AS CORRECT — DO NOT CHANGE THESE:
${verifiedList || '(none)'}
═══════════════════════════════════════════════════

ISSUES FLAGGED BY VERIFIER (${issues.length}) — evaluate each one carefully before acting:
${issueList}

═══════════════════════════════════════════════════
HOW TO HANDLE EACH ISSUE TYPE:

FOR MISMATCH (a field contradicts the case data):
→ Fix it. The case data is ground truth. No exceptions.

FOR HALLUCINATED (a specific fact not derivable from case data):
→ Distinguish between two subtypes:
  a) Party names, amounts, dates, addresses, invoice numbers that contradict or add to case data → Remove or correct using case data.
  b) Procedural/legal facts derived from your legal knowledge (courthouse addresses from county, statutory boilerplate, service deadlines, filing fees) → These are ACCEPTABLE to keep. Add a note "Verify independently" next to them rather than removing them. Do not replace them with [UNKNOWN].

→ IMPORTANT: Today's date and the year ${new Date().getFullYear()} are NOT hallucinations — they were explicitly provided in the generation prompt. If the verifier flagged them as hallucinated, ignore that finding.

FOR MISSING (field left blank or marked UNKNOWN):
→ Fill it if the data exists in the case data above.
→ If the data genuinely does not exist in the case data, leave it as [UNKNOWN — VERIFY BEFORE FILING]. Do not invent it to satisfy the verifier.

FOR VERIFIER FALSE POSITIVES:
→ If the verifier flagged something as wrong but the case data clearly supports what you wrote, keep your version. You may push back, but only when the case data is on your side.
→ If the verifier contradicts itself (says "mismatch" but its own note says the value is actually correct), treat it as verified and do not change it.

═══════════════════════════════════════════════════
ORIGINAL FORM (your previous output, for reference):
${originalHtml.slice(0, 4000)}

═══════════════════════════════════════════════════

Generate the corrected form. Return JSON:
{
  "html": "complete corrected HTML string — full document, not just the changed sections",
  "formType": "${formType}",
  "instructions": ["same 5 filing steps unless corrections require changes"]
}

Return ONLY valid JSON.`;

  const retryResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. You have legal knowledge and can derive procedural facts (courthouse addresses, filing fees, service deadlines) from that knowledge. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
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

Return ONLY a complete HTML document — no JSON, no markdown, no code fences, no explanations.
Use inline styles only (no external CSS). Use single quotes for all HTML attribute values.
Use serif font, proper court caption formatting, numbered paragraphs, and signature lines.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no commentary.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  // Strip any accidental markdown fences
  const html = content.text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  return { text: html, html };
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
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const currentYear = new Date().getFullYear();

  const prompt = `You are an adversarial reviewer checking a pre-filled court form for accuracy. Your job is to catch genuinely wrong facts, missing required fields, and values that contradict the source case data.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

EXPLICITLY PROVIDED CONTEXT (these were given to the generator — do NOT flag as hallucinated):
- Today's date: ${today}
- Current year: ${currentYear}
- Courthouse addresses derived from county (e.g. Queens Civil Court at 89-17 Sutphin Blvd) are derived from legal knowledge, not case data — mark as "ok" with a note to verify independently, not as hallucinated
- Statutory boilerplate language (CPLR summons text, certification language, verification oath) is legal knowledge — mark as "ok"
- Filing fees, service deadlines, and procedural requirements are legal knowledge — mark as "ok"

GENERATED COURT FORM HTML:
${formHtml.slice(0, 20000)}

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
- County of filing (derived from defendant's address — verify the borough/county mapping is correct)
- Courthouse name and address (mark "ok" if correct for the county, note to verify independently)
- Document date (today's date ${today} is correct and expected — mark "ok")
- Year references (${currentYear} is correct — mark "ok")
- Signature block city/location (must derive from plaintiff's address)
- Whether hasWrittenContract: ${caseData.hasWrittenContract} is reflected appropriately in the cause of action

For each check, determine:
- "ok": correct — either matches case data, or is a valid legal/procedural derivation
- "missing": field was needed but left blank or marked UNKNOWN when the data exists in case data
- "mismatch": the form contains a value that directly contradicts the case data (wrong name, wrong amount, wrong address that's in the data)
- "hallucinated": a specific party fact (name, amount, invoice number, address) invented and not derivable from case data or legal knowledge — do NOT use this for courthouse addresses, dates, statutory text, or procedural facts

If you find yourself saying a field is both wrong AND correct in your note, mark it "ok" — do not report a false positive.

Return a JSON object:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [
    {
      "field": "field name",
      "status": "ok" | "missing" | "mismatch" | "hallucinated",
      "expected": "what the case data says, or null if this is a legal derivation",
      "found": "what appears in the generated form, or null if absent",
      "note": "brief explanation — if ok, this can be empty string"
    }
  ],
  "summary": "1-2 sentence plain-language summary focused on genuine issues only",
  "blankFields": ["field names that are blank or marked UNKNOWN where data was available"]
}

Status rules:
- "verified": all party/financial facts match case data, no genuine hallucinations, courthouse/procedural facts are reasonable derivations
- "review_needed": 1-2 missing fields where data wasn't available, or minor uncertainty — no clear errors
- "issues_found": any genuine mismatch (wrong party name, wrong amount), any invented party facts, or 3+ fields missing where data existed in case data

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
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

// ─── Strategy assessment with debtor research ──────────────────────────────────

export interface StrategyAssessment {
  strategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';
  reasoning: string;
  keyFactors: string[];
}

/**
 * Re-assess strategy using persisted debtor research results.
 * Reasons like a collections attorney: bankruptcy → entity type → assets → history.
 */
export async function assessStrategyWithResearch(
  caseData: Record<string, unknown>,
  lookupResults: {
    acris?: Record<string, unknown> | null;
    courts?: Record<string, unknown> | null;
    entity?: Record<string, unknown> | null;
    ucc?: Record<string, unknown> | null;
    ecb?: Record<string, unknown> | null;
    pacer?: Record<string, unknown> | null;
  }
): Promise<StrategyAssessment> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `You are a New York collections attorney advising a client on collection strategy. You have the case facts and the results of public records research on the debtor. Reason through this systematically and recommend the best strategy.

TODAY: ${today}

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

DEBTOR RESEARCH RESULTS:
${JSON.stringify(lookupResults, null, 2)}

Reason through the following factors in this exact order:

1. BANKRUPTCY (highest priority — stops everything)
   - Check pacer result: if activeCases > 0 and automaticStayActive = true → strategy is irrelevant, flag this immediately in keyFactors
   - If PACER not yet run, note this as a gap

2. ENTITY TYPE (determines enforcement tools after judgment)
   - LLC/Corp → no wage garnishment, only bank levy and property lien; getting money requires knowing their bank accounts
   - Sole prop / individual → wage garnishment available (10% gross), bank levy, property lien — all tools
   - Check entity result: does it confirm entity type? Does it conflict with what the case says?

3. NYC PROPERTY (ACRIS)
   - Property owner → judgment lien is a powerful post-judgment tool (prevents sale/refi); if acrisResult shows asGrantee > asGrantor → debtor likely owns NYC property
   - More property → more aggressive strategy is justified
   - No property → lien is not available; bank levy requires knowing the bank

4. SENIOR CREDITORS (UCC)
   - Active UCC filings from MCA (merchant cash advance) lenders or banks with blanket liens → your judgment will be behind them in priority
   - Multiple active UCCs → debtor may be asset-stripped; be realistic about recovery
   - No active UCCs → clean priority position after judgment

5. COURT HISTORY
   - 3+ prior cases as defendant → serial debtor, knows the system, likely to fight or default; escalate fast or cut losses
   - Prior defaults unpaid → judgment-proof signals
   - Prior judgments paid → can be collected from

6. ECB VIOLATIONS
   - High outstanding ECB balance (>$50k) → debtor who doesn't pay the city probably won't pay you either
   - Zero balance → neutral signal

7. CASE STRENGTH (from case data)
   - Strong evidence + clear contract → support aggressive stance
   - Weak evidence + ongoing relationship → support gradual approach

Based on all of the above, recommend one of:
- QUICK_ESCALATION: SOL pressure, strong evidence, good assets (property/bank), or serial debtor
- STANDARD_RECOVERY: Typical case, some uncertainty, no urgent signals
- GRADUAL_APPROACH: Active relationship, weak evidence, judgment-proof signals, or debtor showing some cooperation

Return JSON:
{
  "strategy": "QUICK_ESCALATION" | "STANDARD_RECOVERY" | "GRADUAL_APPROACH",
  "reasoning": "2-3 paragraph explanation of your analysis, written in plain English for a non-lawyer client. Explain what the research shows, what enforcement tools are available after judgment, and why this strategy fits.",
  "keyFactors": ["bullet 1 — most important factor", "bullet 2", "bullet 3", "bullet 4 (if relevant)", "bullet 5 (if relevant)"]
}

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are a New York collections attorney. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as StrategyAssessment;
  } catch {
    return {
      strategy: 'STANDARD_RECOVERY',
      reasoning: 'Could not complete analysis. Please review research results manually and select a strategy.',
      keyFactors: ['Analysis could not be completed — re-run or select strategy manually'],
    };
  }
}

// ─── New pre-trial documents ──────────────────────────────────────────────────

/**
 * Generate a blank Affidavit of Service template pre-filled with case parties.
 * The process server fills in date/time/method blanks by hand.
 */
export async function generateAffidavitOfService(
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `You are preparing an Affidavit of Service for a New York civil matter. This document is signed by the process server after they serve the summons, NOT by the plaintiff.

TODAY'S DATE: ${today}

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Generate a complete, properly formatted Affidavit of Service. The document must:

1. CAPTION
   - Full court caption: court name, county, plaintiff name(s), defendant name(s), index number line (leave blank as "Index No.: __________")

2. AFFIDAVIT BODY (sworn statement by the process server — blanks intentional)
   - "STATE OF NEW YORK )"
   - "COUNTY OF _________ ) ss.:"
   - "I, _____________________________, being duly sworn, depose and say:"
   - "1. I am over 18 years of age, not a party to this action, and am a licensed process server in the State of New York (License No.: _______________)."
   - "2. On _____________, 20____, at approximately _______ (AM/PM), I served the Summons [and Complaint] in the above-captioned action upon [defendant name from case data] at the following address: [debtorAddress from case data]."
   - "3. I served the above-named defendant by the following method (check one):"
     - "☐ Personal Service — I delivered the documents directly to the above-named defendant."
     - "☐ Substituted Service — I delivered the documents to ___________________________, a person of suitable age and discretion who resides/works at the above address, and also mailed a copy to the defendant's last known address."
     - "☐ Nail and Mail — After two (2) prior failed attempts on _____________ and _____________, I affixed the documents to the door of the above address and mailed copies to the defendant."
   - "4. A description of the person served (if applicable): Sex: _______ Approximate Age: _______ Height: _______ Weight: _______ Hair Color: _______"
   - "5. I declare under penalty of perjury that the foregoing is true and correct."

3. SIGNATURE BLOCK
   - "___________________________________"
   - "Process Server's Signature"
   - "Print Name: ___________________________"
   - "License No.: __________________________"
   - "Address: ______________________________"
   - "Sworn to before me this ____ day of _____________, 20____"
   - "___________________________________"
   - "Notary Public"
   - "My Commission Expires: ________________"

CRITICAL RULES:
- The blanks are intentional — this is a template for the process server to complete
- Pre-fill ONLY: defendant name, defendant address, plaintiff name, and the current year where appropriate
- Do NOT pre-fill: server name, date/time of service, method of service, or description of person served
- Use the debtorAddress from case data as the service address

Return JSON:
{
  "text": "plain text version",
  "html": "HTML version — serif font, court-document style, max-width 750px, proper caption formatting, checkbox symbols for service method options"
}

Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(content.text)) as DemandLetterResult;
  } catch {
    const text = content.text;
    return { text, html: `<div style="font-family: serif; max-width: 750px; margin: 0 auto; padding: 2rem;">${text.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>` };
  }
}

/**
 * Generate a Stipulation of Settlement — signed by both parties to document any
 * payment agreement reached before or after filing.
 */
export async function generateStipulationOfSettlement(
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const amountOwed = Number(caseData.amountOwed ?? 0);
  const amountPaid = Number(caseData.amountPaid ?? 0);
  const outstanding = amountOwed - amountPaid;

  const prompt = `You are preparing a Stipulation of Settlement for a New York collections matter. This is a binding agreement between the parties to settle the dispute without (or in lieu of) further litigation.

TODAY'S DATE: ${today}

CASE FACTS:
${JSON.stringify(caseData, null, 2)}
Outstanding balance: $${outstanding.toFixed(2)}

Generate a complete Stipulation of Settlement with these sections:

1. CAPTION
   If a court proceeding has been filed, include the court caption. Otherwise, use:
   "SETTLEMENT AGREEMENT AND STIPULATION
   Between: [Claimant/Business] ("Creditor") and [Debtor/Business] ("Debtor")"

2. RECITALS
   - Brief statement of the dispute: what was agreed, what was done, what is owed
   - "WHEREAS, Creditor claims that Debtor owes the sum of $[amountOwed] for [serviceDescription]..."
   - "WHEREAS, Debtor [acknowledges the debt / disputes the full amount (use acknowledgment unless case data indicates otherwise)]..."
   - "WHEREAS, the parties desire to resolve this matter without further litigation..."

3. SETTLEMENT TERMS
   - Settlement Amount: $[leave as [SETTLEMENT AMOUNT — TO BE NEGOTIATED AND FILLED IN]] — do NOT use outstanding balance; the settlement amount is negotiated
   - Payment Structure: provide two options as labeled alternatives:
     Option A — Lump Sum: Full settlement amount due within 7 days of signing
     Option B — Installments: [INSTALLMENT AMOUNT] on the [DAY] of each month, beginning [START DATE], until [SETTLEMENT AMOUNT] is paid in full
   - Payment Method: specify wire transfer, certified check, or Zelle to [claimant's business name]
   - Time is of the essence clause

4. CONSEQUENCES OF DEFAULT
   - "If Debtor fails to make any payment when due, Creditor may, upon [5] days written notice, declare the full original amount of $[amountOwed] immediately due and payable, less any amounts actually received."
   - "Upon default, this Stipulation may be entered as a judgment without further notice or hearing."

5. MUTUAL RELEASE
   - Upon full payment, Creditor releases all claims arising from the underlying debt
   - Debtor's acknowledgment of the debt is preserved (statute of limitations resets)

6. GENERAL TERMS
   - Governing law: State of New York
   - If any provision is unenforceable, remainder survives
   - This agreement constitutes the entire agreement between the parties

7. SIGNATURE BLOCKS (both parties)
   - Creditor: ___________________ (Signature), ___________________ (Print Name), Title: ___________________, Date: _______________
   - Debtor: ___________________ (Signature), ___________________ (Print Name), Title: ___________________, Date: _______________
   - "NOTARIZATION (recommended for enforcement):" with standard notary block for each party

Include a header disclaimer: "⚠ DISCLAIMER: This Stipulation of Settlement was prepared from your case data. Have an attorney review before signing. The settlement amount must be negotiated and filled in before execution."

Return only raw HTML — no JSON, no markdown, no code fences, no explanations. Start directly with the HTML content.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const html = content.text.trim();
  return { text: html, html };
}

/**
 * Generate a standalone Payment Plan Agreement — for installment arrangements
 * made outside a formal settlement, or as an exhibit to one.
 */
export async function generatePaymentPlanAgreement(
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const amountOwed = Number(caseData.amountOwed ?? 0);
  const amountPaid = Number(caseData.amountPaid ?? 0);
  const outstanding = amountOwed - amountPaid;

  const prompt = `You are preparing a Payment Plan Agreement for a New York B2B collections matter. The debtor has agreed (or is being asked) to pay the outstanding balance in installments.

TODAY'S DATE: ${today}

CASE FACTS:
${JSON.stringify(caseData, null, 2)}
Outstanding balance: $${outstanding.toFixed(2)}

Generate a complete Payment Plan Agreement with these sections:

1. HEADER
   "PAYMENT PLAN AGREEMENT"
   Between: [claimantBusiness or claimantName] ("Creditor") and [debtorBusiness or debtorName] ("Debtor")
   Date: ${today}

2. ACKNOWLEDGMENT OF DEBT
   - "Debtor hereby acknowledges and confirms that as of ${today}, Debtor owes Creditor the sum of $${outstanding.toFixed(2)} (the 'Debt'), arising from [serviceDescription]."
   - "This acknowledgment is intended to constitute a written acknowledgment of debt for purposes of the New York statute of limitations."

3. PAYMENT SCHEDULE
   - Total Amount: $${outstanding.toFixed(2)}
   - Down Payment (if any): $[AMOUNT] due upon signing — leave this as a blank for the parties to fill in
   - Installment Amount: $[INSTALLMENT AMOUNT] — leave as blank
   - Frequency: ☐ Weekly  ☐ Bi-weekly  ☐ Monthly
   - First Payment Due: [DATE] — leave as blank
   - Subsequent Payments Due: The [DAY] of each [week/month] thereafter
   - Final Payment Due: [FINAL DATE] — calculated from installments
   - Payment Method: Wire transfer / ACH / certified check to [claimantBusiness] — include wire/payment instructions if known

4. INTEREST
   - No interest if all payments are made on time.
   - If any payment is more than 5 days late, interest accrues at 9% per annum (New York statutory rate) on the remaining balance from the date of default.

5. ACCELERATION CLAUSE
   - "If Debtor fails to make any payment within [7] days of its due date, the entire unpaid balance shall immediately become due and payable without further notice."
   - "Upon acceleration, Creditor may pursue all available legal remedies including judgment, bank levy, and property lien."

6. DEFAULT AND REMEDIES
   - Written notice of default will be sent to Debtor's address on file
   - Debtor waives any right to cure after the second missed payment in a 12-month period

7. GENERAL TERMS
   - Governing law: State of New York
   - This agreement does not waive Creditor's right to pursue full judgment if Debtor defaults
   - Partial payments do not modify the total amount owed or constitute settlement unless so stated in writing signed by both parties

8. SIGNATURE BLOCKS
   Creditor: ___________________ (Signature), ___________________ (Print Name/Title), Date: _______________
   Debtor: ___________________ (Signature), ___________________ (Print Name/Title), Date: _______________

Include disclaimer: "⚠ DISCLAIMER: This Payment Plan Agreement was prepared from your case data. Fill in all blanks before signing. Have an attorney review if the amount is significant."

Return only raw HTML — no JSON, no markdown, no code fences, no explanations. Start directly with the HTML content.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const html = content.text.trim();
  return { text: html, html };
}

// ─── Demand Letter Verification ──────────────────────────────────────────────

export async function verifyDemandLetter(
  html: string,
  caseData: Record<string, unknown>
): Promise<CourtFormVerification> {
  const outstandingBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);

  const strategyDeadlines: Record<string, number> = {
    QUICK_ESCALATION: 7,
    STANDARD_RECOVERY: 14,
    GRADUAL_APPROACH: 21,
  };
  const expectedDays = strategyDeadlines[String(caseData.strategy ?? '')] ?? null;

  const dlPrompt = `You are an adversarial reviewer checking a pre-filled demand letter for factual accuracy. Your job is to catch genuinely wrong facts, missing required fields, and values that contradict the source case data.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

COMPUTED VALUES (treat as ground truth):
- outstandingBalance: $${outstandingBalance} (= amountOwed minus amountPaid)
- Strategy: ${caseData.strategy ?? 'unknown'}
- Expected response deadline: ${expectedDays !== null ? `${expectedDays} days` : 'unknown (strategy not set)'}

GENERATED DEMAND LETTER HTML:
${html.slice(0, 20000)}

Check each of the following:
- Plaintiff/claimant name and business name
- Defendant/debtor name and business name
- Defendant address
- Amount demanded (must equal outstandingBalance $${outstandingBalance}, NOT full amountOwed)
- Invoice number
- Invoice date
- Payment due date
- Agreement/service date
- Response deadline days (QUICK_ESCALATION=7, STANDARD_RECOVERY=14, GRADUAL_APPROACH=21)
- No facts asserted that are absent from case data
- Tone appropriate for strategy (QUICK=firm/urgent, STANDARD=professional, GRADUAL=cooperative)

For each check:
- "ok": correct or valid legal statement
- "missing": required field blank when data exists
- "mismatch": directly contradicts case data
- "hallucinated": specific party fact invented and not in case data

Return JSON:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [{ "field": "...", "status": "ok|missing|mismatch|hallucinated", "expected": "...", "found": "...", "note": "..." }],
  "summary": "1-2 sentence summary of genuine issues only",
  "blankFields": []
}

Status rules:
- "verified": all facts match, deadline matches strategy
- "review_needed": 1-2 missing fields where data wasn't available
- "issues_found": wrong amount, wrong party name, invented fact, or wrong deadline

Return ONLY valid JSON.`;

  const dlResp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: dlPrompt }],
  });

  const dlContent = dlResp.content[0];
  if (dlContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(dlContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Verification could not be completed automatically. Please review the letter manually.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

export async function retryDemandLetter(
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>,
  strategy: string
): Promise<DemandLetterResult> {
  const dlIssues = verification.checks.filter(c => c.status !== 'ok');
  const dlVerified = verification.checks.filter(c => c.status === 'ok');
  const dlBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);
  const dlDeadlines: Record<string, number> = { QUICK_ESCALATION: 7, STANDARD_RECOVERY: 14, GRADUAL_APPROACH: 21 };
  const dlExpectedDays = dlDeadlines[strategy] ?? 14;

  const dlIssueList = dlIssues
    .map(c => `[${c.status.toUpperCase()}] ${c.field}\n  Expected: ${c.expected ?? '(not in case data)'}\n  Found: ${c.found ?? '(missing)'}\n  Note: ${c.note}`)
    .join('\n\n');
  const dlVerifiedList = dlVerified.map(c => `✓ ${c.field}: "${c.found}"`).join('\n');

  const dlRetryPrompt = `You previously generated a demand letter. Verification found issues. Regenerate with only the flagged errors corrected — keep all other content unchanged.

VERIFICATION SUMMARY: ${verification.summary}

SOURCE CASE DATA (absolute ground truth):
${JSON.stringify(caseData, null, 2)}

- outstandingBalance: $${dlBalance} (use this as the demand amount)
- Strategy: ${strategy}
- Required response deadline: ${dlExpectedDays} days

FIELDS VERIFIED AS CORRECT — DO NOT CHANGE:
${dlVerifiedList || '(none)'}

ISSUES TO FIX (${dlIssues.length}):
${dlIssueList}

ORIGINAL LETTER HTML:
${originalHtml.slice(0, 8000)}

Rules: Fix only flagged issues. Amount must be $${dlBalance}. Deadline must be ${dlExpectedDays} days. If verifier contradicts case data, follow case data.

Return JSON: { "text": "plain text", "html": "complete corrected HTML" }
Return ONLY valid JSON.`;

  const dlRetryResp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: dlRetryPrompt }],
  });

  const dlRetryContent = dlRetryResp.content[0];
  if (dlRetryContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    return JSON.parse(extractJson(dlRetryContent.text)) as DemandLetterResult;
  } catch {
    return { text: originalHtml, html: originalHtml };
  }
}

// ─── Case Analysis Verification (flag-only, no retry) ─────────────────────────

export async function verifyCaseSynthesis(
  synthesis: CaseSynthesis,
  documents: Array<{
    classification: string | null;
    supportsTags: string[];
    summary: string | null;
    extractedFacts: Record<string, unknown> | null;
  }>,
  userFacts: Record<string, unknown>
): Promise<CourtFormVerification> {
  const synthPrompt = `You are an adversarial reviewer checking an AI-generated legal case analysis for logical consistency and factual grounding. Flag conclusions not supported by the underlying evidence.

USER-PROVIDED FACTS (ground truth):
${JSON.stringify(userFacts, null, 2)}

DOCUMENTS SUBMITTED (evidence base):
${JSON.stringify(documents.map(d => ({ classification: d.classification, supportsTags: d.supportsTags, summary: d.summary })), null, 2)}

AI-GENERATED CASE ANALYSIS:
${JSON.stringify(synthesis, null, 2)}

Check each of the following:
- caseStrength: if "strong", verify written contract or strong documentary evidence exists; flag if assessed strong with only oral/weak evidence
- primaryCauseOfAction.theory: if "breach_of_written_contract", verify hasWrittenContract is true OR a contract document exists; flag otherwise
- elements[].satisfied = true: each satisfied element must have a non-null evidence field; flag satisfied elements with null evidence
- counterclaimRisk.signals: each signal must trace to documents or userFacts; flag invented signals
- caseSummary: must not assert facts absent from userFacts and documents
- recommendedStrategy: if caseStrength "weak" and strategy QUICK_ESCALATION with no asset evidence, flag as potentially aggressive

For each check:
- "ok": grounded in evidence
- "missing": required evidence absent
- "mismatch": analysis contradicts evidence
- "hallucinated": fact not present in userFacts or documents

Return JSON:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [{ "field": "...", "status": "...", "expected": "...", "found": "...", "note": "..." }],
  "summary": "1-2 sentence summary of whether analysis is well-grounded",
  "blankFields": []
}

Return ONLY valid JSON.`;

  const synthResp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: synthPrompt }],
  });

  const synthContent = synthResp.content[0];
  if (synthContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(synthContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Analysis verification could not be completed automatically.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

// ─── Default Judgment Verification ───────────────────────────────────────────

export async function verifyDefaultJudgment(
  html: string,
  caseData: Record<string, unknown>
): Promise<CourtFormVerification> {
  const djBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);
  const djBalanceNum = parseFloat(djBalance);
  const djExpectedCourt = djBalanceNum < 10000
    ? 'Commercial Claims Court'
    : djBalanceNum < 50000
    ? 'Civil Court of the City of New York'
    : 'Supreme Court of the State of New York';

  const djVerifyPrompt = `You are an adversarial reviewer checking a Motion for Default Judgment for accuracy before court filing.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

COMPUTED VALUES:
- outstandingBalance: $${djBalance}
- Expected court: ${djExpectedCourt}
- Service: ${caseData.serviceInitiatedDate ? `initiated ${caseData.serviceInitiatedDate}` : 'not in case data'}

GENERATED DEFAULT JUDGMENT HTML:
${html.slice(0, 20000)}

Check:
- Plaintiff/claimant name (must match exactly)
- Defendant name (must match exactly)
- Dollar amount (must equal $${djBalance}, not full amountOwed)
- Court name (should match ${djExpectedCourt})
- County (derive from debtor address)
- Service date (must match case data if available; flag [UNKNOWN] if data exists)
- All 3 sections present: Notice of Motion, Affidavit in Support, Proposed Order/Judgment
- No [UNKNOWN — VERIFY BEFORE FILING] for fields that ARE in case data
- No facts absent from case data

For each check: "ok" | "missing" | "mismatch" | "hallucinated"

Return JSON:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [{ "field": "...", "status": "...", "expected": "...", "found": "...", "note": "..." }],
  "summary": "1-2 sentence summary",
  "blankFields": ["fields [UNKNOWN] where data was available"]
}

Return ONLY valid JSON.`;

  const djResp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: djVerifyPrompt }],
  });

  const djContent = djResp.content[0];
  if (djContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(djContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Verification could not be completed automatically. Review before filing.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

export async function retryDefaultJudgment(
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const djRetryIssues = verification.checks.filter(c => c.status !== 'ok');
  const djRetryVerified = verification.checks.filter(c => c.status === 'ok');
  const djRetryBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);

  const djIssueList = djRetryIssues
    .map(c => `[${c.status.toUpperCase()}] ${c.field}\n  Expected: ${c.expected ?? '(not in case data)'}\n  Found: ${c.found ?? '(missing)'}\n  Note: ${c.note}`)
    .join('\n\n');
  const djVerifiedList = djRetryVerified.map(c => `✓ ${c.field}: "${c.found}"`).join('\n');

  const djRetryPrompt = `You previously generated a Motion for Default Judgment. Verification found issues. Regenerate the full document with only the flagged errors corrected.

VERIFICATION SUMMARY: ${verification.summary}

SOURCE CASE DATA (absolute ground truth):
${JSON.stringify(caseData, null, 2)}

- outstandingBalance: $${djRetryBalance} (correct judgment amount)

FIELDS VERIFIED AS CORRECT — DO NOT CHANGE:
${djVerifiedList || '(none)'}

ISSUES TO FIX (${djRetryIssues.length}):
${djIssueList}

ORIGINAL DOCUMENT HTML:
${originalHtml.slice(0, 8000)}

Rules: Keep all 3 sections. Amount must be $${djRetryBalance}. Return complete corrected HTML.

Return ONLY raw HTML. No JSON, no markdown, no code fences.`;

  const djRetryResp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no commentary.',
    messages: [{ role: 'user', content: djRetryPrompt }],
  });

  const djRetryContent = djRetryResp.content[0];
  if (djRetryContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  const djHtml = djRetryContent.text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  return { text: djHtml, html: djHtml };
}

// ─── Settlement Verification ──────────────────────────────────────────────────

export async function verifySettlement(
  html: string,
  caseData: Record<string, unknown>
): Promise<CourtFormVerification> {
  const stlFullOwed = parseFloat(String(caseData.amountOwed ?? '0')).toFixed(2);

  const stlVerifyPrompt = `You are an adversarial reviewer checking a Stipulation of Settlement for accuracy.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

COMPUTED VALUES:
- Full amount owed (original debt): $${stlFullOwed} — should appear in default/acceleration clause
- Settlement amount: must be BLANK PLACEHOLDER (to be negotiated) — flag as hallucinated if pre-filled

GENERATED SETTLEMENT HTML:
${html.slice(0, 20000)}

Check:
- Plaintiff/creditor name and business (must match exactly)
- Defendant/debtor name and business (must match exactly)
- Original debt in default/acceleration clause (must be $${stlFullOwed})
- Settlement amount (must be blank or "TO BE NEGOTIATED" — flag as hallucinated if pre-filled)
- Governing law (must be New York)
- Signature blocks present for both parties
- No facts absent from case data

For each check: "ok" | "missing" | "mismatch" | "hallucinated"

Return JSON:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [{ "field": "...", "status": "...", "expected": "...", "found": "...", "note": "..." }],
  "summary": "1-2 sentence summary",
  "blankFields": []
}

Return ONLY valid JSON.`;

  const stlResp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: stlVerifyPrompt }],
  });

  const stlContent = stlResp.content[0];
  if (stlContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(stlContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Verification could not be completed automatically. Review before signing.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

export async function retrySettlement(
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const stlIssues = verification.checks.filter(c => c.status !== 'ok');
  const stlVerified = verification.checks.filter(c => c.status === 'ok');
  const stlFullOwed = parseFloat(String(caseData.amountOwed ?? '0')).toFixed(2);

  const stlIssueList = stlIssues
    .map(c => `[${c.status.toUpperCase()}] ${c.field}\n  Expected: ${c.expected ?? '(not in case data)'}\n  Found: ${c.found ?? '(missing)'}\n  Note: ${c.note}`)
    .join('\n\n');
  const stlVerifiedList = stlVerified.map(c => `✓ ${c.field}: "${c.found}"`).join('\n');

  const stlRetryPrompt = `You previously generated a Stipulation of Settlement. Verification found issues. Regenerate with only flagged errors corrected.

VERIFICATION SUMMARY: ${verification.summary}

SOURCE CASE DATA: ${JSON.stringify(caseData, null, 2)}

- Full debt for default clause: $${stlFullOwed}
- Settlement amount must remain blank — do NOT fill it in

FIELDS VERIFIED AS CORRECT — DO NOT CHANGE:
${stlVerifiedList || '(none)'}

ISSUES TO FIX (${stlIssues.length}): ${stlIssueList}

ORIGINAL HTML: ${originalHtml.slice(0, 8000)}

Return only raw HTML with corrections applied. No JSON, no markdown, no code fences.`;

  const stlRetryResp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: stlRetryPrompt }],
  });

  const stlRetryContent = stlRetryResp.content[0];
  if (stlRetryContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  const stlHtml = stlRetryContent.text.trim() || originalHtml;
  return { text: stlHtml, html: stlHtml };
}

// ─── Payment Plan Verification ────────────────────────────────────────────────

export async function verifyPaymentPlan(
  html: string,
  caseData: Record<string, unknown>
): Promise<CourtFormVerification> {
  const ppBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);

  const ppVerifyPrompt = `You are an adversarial reviewer checking a Payment Plan Agreement for accuracy.

SOURCE CASE DATA (ground truth):
${JSON.stringify(caseData, null, 2)}

COMPUTED VALUES:
- outstandingBalance: $${ppBalance} (= amountOwed minus amountPaid)

GENERATED PAYMENT PLAN HTML:
${html.slice(0, 20000)}

Check:
- Plaintiff/creditor name and business (must match exactly)
- Defendant/debtor name and business (must match exactly)
- Total amount (must equal $${ppBalance})
- Interest rate (must be 9% per annum — New York statutory rate)
- Acceleration clause present
- Acknowledgment of debt present (for SOL reset)
- Governing law is New York
- Math: if installment amount AND payments AND total all have specific numbers, verify installment × payments ≈ total; skip if any is a blank placeholder

For each check: "ok" | "missing" | "mismatch" | "hallucinated"

Return JSON:
{
  "overallStatus": "verified" | "review_needed" | "issues_found",
  "checks": [{ "field": "...", "status": "...", "expected": "...", "found": "...", "note": "..." }],
  "summary": "1-2 sentence summary",
  "blankFields": []
}

Return ONLY valid JSON.`;

  const ppResp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are an adversarial document reviewer. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: ppVerifyPrompt }],
  });

  const ppContent = ppResp.content[0];
  if (ppContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  try {
    const result = JSON.parse(extractJson(ppContent.text)) as CourtFormVerification;
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Verification could not be completed automatically. Review before signing.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

export async function retryPaymentPlan(
  originalHtml: string,
  verification: CourtFormVerification,
  caseData: Record<string, unknown>
): Promise<DemandLetterResult> {
  const ppIssues = verification.checks.filter(c => c.status !== 'ok');
  const ppVerified = verification.checks.filter(c => c.status === 'ok');
  const ppBalance = (
    parseFloat(String(caseData.amountOwed ?? '0')) -
    parseFloat(String(caseData.amountPaid ?? '0'))
  ).toFixed(2);

  const ppIssueList = ppIssues
    .map(c => `[${c.status.toUpperCase()}] ${c.field}\n  Expected: ${c.expected ?? '(not in case data)'}\n  Found: ${c.found ?? '(missing)'}\n  Note: ${c.note}`)
    .join('\n\n');
  const ppVerifiedList = ppVerified.map(c => `✓ ${c.field}: "${c.found}"`).join('\n');

  const ppRetryPrompt = `You previously generated a Payment Plan Agreement. Verification found issues. Regenerate with only flagged errors corrected.

VERIFICATION SUMMARY: ${verification.summary}

SOURCE CASE DATA: ${JSON.stringify(caseData, null, 2)}

- outstandingBalance: $${ppBalance}
- Interest rate: 9% per annum (NY statutory — do not change)

FIELDS VERIFIED AS CORRECT — DO NOT CHANGE:
${ppVerifiedList || '(none)'}

ISSUES TO FIX (${ppIssues.length}): ${ppIssueList}

ORIGINAL HTML: ${originalHtml.slice(0, 8000)}

Return only raw HTML with corrections applied. No JSON, no markdown, no code fences.`;

  const ppRetryResp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: ppRetryPrompt }],
  });

  const ppRetryContent = ppRetryResp.content[0];
  if (ppRetryContent.type !== 'text') throw new Error('Unexpected response type from Claude');

  const ppHtml = ppRetryContent.text.trim() || originalHtml;
  return { text: ppHtml, html: ppHtml };
}
