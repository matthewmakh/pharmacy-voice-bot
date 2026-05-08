/**
 * Post-judgment enforcement document generators.
 *
 * Per the audit, these documents are NOT customer-facing flows — they are
 * generated as inputs to the attorney handoff package. The partner attorney
 * files and serves them; we just produce the drafts so they have a head start.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 4,
  timeout: 120000,
});

const MODEL = 'claude-sonnet-4-6';

interface DocResult {
  text: string;
  html: string;
}

function extractJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  return (m ? m[1] : raw).trim();
}

async function generate(prompt: string): Promise<DocResult> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system: 'You are a legal document preparation assistant. Always respond with valid JSON only. No markdown, no code fences, no explanations.',
    messages: [{ role: 'user', content: prompt }],
  });
  const c = resp.content[0];
  if (c.type !== 'text') throw new Error('Unexpected response type from Claude');
  try {
    return JSON.parse(extractJson(c.text)) as DocResult;
  } catch {
    return {
      text: c.text,
      html: `<div style="font-family: serif; max-width: 750px; margin: 0 auto; padding: 2rem;">${c.text.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`,
    };
  }
}

const HTML_NOTE = 'HTML version — serif font, court-document style, max-width 750px, proper caption formatting';

/**
 * Information Subpoena (CPLR §5224) — issued post-judgment to compel the
 * judgment debtor to disclose assets.
 */
export async function generateInformationSubpoena(caseData: Record<string, unknown>): Promise<DocResult> {
  return generate(`You are preparing an Information Subpoena under CPLR §5224 for a New York post-judgment enforcement matter.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

The information subpoena requires the judgment debtor to answer written questions disclosing assets, employment, and income within 7 days.

Generate a complete document with:

1. CAPTION (full court caption with index number line)
2. INFORMATION SUBPOENA TITLE: "INFORMATION SUBPOENA — CPLR §5224"
3. NOTICE TO JUDGMENT DEBTOR
   - Names judgment creditor and judgment debtor
   - States judgment date, amount, and that it remains unsatisfied
   - Demands answers within 7 days under penalty of contempt
4. INTERROGATORIES (the actual questions; provide a comprehensive set):
   - Employment: current employer, address, position, salary, pay frequency, direct deposit account
   - Bank accounts: list each account, bank name, address, account number (last 4), balance
   - Real estate: properties owned (sole or joint), address, mortgages, equity
   - Vehicles: make, model, year, VIN, lienholder, equity
   - Other personal property valued > $1,000: jewelry, art, business equipment
   - Stocks, bonds, retirement accounts, brokerage accounts (with custodian + account #)
   - Receivables: any debts owed TO the judgment debtor
   - Self-employment / business interests: ownership %, name, EIN, gross income
   - Recent transfers: any property valued > $500 transferred in last 12 months
   - Sources of income other than employment: alimony, rental, dividends, etc.
5. ATTORNEY/PARTY ISSUING SUBPOENA block (creditor's attorney info — leave blank fields)
6. CERTIFICATION + SIGNATURE block for the judgment debtor (must answer under oath)

Pre-fill: case caption, judgment debtor name + address, judgment creditor name + amount, current year. Leave blank: judgment date (creditor will fill in), attorney info, dollar amounts the debtor must disclose.

Header disclaimer: "⚠ Issued post-judgment. Filing attorney must serve via certified mail or process server. Debtor has 7 days to respond. Failure = contempt."

Return JSON: { "text": "plain text", "html": "${HTML_NOTE}" }
Return ONLY valid JSON.`);
}

/**
 * Restraining Notice (CPLR §5222) — freezes the judgment debtor's bank
 * accounts up to twice the judgment amount.
 */
export async function generateRestrainingNotice(caseData: Record<string, unknown>): Promise<DocResult> {
  return generate(`You are preparing a Restraining Notice under CPLR §5222 for a New York post-judgment enforcement matter. This notice is served on the judgment debtor's bank or other garnishee to freeze accounts up to twice the judgment amount.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Generate a complete document with:

1. CAPTION (full court caption with index number line)
2. RESTRAINING NOTICE TITLE: "RESTRAINING NOTICE — CPLR §5222"
3. ADDRESS BLOCK to the garnishee (fillable; bank or other party holding debtor's funds)
4. NOTICE LANGUAGE
   - Identifies the judgment creditor + judgment debtor
   - Cites the judgment date and amount [JUDGMENT AMOUNT — TO BE FILLED IN]
   - States the restraint amount: TWICE the judgment plus accrued interest, fees, costs
   - Statutory language: "PLEASE TAKE NOTICE that ... pursuant to CPLR §5222(b), you are forbidden to make or suffer any sale, assignment or transfer of, or any interference with any property in which [judgment debtor] has an interest..."
   - Restraint duration: 1 year from service or until satisfaction of judgment
   - Statutory exemptions notice (must include): Social Security, SSI, VA benefits, public assistance, child support, unemployment, workers' comp, disability, retirement up to certain amounts, 90% of wages — NOT subject to restraint
5. SERVICE INSTRUCTIONS to the garnishee
   - Garnishee must respond within 5 days
   - Garnishee must NOT release any restrained funds without court order
   - Statutory penalty for noncompliance
6. EXEMPT INCOME PROTECTION ACT (EIPA) NOTICE (required attachment for individual debtors with bank accounts) — include the standard New York EIPA exemption notice with the §5222-a fields the debtor can use to claim exempt funds
7. ATTORNEY/PARTY ISSUING block (creditor's attorney info — leave blank)

Pre-fill: case caption, judgment debtor name + address, judgment creditor name, current year. Leave blank: judgment amount, judgment date, garnishee name + address, attorney info.

Header disclaimer: "⚠ Issued post-judgment. Must include EIPA exemption notice. Filing attorney serves on the bank/garnishee with proof of judgment. Restraint expires after 1 year — must be renewed if needed."

Return JSON: { "text": "plain text", "html": "${HTML_NOTE}" }
Return ONLY valid JSON.`);
}

/**
 * Property Execution (CPLR §5230) — directs the marshal/sheriff to seize
 * non-exempt property of the judgment debtor.
 */
export async function generatePropertyExecution(caseData: Record<string, unknown>): Promise<DocResult> {
  return generate(`You are preparing an Execution Against Property under CPLR §5230 for a New York post-judgment enforcement matter. This document directs a marshal or sheriff to levy on the judgment debtor's non-exempt personal or real property.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Generate a complete document with:

1. CAPTION (full court caption with index number line)
2. EXECUTION TITLE: "EXECUTION AGAINST PROPERTY — CPLR §5230"
3. DIRECTED TO: "To Any Sheriff or Marshal of the City of New York or the County of [COUNTY]:"
4. EXECUTION LANGUAGE
   - Identifies judgment creditor and judgment debtor
   - States judgment date, amount, court, and that it remains unsatisfied (in whole or part)
   - Commands the sheriff/marshal to satisfy the judgment from the personal property of the debtor (if insufficient, then real property) located within the jurisdiction
   - Statutory language: "WE COMMAND YOU, that of the goods and chattels, lands and tenements of the within-named judgment debtor, you cause to be made the sum of $[JUDGMENT AMOUNT — TO BE FILLED IN] with interest from [JUDGMENT DATE], being the amount of the within judgment..."
   - Returnable to the court within 60 days
5. PROPERTY DETAILS (creditor fills in known property locations)
   - Bank accounts (if income execution doesn't apply)
   - Specific personal property: vehicles, equipment, inventory
   - Real estate (must be levied separately; this triggers a sheriff's sale process)
6. ATTORNEY/PARTY ISSUING block (creditor's attorney info — leave blank)
7. CLERK'S SEAL / FILING block (left blank)

Pre-fill: case caption, judgment debtor name + address, judgment creditor name, current year. Leave blank: judgment amount, judgment date, attorney info, specific property descriptions.

Header disclaimer: "⚠ Issued post-judgment. Filed with the clerk → sheriff/marshal levy fee applies (typically $42–$140 in NYC). Marshal levies first; real estate execution requires separate process. Debtor exempt property protected."

Return JSON: { "text": "plain text", "html": "${HTML_NOTE}" }
Return ONLY valid JSON.`);
}

/**
 * Income Execution / Wage Garnishment (CPLR §5231) — garnishes up to 10%
 * of debtor's gross wages (or 25% of disposable earnings, whichever is less).
 */
export async function generateIncomeExecution(caseData: Record<string, unknown>): Promise<DocResult> {
  return generate(`You are preparing an Income Execution under CPLR §5231 for a New York post-judgment wage garnishment. This is the most common collection tool against an employed individual debtor.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Generate a complete document with:

1. CAPTION (full court caption with index number line)
2. EXECUTION TITLE: "INCOME EXECUTION — CPLR §5231"
3. DIRECTED TO: "To Any Sheriff or Marshal of the City of New York or the County of [COUNTY]:"
4. EXECUTION LANGUAGE
   - Identifies judgment creditor + judgment debtor
   - States judgment date, amount (with interest, costs), unsatisfied balance
   - Commands sheriff/marshal to issue notice and serve on the debtor's employer for garnishment
   - Statutory garnishment cap: lesser of 10% of gross income OR 25% of disposable earnings (after federal/state taxes, FICA), or the federal minimum wage threshold
   - First serves the JUDGMENT DEBTOR with a notice — if debtor doesn't begin paying voluntarily within 20 days, then served on employer
5. EMPLOYER INFORMATION section (creditor fills in)
   - Employer name + address [TO BE FILLED IN]
6. ATTORNEY/PARTY ISSUING block (creditor's attorney info — leave blank)
7. NOTICE TO JUDGMENT DEBTOR (separate cover sheet that goes to debtor first)
   - Tells debtor they have 20 days to begin voluntarily paying 10% of gross income
   - If they don't, a copy of this execution will be served on their employer
   - Lists statutory exemptions (10% cap, federal minimum wage protection, exempt income types)
8. EMPLOYER PAYMENT INSTRUCTIONS
   - How much to deduct each pay period
   - Where to send payments
   - Statutory 20-day waiting period after debtor notice

Pre-fill: case caption, judgment debtor name + address, judgment creditor name, current year. Leave blank: judgment amount, judgment date, employer name + address, dollar amounts per pay period, attorney info.

Header disclaimer: "⚠ Issued post-judgment. Standard NY wage garnishment cap is 10% of gross income. Must serve debtor first; only serve employer if debtor doesn't pay voluntarily within 20 days. Most common and most effective collection tool against an employed individual."

Return JSON: { "text": "plain text", "html": "${HTML_NOTE}" }
Return ONLY valid JSON.`);
}

/**
 * Marshal/Sheriff Request Packet — cover sheet + check the attorney attaches
 * to the property/income execution when delivering to the marshal's office.
 */
export async function generateMarshalRequest(caseData: Record<string, unknown>): Promise<DocResult> {
  return generate(`You are preparing a Marshal Request Packet cover sheet for a New York post-judgment enforcement matter. This is the cover document the attorney sends with an Execution to the marshal's or sheriff's office.

CASE FACTS:
${JSON.stringify(caseData, null, 2)}

Generate a complete document with:

1. ATTORNEY LETTERHEAD block (leave blank — attorney will fill in)
2. ADDRESSED to the appropriate marshal/sheriff:
   - "To the Marshal of the City of New York" (NYC) or "Sheriff of [County]" (outside NYC)
   - With the marshal/sheriff office address (leave fillable)
3. SUBJECT line: case caption, index number, judgment debtor
4. BODY paragraphs:
   - Identification of the judgment (creditor, debtor, court, index #, date, amount)
   - List of enclosed documents (typically: signed Execution, certified copy of judgment, $42–$140 marshal fee check or money order, bank/employer information sheet)
   - Specific instruction to the marshal:
     - Levy on bank account at [BANK NAME — TO BE FILLED IN]
     - Garnish wages at [EMPLOYER NAME — TO BE FILLED IN]
     - Levy on property at [PROPERTY ADDRESS — TO BE FILLED IN]
   - Contact info for follow-up
5. SIGNATURE block (attorney name, firm, bar number, address — all blank)
6. ENCLOSURES list at bottom

Pre-fill: judgment creditor name, judgment debtor name + address, current year. Leave blank: dollar amounts, judgment date, marshal name/address, bank/employer/property to levy on, attorney info.

Header disclaimer: "⚠ Marshal/sheriff fee required (currently $42 in NYC for income execution, $140 for property execution). Include fee check, certified copy of judgment, and complete Execution document with this cover sheet."

Return JSON: { "text": "plain text", "html": "${HTML_NOTE}" }
Return ONLY valid JSON.`);
}
