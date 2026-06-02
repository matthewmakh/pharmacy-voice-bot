import { generateHTML, generateJSON } from '../lib/anthropic';
import { countyForDocument } from '../lib/county';

// ─── Shared helpers ─────────────────────────────────────────────────────────────

// Dates are rendered in Eastern Time because every court, deadline, and filing in
// this product is New York. The server runs in UTC, so "today" could otherwise be a
// day off late at night — which matters for filing/cure deadlines.
function todayET(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}
function currentYearET(): number {
  return parseInt(new Date().toLocaleDateString('en-US', { year: 'numeric', timeZone: 'America/New_York' }), 10);
}

// ─── Types ──────────────────────────────────────────────────────────────────────

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
    elements: Array<{ element: string; satisfied: boolean; evidence: string | null; gap: string | null }>;
  };
  alternativeCauses: string[];
  counterclaimRisk: { level: 'low' | 'medium' | 'high'; reasoning: string; signals: string[] };
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
  | 'claimantName' | 'claimantBusiness' | 'claimantAddress' | 'claimantEmail' | 'claimantPhone'
  | 'debtorName' | 'debtorBusiness' | 'debtorAddress' | 'debtorEmail' | 'debtorPhone' | 'debtorEntityType'
  | 'amountOwed' | 'amountPaid' | 'serviceDescription'
  | 'agreementDate' | 'serviceStartDate' | 'serviceEndDate' | 'invoiceDate' | 'paymentDueDate'
  | 'hasWrittenContract' | 'invoiceNumber' | 'industry';

export interface IntakeFieldExtraction {
  value: string | number | boolean | null;
  confidence: 'high' | 'medium' | 'low';
  sourceDocId: string | null;
  sourceExcerpt: string | null;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  /** Why this matters for the case — shown to the user under the question. */
  why: string;
  /** Which intake field an answer should populate, if any. */
  field: IntakeFieldName | null;
  /** Optional suggested answers for quick selection. */
  suggestions?: string[];
}

/**
 * Enhanced "drop your evidence and we'll do the rest" result. In addition to the
 * extracted fields it returns a plain-language summary of what was read and a short
 * list of clarifying questions for the genuinely important gaps — so intake becomes a
 * guided conversation instead of a silent best-guess.
 */
export interface IntakeAutofillResult {
  fields: Record<IntakeFieldName, IntakeFieldExtraction>;
  documentSummary: string;
  clarifyingQuestions: ClarifyingQuestion[];
}

export interface DemandLetterResult {
  text: string;
  html: string;
}

export interface CourtFormResult {
  html: string;
  formType: string;
  instructions: string[];
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
  didRetry?: boolean;
  generationFailed?: boolean;
}

export interface StrategyAssessment {
  strategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';
  reasoning: string;
  keyFactors: string[];
}

const INTAKE_FIELD_NAMES: IntakeFieldName[] = [
  'claimantName', 'claimantBusiness', 'claimantAddress', 'claimantEmail', 'claimantPhone',
  'debtorName', 'debtorBusiness', 'debtorAddress', 'debtorEmail', 'debtorPhone', 'debtorEntityType',
  'amountOwed', 'amountPaid', 'serviceDescription',
  'agreementDate', 'serviceStartDate', 'serviceEndDate', 'invoiceDate', 'paymentDueDate',
  'hasWrittenContract', 'invoiceNumber', 'industry',
];

function emptyFields(): Record<IntakeFieldName, IntakeFieldExtraction> {
  const result = {} as Record<IntakeFieldName, IntakeFieldExtraction>;
  for (const name of INTAKE_FIELD_NAMES) {
    result[name] = { value: null, confidence: 'low', sourceDocId: null, sourceExcerpt: null };
  }
  return result;
}

// ─── Per-document analysis (static instructions cached) ──────────────────────────

const ANALYZE_DOC_SYSTEM = `You are a document analysis assistant for a New York B2B collections matter. Always respond with valid JSON only — no markdown, no code fences, no explanations.

Return a JSON object with exactly these fields:
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

Return ONLY valid JSON.`;

export async function analyzeDocument(extractedText: string, filename: string, mimeType: string): Promise<DocumentAnalysis> {
  const prompt = `Analyze this business document for a collections/dispute case.

Document name: ${filename}
Document type: ${mimeType}
Document text:
---
${extractedText.slice(0, 15000)}
---`;

  try {
    return await generateJSON<DocumentAnalysis>({
      system: ANALYZE_DOC_SYSTEM,
      prompt,
      schema: {
        type: 'object',
        properties: {
          classification: { type: 'string' },
          confidence: { type: 'number' },
          supportsTags: { type: 'array', items: { type: 'string' } },
          extractedFacts: { type: 'object' },
          summary: { type: 'string' },
        },
        required: ['classification', 'summary'],
      },
      maxTokens: 2048,
      label: 'analyzeDocument',
    });
  } catch (err) {
    console.error('Document analysis failed:', err);
    return { classification: 'other', confidence: 0.3, supportsTags: [], extractedFacts: {}, summary: 'Document uploaded (analysis error)' };
  }
}

// ─── Evidence-drop intake extraction (enhanced: summary + clarifying questions) ────

const INTAKE_SYSTEM = `You are pre-filling a New York B2B collections case intake form by extracting fields from the user's uploaded documents (contracts, invoices, emails, etc.) and then asking a few smart clarifying questions. The user will review and edit everything, so accuracy matters more than completeness — when in doubt, return null and ask.

EXTRACTION RULES:
1. Extract ONLY what is explicitly stated or strongly evidenced. NEVER invent or guess.
2. Return value null with confidence "low" for any field not evidenced — do not fabricate plausible-sounding values.
3. The CLAIMANT is the user's own business (the party owed money). The DEBTOR is the other party. Never swap them — the claimant issued the invoices and is collecting; the debtor owes payment.
4. claimantEmail and claimantPhone rarely appear in invoices the claimant sent — return null unless the documents explicitly contain them (e.g., on the claimant's letterhead).
5. Confidence rubric: "high" = stated verbatim; "medium" = clearly inferable (e.g., debtor address from the "Bill To" block); "low" = guess (prefer null).
6. sourceDocId: the document id (from the "id:" header) where the fact was found, else null.
7. sourceExcerpt: a ≤20-word verbatim quote from the source document, else null.
8. Dates must be ISO format (YYYY-MM-DD). amountOwed/amountPaid must be numbers (no symbols or commas). hasWrittenContract is a boolean. debtorEntityType must be one of: "LLC", "Corporation", "Sole Proprietor", "Partnership", "Individual", "Unknown".

CLARIFYING QUESTIONS:
Ask 2-5 short questions ONLY about information that materially affects the case and is missing or ambiguous. Prioritize, in order: payment due date (drives the statute of limitations), the debtor's exact legal name and entity type (drives service and enforcement), the outstanding amount if documents conflict, whether a signed contract exists, and the debtor's address (drives venue). Skip questions whose answers you already extracted with high confidence. Phrase each question for a non-lawyer and explain in one sentence why it matters. When useful, offer a few suggested answers.

Return ONLY valid JSON of this exact shape:
{
  "documentSummary": "2-4 sentence plain-language summary of which documents you reviewed and what the dispute appears to be",
  "fields": {
    "claimantName": {"value": ..., "confidence": "high|medium|low", "sourceDocId": "..."|null, "sourceExcerpt": "..."|null},
    "claimantBusiness": {...}, "claimantAddress": {...}, "claimantEmail": {...}, "claimantPhone": {...},
    "debtorName": {...}, "debtorBusiness": {...}, "debtorAddress": {...}, "debtorEmail": {...}, "debtorPhone": {...}, "debtorEntityType": {...},
    "amountOwed": {...}, "amountPaid": {...}, "serviceDescription": {...},
    "agreementDate": {...}, "serviceStartDate": {...}, "serviceEndDate": {...}, "invoiceDate": {...}, "paymentDueDate": {...},
    "hasWrittenContract": {...}, "invoiceNumber": {...}, "industry": {...}
  },
  "clarifyingQuestions": [
    {"id": "short_id", "question": "...", "why": "...", "field": "<one of the field names above>"|null, "suggestions": ["...", "..."]}
  ]
}
Return ONLY valid JSON. No markdown, no explanation.`;

export async function extractIntakeFromDocuments(
  documents: Array<{ id: string; originalName: string; extractedText: string }>,
): Promise<IntakeAutofillResult> {
  if (documents.length === 0) {
    return { fields: emptyFields(), documentSummary: 'No documents were provided.', clarifyingQuestions: [] };
  }

  const docsContext = documents
    .map((d, i) => `=== Document ${i + 1} (id: ${d.id}, filename: ${d.originalName}) ===\n${d.extractedText.slice(0, 12000)}`)
    .join('\n\n');

  const parsed = await generateJSON<{ fields?: Partial<Record<IntakeFieldName, IntakeFieldExtraction>>; documentSummary?: string; clarifyingQuestions?: ClarifyingQuestion[] }>({
    system: INTAKE_SYSTEM,
    prompt: `DOCUMENTS:\n${docsContext}`,
    schema: {
      type: 'object',
      properties: {
        documentSummary: { type: 'string' },
        fields: { type: 'object' },
        clarifyingQuestions: { type: 'array', items: { type: 'object' } },
      },
      required: ['fields'],
    },
    maxTokens: 4096,
    label: 'extractIntakeFromDocuments',
  });

  const validDocIds = new Set(documents.map((d) => d.id));
  const fields = emptyFields();
  for (const name of INTAKE_FIELD_NAMES) {
    const f = parsed.fields?.[name];
    if (f && typeof f === 'object' && 'value' in f) {
      const conf = f.confidence === 'high' || f.confidence === 'medium' || f.confidence === 'low' ? f.confidence : 'low';
      const sourceDocId = typeof f.sourceDocId === 'string' && validDocIds.has(f.sourceDocId) ? f.sourceDocId : null;
      fields[name] = {
        value: f.value === undefined ? null : f.value,
        confidence: conf,
        sourceDocId,
        sourceExcerpt: typeof f.sourceExcerpt === 'string' ? f.sourceExcerpt : null,
      };
    }
  }

  const fieldSet = new Set<string>(INTAKE_FIELD_NAMES);
  const clarifyingQuestions: ClarifyingQuestion[] = Array.isArray(parsed.clarifyingQuestions)
    ? parsed.clarifyingQuestions
        .filter((q) => q && typeof q.question === 'string')
        .slice(0, 5)
        .map((q, i) => ({
          id: typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`,
          question: q.question,
          why: typeof q.why === 'string' ? q.why : '',
          field: typeof q.field === 'string' && fieldSet.has(q.field) ? (q.field as IntakeFieldName) : null,
          suggestions: Array.isArray(q.suggestions) ? q.suggestions.filter((s) => typeof s === 'string').slice(0, 4) : undefined,
        }))
    : [];

  return {
    fields,
    documentSummary: typeof parsed.documentSummary === 'string' ? parsed.documentSummary : '',
    clarifyingQuestions,
  };
}

// ─── Case synthesis (static guides cached) ───────────────────────────────────────

const SYNTHESIZE_SYSTEM = `You are a New York collections attorney synthesizing a B2B debt collection case from uploaded documents and user-provided facts. Your analysis drives a legal workflow — be precise, honest, and grounded in the actual case data. Always respond with valid JSON only.

Return a single JSON object with exactly these fields:
{
  "timeline": [ {"date": "ISO date string or 'unknown'", "event": "clear description", "source": "document name or 'user-provided'"} ],
  "caseSummary": "2-3 paragraph plain-language summary of the dispute, what happened, and where things stand. Include the legal relationship, what was agreed, what was delivered, and what remains unpaid.",
  "caseStrength": "strong" | "moderate" | "weak",
  "extractedFacts": {
    "claimantName": "best guess from all sources", "claimantBusiness": "...", "debtorName": "...", "debtorBusiness": "...", "debtorAddress": "...",
    "amountOwed": number or null, "amountPaid": number or null, "serviceDescription": "...",
    "agreementDate": "ISO date or null", "invoiceDate": "ISO date or null", "paymentDueDate": "ISO date or null",
    "hasWrittenContract": boolean, "invoiceNumber": "... or null"
  },
  "evidenceSummary": { "hasContract": boolean, "hasInvoice": boolean, "hasProofOfWork": boolean, "hasCommunication": boolean, "hasPaymentRecord": boolean, "documentCount": number, "strongestEvidence": "description of most compelling evidence" },
  "missingInfo": [ {"item": "name of missing item", "consequence": "specific legal consequence of this gap", "impact": "high" | "medium" | "low", "workaround": "substitute/mitigation if one exists — otherwise omit this field"} ],
  "caseAssessment": {
    "primaryCauseOfAction": {
      "theory": "breach_of_written_contract" | "breach_of_oral_contract" | "account_stated" | "quantum_meruit",
      "reasoning": "1-2 sentences explaining why this is the strongest theory given the evidence",
      "elements": [ {"element": "specific legal element", "satisfied": true|false, "evidence": "doc/fact that satisfies it, or null", "gap": "what is missing if not satisfied, or null"} ]
    },
    "alternativeCauses": ["additional theories to plead in the alternative"],
    "counterclaimRisk": { "level": "low"|"medium"|"high", "reasoning": "1-2 sentences", "signals": ["specific signals observed — risk-elevating and risk-reducing"] },
    "debtorEntityNotes": "Based on the debtor entity type, explain the post-judgment enforcement path: what tools are available (wage garnishment, bank levy, property lien), what is NOT, and practical notes. If entity type is unknown, flag it and recommend verification via NYS entity records.",
    "recommendedStrategy": "QUICK_ESCALATION" | "STANDARD_RECOVERY" | "GRADUAL_APPROACH",
    "strategyReasoning": "1-2 sentences referencing SOL position if payment due date is known, case strength, counterclaim risk, and debtor behavior signals"
  }
}

CAUSE OF ACTION GUIDE (use to select primaryCauseOfAction):
- breach_of_written_contract: Requires a signed/written agreement. Elements: (1) valid written contract, (2) plaintiff performed, (3) defendant breached by non-payment, (4) damages.
- breach_of_oral_contract: For verbal or implied agreements with no written record. Same elements but harder to prove.
- account_stated: Powerful when invoices were sent, received, and not disputed within a reasonable time. Elements: (1) prior business dealings, (2) invoice/statement sent, (3) defendant received and did not dispute, (4) balance unpaid. Does not require a formal contract.
- quantum_meruit: Fallback when no contract exists. Elements: (1) services rendered in good faith, (2) defendant accepted the benefit, (3) failure to pay would unjustly enrich defendant. Damages = reasonable value of services.
In NY practice, plead all applicable theories in the alternative. Pick the strongest as primary.

COUNTERCLAIM RISK SIGNALS:
Risk-elevating: explicit written dispute of invoice or work quality; fixed-price contract with vague/broad scope; no written acceptance or delivery confirmation; long delay between service completion and invoicing; communications suggesting debtor is unhappy with the work.
Risk-reducing: partial payment by debtor; detailed written SOW with specific deliverables; written delivery confirmation or sign-off; client references the work positively; invoice went undisputed for an extended period.

INDUSTRY-SPECIFIC COUNTERCLAIM RISK MODIFIERS (apply if industry is known; name the industry in your signals):
- Creative / Design / Marketing: elevate — "deliverables weren't what I envisioned" is the most common B2B defense; subjective quality standards make complete performance hard to prove
- Technology / Software: elevate — scope creep, bug disputes, "it doesn't work as promised"
- Construction / Contracting: elevate — delay claims, change orders, material substitutions, "you didn't finish"
- Professional Services (consulting, accounting, legal): baseline — engagement letters usually define scope clearly
- Healthcare / Medical: lower — services are specific and documentable
- Retail / Wholesale / Distribution: lower — goods delivered is a binary fact
- Real Estate: baseline — varies by deal type
- Transportation / Logistics: lower — delivery records are usually clear
- Financial Services: baseline

PRIOR COURT CASE MODIFIERS (apply if priorCourtCases data is present in userProvidedFacts):
If the debtor has prior court cases as defendant: mention in signals; 3+ as defendant is a meaningful risk-elevating signal (serial litigants file reflexive counterclaims) and elevates QUICK_ESCALATION preference. Prior judgments paid: slightly risk-reducing. Multiple active cases as defendant: consider noting insolvency risk in strategyReasoning.

ENTITY ENFORCEMENT GUIDE:
- Individual / Sole Proprietor: wage garnishment (10% gross wages, CPLR §5231), bank levy, property lien — all available
- LLC: bank levy (business accounts only), lien on business real property — wage garnishment NOT applicable; cannot touch personal assets without piercing the veil; post-judgment disclosure (§5224 subpoena) often needed
- Corporation: same as LLC; piercing the corporate veil requires showing fraud or complete domination
- LLP / Partnership: similar to LLC; individual partners may have personal liability depending on structure — flag for attorney review
- Unknown entity: flag for verification via NYS entity records at apps.dos.ny.gov; enforcement path cannot be fully assessed until confirmed

STRATEGY SELECTION GUIDE:
- QUICK_ESCALATION: SOL approaching (under 1 year), debtor appears defunct/unresponsive, strong case with clear docs, debtor has 3+ prior suits as defendant, or time is of the essence
- STANDARD_RECOVERY: Typical case — clear claim, some uncertainty about willingness to engage, no urgency signals
- GRADUAL_APPROACH: Ongoing business relationship worth preserving, dispute risk elevated, partial payments suggest good faith, or claim is weak and negotiation is preferable

MISSING INFO IMPACT GUIDE:
- high: case theory is fundamentally weakened or a required element cannot be proven
- medium: evidence is weakened but the case is still viable; defendant has ammunition to challenge
- low: minor gap; unlikely to affect outcome

Sort timeline chronologically. Return ONLY valid JSON.`;

export async function synthesizeCase(
  documents: Array<{ originalName: string; classification: string | null; extractedFacts: Record<string, unknown> | null; supportsTags: string[]; summary: string | null }>,
  userProvidedFacts: Record<string, unknown>,
): Promise<CaseSynthesis> {
  const docsContext = documents
    .map((d, i) => `Document ${i + 1}: ${d.originalName}\nType: ${d.classification || 'unknown'}\nSummary: ${d.summary || 'N/A'}\nSupports: ${d.supportsTags.join(', ') || 'none identified'}\nFacts: ${JSON.stringify(d.extractedFacts || {}, null, 2)}`)
    .join('\n\n---\n\n');

  const prompt = `USER-PROVIDED CASE FACTS:\n${JSON.stringify(userProvidedFacts, null, 2)}\n\nUPLOADED DOCUMENTS (${documents.length} total):\n${docsContext}`;

  return generateJSON<CaseSynthesis>({
    system: SYNTHESIZE_SYSTEM,
    prompt,
    schema: {
      type: 'object',
      properties: {
        timeline: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, event: { type: 'string' }, source: { type: 'string' } } } },
        caseSummary: { type: 'string' },
        caseStrength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        extractedFacts: { type: 'object' },
        evidenceSummary: { type: 'object' },
        missingInfo: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, consequence: { type: 'string' }, impact: { type: 'string', enum: ['high', 'medium', 'low'] }, workaround: { type: 'string' } } } },
        caseAssessment: {
          type: 'object',
          properties: {
            primaryCauseOfAction: { type: 'object', properties: { theory: { type: 'string', enum: ['breach_of_written_contract', 'breach_of_oral_contract', 'account_stated', 'quantum_meruit'] }, reasoning: { type: 'string' }, elements: { type: 'array', items: { type: 'object', properties: { element: { type: 'string' }, satisfied: { type: 'boolean' }, evidence: { type: ['string', 'null'] }, gap: { type: ['string', 'null'] } } } } } },
            alternativeCauses: { type: 'array', items: { type: 'string' } },
            counterclaimRisk: { type: 'object', properties: { level: { type: 'string', enum: ['low', 'medium', 'high'] }, reasoning: { type: 'string' }, signals: { type: 'array', items: { type: 'string' } } } },
            debtorEntityNotes: { type: ['string', 'null'] },
            recommendedStrategy: { type: 'string', enum: ['QUICK_ESCALATION', 'STANDARD_RECOVERY', 'GRADUAL_APPROACH'] },
            strategyReasoning: { type: 'string' },
          },
        },
      },
      required: ['caseSummary', 'caseStrength', 'extractedFacts', 'evidenceSummary', 'caseAssessment'],
    },
    maxTokens: 12288,
    label: 'synthesizeCase',
  });
}

// ─── Case synthesis verification (subjective grounding check, flag-only) ──────────

const SYNTH_VERIFY_SYSTEM = `You are an adversarial reviewer checking an AI-generated legal case analysis for logical consistency and factual grounding. Flag conclusions not supported by the underlying evidence. Always respond with valid JSON only.

Check each of the following:
- caseStrength: if "strong", verify a written contract or strong documentary evidence exists; flag if assessed strong with only oral/weak evidence
- primaryCauseOfAction.theory: if "breach_of_written_contract", verify hasWrittenContract is true OR a contract document exists; flag otherwise
- elements[].satisfied = true: each satisfied element must have a non-null evidence field; flag satisfied elements with null evidence
- counterclaimRisk.signals: each signal must trace to documents or userFacts; flag invented signals
- caseSummary: must not assert facts absent from userFacts and documents
- recommendedStrategy: if caseStrength "weak" and strategy QUICK_ESCALATION with no asset evidence, flag as potentially aggressive

For each check: "ok" (grounded), "missing" (required evidence absent), "mismatch" (analysis contradicts evidence), or "hallucinated" (fact not present in inputs).

Return JSON:
{ "overallStatus": "verified"|"review_needed"|"issues_found", "checks": [{"field":"...","status":"...","expected":"...","found":"...","note":"..."}], "summary": "1-2 sentence summary of whether the analysis is well-grounded", "blankFields": [] }
Return ONLY valid JSON.`;

export async function verifyCaseSynthesis(
  synthesis: CaseSynthesis,
  documents: Array<{ classification: string | null; supportsTags: string[]; summary: string | null; extractedFacts: Record<string, unknown> | null }>,
  userFacts: Record<string, unknown>,
): Promise<CourtFormVerification> {
  const prompt = `USER-PROVIDED FACTS (ground truth):\n${JSON.stringify(userFacts, null, 2)}\n\nDOCUMENTS SUBMITTED (evidence base):\n${JSON.stringify(documents.map((d) => ({ classification: d.classification, supportsTags: d.supportsTags, summary: d.summary })), null, 2)}\n\nAI-GENERATED CASE ANALYSIS:\n${JSON.stringify(synthesis, null, 2)}`;

  try {
    const result = await generateJSON<CourtFormVerification>({
      system: SYNTH_VERIFY_SYSTEM,
      prompt,
      schema: {
        type: 'object',
        properties: {
          overallStatus: { type: 'string', enum: ['verified', 'review_needed', 'issues_found'] },
          checks: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, status: { type: 'string', enum: ['ok', 'missing', 'mismatch', 'hallucinated'] }, expected: { type: ['string', 'null'] }, found: { type: ['string', 'null'] }, note: { type: 'string' } } } },
          summary: { type: 'string' },
          blankFields: { type: 'array', items: { type: 'string' } },
        },
        required: ['overallStatus', 'summary'],
      },
      maxTokens: 4096,
      label: 'verifyCaseSynthesis',
    });
    result.verifiedAt = new Date().toISOString();
    return result;
  } catch {
    return { overallStatus: 'review_needed', checks: [], summary: 'Analysis verification could not be completed automatically.', blankFields: [], verifiedAt: new Date().toISOString() };
  }
}

// ─── Demand letter ──────────────────────────────────────────────────────────────

export async function generateDemandLetter(
  caseData: Record<string, unknown>,
  strategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH',
): Promise<DemandLetterResult> {
  const strategyDescriptions = {
    QUICK_ESCALATION: 'Firm and urgent. Deadline of 7 days. Strong language about legal consequences. Professional but direct.',
    STANDARD_RECOVERY: 'Professional and firm. Deadline of 14 days. Standard legal consequence language. Balanced tone.',
    GRADUAL_APPROACH: 'Professional and measured. Deadline of 21 days. Softer language about next steps. Cooperative tone.',
  };
  const deadline = strategy === 'QUICK_ESCALATION' ? 7 : strategy === 'STANDARD_RECOVERY' ? 14 : 21;

  const prompt = `You are drafting a professional business demand letter for a collections matter in New York.

STRATEGY: ${strategy}
Tone guidance: ${strategyDescriptions[strategy]}
Payment deadline: ${deadline} days from date of letter

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Write a complete, professional demand letter. Use these modular sections:

1. DATE AND HEADER (today's date: ${todayET()})
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
{ "text": "plain text version of the full letter", "html": "HTML version with proper formatting (use <p>, <br>, <strong>, <address> tags)" }

Return ONLY valid JSON.`;

  return generateJSON<DemandLetterResult>({
    system: 'You are a legal document preparation assistant for New York collections matters.',
    prompt,
    schema: { type: 'object', properties: { text: { type: 'string' }, html: { type: 'string' } }, required: ['text', 'html'] },
    maxTokens: 4096,
    label: 'generateDemandLetter',
  });
}

// ─── Pre-filing notice ──────────────────────────────────────────────────────────

export async function generateFinalNotice(
  caseData: Record<string, unknown>,
  context: { demandLetterDate: string | null; courtName: string; filingDate: string },
): Promise<DemandLetterResult> {
  const today = todayET();
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
{ "text": "plain text version", "html": "HTML version — date and address block flush left, header and subheader centered and bold, body paragraphs left-aligned, signature block left-aligned. Use <p>, <strong>, <div style='text-align:center'> tags. No external CSS classes." }

Return ONLY valid JSON.`;

  return generateJSON<DemandLetterResult>({
    system: 'You are a legal document preparation assistant for New York collections matters.',
    prompt,
    schema: { type: 'object', properties: { text: { type: 'string' }, html: { type: 'string' } }, required: ['text', 'html'] },
    maxTokens: 2048,
    label: 'generateFinalNotice',
  });
}

// ─── Court form (3 tracks) ──────────────────────────────────────────────────────

export async function generateCourtForm(
  caseData: Record<string, unknown>,
  track: 'commercial' | 'civil' | 'supreme',
): Promise<CourtFormResult> {
  const formMeta = {
    commercial: { formType: 'Commercial Claims Court — CIV-SC-70', fee: '$25', office: 'NYC Civil Court Commercial Claims Clerk', maxAmount: '$10,000' },
    civil: { formType: 'NYC Civil Court — Pro Se Summons & Complaint', fee: '$45', office: 'NYC Civil Court Clerk', maxAmount: '$50,000' },
    supreme: { formType: 'Supreme Court of the State of New York — Summons with Notice', fee: '$210 (Index Number)', office: 'County Clerk (Supreme Court)', maxAmount: 'Unlimited' },
  }[track];

  const today = todayET();
  const year = currentYearET();
  const { county, civilAddr, supremeAddr, venue } = countyForDocument(caseData.debtorAddress as string | null);

  const trackPrompts = {
    commercial: `You are filling out NYC Commercial Claims Court form CIV-SC-70.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${civilAddr}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate a pre-filled HTML version of the CIV-SC-70 form. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${year}) everywhere — never write a past year
- Amount claimed = outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Filing county is ${county} County — use this, do not re-derive
- Courthouse address is ${civilAddr} — use this exactly, do not change or guess
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

Signature line + "Dated: ${today}" (pre-filled with today's date — do NOT leave blank)

Format as clean HTML:
- Header: "CIVIL COURT OF THE CITY OF NEW YORK — COMMERCIAL CLAIMS PART"
- Subtitle: "Statement of Claim — CIV-SC-70"
- Each section in a bordered box with clear label/value pairs
- Disclaimer banner at top: "⚠ This form was pre-filled from your case data. Review every field carefully before filing. Verify the defendant's exact legal name via NYS entity records before submission."
- Print-friendly styling (max-width 700px, serif font)

Return JSON:
{ "html": "complete HTML string", "formType": "Commercial Claims Court — CIV-SC-70", "instructions": ["5 specific steps"] }

Instructions must use the exact courthouse address already provided: ${civilAddr} (${county} County Commercial Claims). Include: filing fee ($25 + postage), bring 2 copies of this form + proof that a demand letter was sent, filing cap is 5 commercial claims per month per claimant, the court handles notice to the defendant — no process server required.
Return ONLY valid JSON.`,

    civil: `You are filling out an NYC Civil Court Pro Se Summons and Complaint.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${civilAddr}

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
- Courthouse address is ${civilAddr} — use this exactly, do not change or guess
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
- Courthouse address: ${civilAddr} — use this exactly

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
{ "html": "complete HTML string", "formType": "NYC Civil Court — Pro Se Summons & Complaint", "instructions": ["5 specific numbered steps"] }

Instructions must use the exact courthouse address already provided: ${civilAddr} (${county} County Civil Court). Include: filing fee (~$45), bring 3 copies, you must hire a licensed NY process server to serve the defendant within 120 days of filing, file the notarized Affidavit of Service with the clerk after service, calendar the defendant's answer deadline (20 days after personal service, 30 days after other service methods).
Return ONLY valid JSON.`,

    supreme: `You are filling out a New York Supreme Court Summons with Notice.

TODAY'S DATE: ${today}
CURRENT YEAR: ${year}
FILING COUNTY: ${county} County
COURTHOUSE (verified — do not change): ${supremeAddr}

CASE DATA:
${JSON.stringify(caseData, null, 2)}

Generate pre-filled HTML. Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

CRITICAL RULES:
- Use CURRENT YEAR (${year}) everywhere — never write a past year
- Relief sought must use outstandingBalance (amountOwed minus amountPaid), not the full amountOwed
- Filing county is ${county} County — use this, do not re-derive
- Courthouse address is ${supremeAddr} — use this exactly, do not change or guess
- Signature block location must match the city from claimant's address, not generically "New York, New York"
- Nature of Action: choose all that apply from — BREACH OF CONTRACT (if agreement exists), ACCOUNT STATED (if invoice was sent and not disputed), QUANTUM MERUIT (if no written contract but services were rendered and accepted)

DOCUMENT STRUCTURE:

HEADER (all caps, centered):
"SUPREME COURT OF THE STATE OF NEW YORK
COUNTY OF ${county}"

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
{ "html": "complete HTML string", "formType": "Supreme Court of the State of New York — Summons with Notice", "instructions": ["5 specific steps"] }

Instructions must use the exact courthouse address already provided: ${supremeAddr} (${county} County Supreme Court). Include: purchase an index number from the County Clerk ($210) before filing, file the Summons with Notice, serve the defendant within 120 days via a licensed process server (CPLR Article 3), file the notarized Affidavit of Service with the clerk promptly after service, file an RJI (Request for Judicial Intervention) within 60 days of the first filing to get a judge assigned.
Return ONLY valid JSON.`,
  };

  let result: CourtFormResult;
  try {
    result = await generateJSON<CourtFormResult>({
      system: 'You are a legal document preparation assistant.',
      prompt: trackPrompts[track],
      schema: { type: 'object', properties: { html: { type: 'string' }, formType: { type: 'string' }, instructions: { type: 'array', items: { type: 'string' } } }, required: ['html'] },
      maxTokens: 8192,
      label: 'generateCourtForm',
    });
    result.formType = result.formType || formMeta.formType;
    if (!Array.isArray(result.instructions)) result.instructions = [];
  } catch {
    result = {
      html: `<div style="font-family: serif; max-width: 700px; margin: 0 auto; padding: 2rem;"><h2>${formMeta.formType}</h2><p>Form generation failed. Please try again.</p></div>`,
      formType: formMeta.formType,
      instructions: [`File at: ${formMeta.office}`, `Filing fee: ${formMeta.fee}`, 'Bring 3 copies of all documents', 'Bring a valid government-issued ID', 'Review all fields before submitting'],
    };
  }

  // When venue could not be confidently resolved, lead the instructions with a warning
  // instead of silently filing in a possibly-wrong county.
  if (venue.confidence !== 'high') {
    result.instructions = [`⚠ VENUE: ${venue.note}`, ...result.instructions];
  }

  return result;
}

// ─── Default judgment, affidavit, settlement, payment plan (raw HTML) ─────────────

export async function generateDefaultJudgment(caseData: Record<string, unknown>): Promise<DemandLetterResult> {
  const today = todayET();
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

Use the outstanding balance (amountOwed minus amountPaid) as the judgment amount, NOT the full amountOwed.
Use [UNKNOWN — VERIFY BEFORE FILING] for any missing fields.

Return ONLY a complete HTML document — no JSON, no markdown, no code fences, no explanations.
Use inline styles only (no external CSS). Use single quotes for all HTML attribute values.
Use serif font, proper court caption formatting, numbered paragraphs, and signature lines.`;

  const html = await generateHTML({ system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no commentary.', prompt, maxTokens: 8192, label: 'generateDefaultJudgment' });
  return { text: html, html };
}

export async function generateAffidavitOfService(caseData: Record<string, unknown>): Promise<DemandLetterResult> {
  const today = todayET();
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
     - "[ ] Personal Service — I delivered the documents directly to the above-named defendant."
     - "[ ] Substituted Service — I delivered the documents to ___________________________, a person of suitable age and discretion who resides/works at the above address, and also mailed a copy to the defendant's last known address."
     - "[ ] Nail and Mail — After two (2) prior failed attempts on _____________ and _____________, I affixed the documents to the door of the above address and mailed copies to the defendant."
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

Return ONLY a complete HTML document — serif font, court-document style, max-width 750px, proper caption formatting. Use inline styles only and single quotes for HTML attributes. No JSON, no markdown, no code fences.`;

  const html = await generateHTML({ system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.', prompt, maxTokens: 3072, label: 'generateAffidavitOfService' });
  return { text: html, html };
}

export async function generateStipulationOfSettlement(caseData: Record<string, unknown>): Promise<DemandLetterResult> {
  const today = todayET();
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

  const html = await generateHTML({ system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.', prompt, maxTokens: 8192, label: 'generateStipulationOfSettlement' });
  return { text: html, html };
}

export async function generatePaymentPlanAgreement(caseData: Record<string, unknown>): Promise<DemandLetterResult> {
  const today = todayET();
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
   - Frequency: [ ] Weekly  [ ] Bi-weekly  [ ] Monthly
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

  const html = await generateHTML({ system: 'You are a legal document preparation assistant. Return only raw HTML. No JSON, no markdown, no code fences, no explanations.', prompt, maxTokens: 8192, label: 'generatePaymentPlanAgreement' });
  return { text: html, html };
}

// ─── Strategy assessment with debtor research (static reasoning guide cached) ──────

const STRATEGY_SYSTEM = `You are a New York collections attorney advising a client on collection strategy. You have the case facts and the results of public records research on the debtor. Reason systematically and recommend the best strategy. Always respond with valid JSON only.

Reason through these factors in this exact order:
1. BANKRUPTCY (highest priority — stops everything): if pacer shows activeCases > 0 and automaticStayActive = true → strategy is irrelevant, flag immediately in keyFactors. If PACER not run, note this gap.
2. ENTITY TYPE (determines post-judgment enforcement): LLC/Corp → no wage garnishment, only bank levy and property lien; Sole prop/individual → wage garnishment (10% gross), bank levy, property lien. Check the entity result; flag conflicts with the case.
3. NYC PROPERTY (ACRIS): property owner → judgment lien is powerful; asGrantee > asGrantor suggests current ownership; no property → lien unavailable.
4. SENIOR CREDITORS (UCC): active MCA/bank blanket liens → your judgment is behind them; multiple active UCCs → debtor may be asset-stripped.
5. COURT HISTORY: 3+ prior cases as defendant → serial debtor; prior defaults unpaid → judgment-proof signals; prior judgments paid → collectible.
6. ECB VIOLATIONS: high outstanding (>$50k) → won't pay you either; zero balance → neutral.
7. CASE STRENGTH: strong evidence + clear contract → aggressive; weak + ongoing relationship → gradual.

Recommend one of: QUICK_ESCALATION (SOL pressure, strong evidence, good assets, or serial debtor), STANDARD_RECOVERY (typical, some uncertainty), GRADUAL_APPROACH (active relationship, weak evidence, judgment-proof signals, or cooperation).

Return JSON:
{ "strategy": "QUICK_ESCALATION"|"STANDARD_RECOVERY"|"GRADUAL_APPROACH", "reasoning": "2-3 paragraph plain-English explanation of the analysis, the available enforcement tools after judgment, and why this strategy fits", "keyFactors": ["most important factor", "...", "..."] }
Return ONLY valid JSON.`;

export async function assessStrategyWithResearch(
  caseData: Record<string, unknown>,
  lookupResults: { acris?: Record<string, unknown> | null; courts?: Record<string, unknown> | null; entity?: Record<string, unknown> | null; ucc?: Record<string, unknown> | null; ecb?: Record<string, unknown> | null; pacer?: Record<string, unknown> | null },
): Promise<StrategyAssessment> {
  const prompt = `TODAY: ${todayET()}\n\nCASE FACTS:\n${JSON.stringify(caseData, null, 2)}\n\nDEBTOR RESEARCH RESULTS:\n${JSON.stringify(lookupResults, null, 2)}`;

  try {
    return await generateJSON<StrategyAssessment>({
      system: STRATEGY_SYSTEM,
      prompt,
      schema: { type: 'object', properties: { strategy: { type: 'string', enum: ['QUICK_ESCALATION', 'STANDARD_RECOVERY', 'GRADUAL_APPROACH'] }, reasoning: { type: 'string' }, keyFactors: { type: 'array', items: { type: 'string' } } }, required: ['strategy', 'reasoning'] },
      maxTokens: 2048,
      label: 'assessStrategyWithResearch',
    });
  } catch {
    return { strategy: 'STANDARD_RECOVERY', reasoning: 'Could not complete analysis. Please review research results manually and select a strategy.', keyFactors: ['Analysis could not be completed — re-run or select strategy manually'] };
  }
}
