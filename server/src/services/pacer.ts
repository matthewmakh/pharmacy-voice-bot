// PACER Bankruptcy Check
// Public Access to Court Electronic Records — pacer.uscourts.gov
//
// Flow:
//   1. GET PACER login page → extract JSF ViewState
//   2. POST credentials → get PacerSession cookie
//   3. GET PACER Case Locator search page → extract form ViewState
//   4. POST party name search (business name) across all federal courts
//   5. Parse results for bankruptcy cases (Ch. 7, 11, 13)
//   6. For each match → GET the court's CM/ECF docket sheet → parse key fields
//
// What this tells you:
//   - Active automatic stay: DO NOT COLLECT (federal violation if you do)
//   - Ch. 7 discharged: debt likely wiped, nothing to collect
//   - Ch. 7 dismissed: stay lifted, you can proceed
//   - Ch. 11: file a proof of claim with the bankruptcy court
//   - Ch. 13: repayment plan, may receive partial payment as unsecured creditor
//
// Cost: $0.10/page. One search + one docket = ~$0.20-0.40. Under $30/quarter = free.
// Requires: PACER_USERNAME and PACER_PASSWORD in environment.

const LOGIN_BASE  = 'https://pacer.login.uscourts.gov';
const LOGIN_URL   = `${LOGIN_BASE}/csologin/login.jsf`;
const PCL_BASE    = 'https://pcl.uscourts.gov';
const PCL_SEARCH  = `${PCL_BASE}/pcl/pages/search/find.jsf`;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type BankruptcyChapter = '7' | '11' | '12' | '13' | '15' | 'unknown';
export type BankruptcyStatus  = 'Active' | 'Discharged' | 'Dismissed' | 'Converted' | 'Closed' | 'Unknown';

export interface BankruptcyCase {
  caseNumber: string;
  chapter: BankruptcyChapter;
  status: BankruptcyStatus;
  court: string;          // e.g. "Southern District of New York"
  courtCode: string;      // e.g. "nysb"
  dateFiled: string | null;
  dateClosed: string | null;
  dateDischarge: string | null;
  debtor: string;
  trustee: string | null;
  // Docket-level details (populated if docket fetch succeeds)
  hasAssets: boolean | null;
  meetingOfCreditors: string | null;
  proofOfClaimDeadline: string | null;
  automaticStayActive: boolean;
  actionRequired: string; // plain-English guidance
}

export interface PACERResult {
  found: boolean;
  totalCases: number;
  activeCases: number;
  cases: BankruptcyCase[];
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}

// ─── Cookie jar ───────────────────────────────────────────────────────────────

class CookieJar {
  private map = new Map<string, string>();

  ingest(headers: Headers): void {
    const raw: string[] = typeof (headers as unknown as { getSetCookie?(): string[] }).getSetCookie === 'function'
      ? (headers as unknown as { getSetCookie(): string[] }).getSetCookie()
      : [headers.get('set-cookie') ?? ''].filter(Boolean);

    for (const line of raw) {
      const pair = line.split(';')[0].trim();
      const eq   = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const val  = pair.slice(eq + 1).trim();
      if (name) this.map.set(name, val);
    }
  }

  toString(): string {
    return Array.from(this.map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  has(name: string): boolean { return this.map.has(name); }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract all hidden inputs from a JSF page */
function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag    = m[0];
    const nameM  = /name=["']([^"']+)["']/i.exec(tag);
    const valueM = /value=["']([^"']*)["']/i.exec(tag);
    if (nameM?.[1]) out[nameM[1]] = valueM?.[1] ?? '';
  }
  return out;
}

/** Extract a specific input value by partial name match */
function extractInput(html: string, nameContains: string): string {
  const re = new RegExp(`<input[^>]+name=["'][^"']*${nameContains}[^"']*["'][^>]*>`, 'i');
  const m = re.exec(html);
  if (!m) return '';
  const valueM = /value=["']([^"']*)["']/i.exec(m[0]);
  return valueM?.[1] ?? '';
}

/** Extract a JSF ViewState token */
function extractViewState(html: string): string {
  // JSF ViewState can be in various forms
  const patterns = [
    /name=["']javax\.faces\.ViewState["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']javax\.faces\.ViewState["']/i,
    /id=["']j_id[^"']*["'][^>]*value=["']([^"']+)["'][^>]*name=["']javax\.faces\.ViewState["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m?.[1]) return m[1];
  }
  return '';
}

// ─── Authentication ───────────────────────────────────────────────────────────

async function authenticate(jar: CookieJar): Promise<{ ok: boolean; error?: string }> {
  const username = process.env.PACER_USERNAME;
  const password = process.env.PACER_PASSWORD;
  if (!username || !password) {
    return { ok: false, error: 'PACER_USERNAME and PACER_PASSWORD not set in environment' };
  }

  // Step 1: GET login page for ViewState
  const pageResp = await fetch(LOGIN_URL, {
    headers: BASE_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!pageResp.ok) return { ok: false, error: `PACER login page returned ${pageResp.status}` };
  jar.ingest(pageResp.headers);
  const pageHtml = await pageResp.text();

  const viewState = extractViewState(pageHtml);
  const hiddens   = extractHiddenInputs(pageHtml);

  // Step 2: POST credentials
  const loginForm = new URLSearchParams({
    ...hiddens,
    'loginForm:loginName': username,
    'loginForm:password':  password,
    'loginForm:fbtnLogin': 'Login',
    'loginForm:clientCode': '',
    'javax.faces.ViewState': viewState,
    'javax.faces.source':    'loginForm:fbtnLogin',
    'javax.faces.partial.event': 'click',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render':  '@all',
    'javax.faces.behavior.event':  'action',
    'javax.faces.partial.ajax':    'true',
  });

  const loginResp = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': LOGIN_URL,
      'Cookie': jar.toString(),
      'X-Requested-With': 'XMLHttpRequest',
      'Faces-Request': 'partial/ajax',
    },
    body: loginForm.toString(),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });

  jar.ingest(loginResp.headers);
  const loginBody = await loginResp.text();

  const loginLower = loginBody.toLowerCase();

  // Check for explicit error messages first
  if (loginLower.includes('invalid') || loginLower.includes('incorrect') ||
      loginLower.includes('login failed') || loginLower.includes('authentication failed') ||
      loginLower.includes('username or password')) {
    return { ok: false, error: 'PACER credentials rejected. Check PACER_USERNAME and PACER_PASSWORD.' };
  }

  // If still on the login page with a form, auth failed silently
  if (loginResp.url?.includes('login.jsf') || loginBody.includes('loginForm:loginName')) {
    return { ok: false, error: 'PACER login returned the login page — credentials may be wrong, or PACER is requiring CAPTCHA/MFA. Log in manually at pacer.uscourts.gov to verify.' };
  }

  // PACER NextGen sets PacerSession or NextGenCSO on successful login
  // NOTE: do NOT check JSESSIONID — it is set on the initial GET (before login)
  if (jar.has('PacerSession') || jar.has('NextGenCSO')) {
    return { ok: true };
  }

  // PACER AJAX login returns XML with a redirect location in the body on success
  if (loginBody.includes('window.location') || loginBody.includes('MyAccount') ||
      loginBody.includes('pacer-landing') || loginBody.includes('logout')) {
    return { ok: true };
  }

  // If the POST redirected us to somewhere other than the login page, treat as success
  if (loginResp.url && !loginResp.url.includes('login.jsf') && loginResp.url.includes('uscourts.gov')) {
    return { ok: true };
  }

  return { ok: false, error: 'PACER login did not return a recognized success indicator. Cookies received: ' + jar.toString().slice(0, 80) + '. Check credentials at pacer.uscourts.gov.' };
}

// ─── PCL Search ───────────────────────────────────────────────────────────────

interface PCLCase {
  caseNumber: string;
  chapter: string;
  status: string;
  court: string;
  courtCode: string;
  dateFiled: string | null;
  dateClosed: string | null;
  debtor: string;
  caseLink: string | null;
}

async function searchPCL(partyName: string, jar: CookieJar): Promise<PCLCase[]> {
  // Step 1: GET search page for ViewState and form fields
  const searchPageResp = await fetch(PCL_SEARCH, {
    headers: { ...BASE_HEADERS, Cookie: jar.toString() },
    signal: AbortSignal.timeout(20_000),
  });
  if (!searchPageResp.ok) throw new Error(`PCL search page returned ${searchPageResp.status}`);
  jar.ingest(searchPageResp.headers);
  const searchHtml = await searchPageResp.text();

  const viewState  = extractViewState(searchHtml);
  const hiddens    = extractHiddenInputs(searchHtml);

  // Dynamically detect form field names for party name
  // PCL uses JSF component IDs — common patterns: findForm:partyName, findForm:lastName, etc.
  const nameFieldPatterns = [
    /name=["'](findForm[^"']*(?:partyName|lastName|orgName|businessName|name)[^"']*)["'][^>]*type=["']text["']/i,
    /type=["']text["'][^>]*name=["'](findForm[^"']*(?:partyName|lastName|orgName|businessName|name)[^"']*)["']/i,
    /name=["'](findForm:[^"']+)["'][^>]*type=["']text["']/i,
  ];
  let nameField = '';
  for (const p of nameFieldPatterns) {
    const m = p.exec(searchHtml);
    if (m) { nameField = m[1]; break; }
  }
  if (!nameField) nameField = 'findForm:partyLastName'; // fallback

  // Step 2: POST the search
  const searchForm = new URLSearchParams({
    ...hiddens,
    [nameField]: partyName,
    'javax.faces.ViewState': viewState,
    'findForm:btnSearch': 'Search',
    // Search all courts, all chapters, all dates
    'findForm:court': '',
    'findForm:chapter': '',
    'findForm:dateFiledFrom': '',
    'findForm:dateFiledTo': '',
  });

  // Also try common alternative field names
  searchForm.set('findForm:partyLastName', partyName);
  searchForm.set('findForm:partyName', partyName);

  const resultsResp = await fetch(PCL_SEARCH, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': PCL_SEARCH,
      'Cookie': jar.toString(),
    },
    body: searchForm.toString(),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });

  jar.ingest(resultsResp.headers);
  const resultsHtml = await resultsResp.text();

  return parsePCLResults(resultsHtml);
}

function parsePCLResults(html: string): PCLCase[] {
  const cases: PCLCase[] = [];

  // PCL results are in a table — look for rows with case numbers
  // Case numbers look like: 1:24-bk-12345 or 24-12345 etc.
  const caseNumPattern = /\d{1,2}:\d{2}-[a-z]{1,3}-\d{4,6}/gi;

  // Find the results table
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let bestTable = '';
  let bestScore = 0;
  let tm;

  while ((tm = tableRe.exec(html)) !== null) {
    const t = tm[0];
    let score = 0;
    if (/chapter/i.test(t)) score += 2;
    if (/bankruptcy|bk/i.test(t)) score += 2;
    if (/filed/i.test(t)) score++;
    if (/case/i.test(t)) score++;
    if (/<tr/i.test(t) && /<td/i.test(t)) score++;
    if (score > bestScore) { bestScore = score; bestTable = t; }
  }

  if (!bestTable || bestScore < 2) {
    // Fallback: search entire HTML for case-number-like patterns
    const matches = html.match(caseNumPattern) ?? [];
    for (const cn of [...new Set(matches)]) {
      cases.push({
        caseNumber: cn,
        chapter: extractChapterFromContext(html, cn),
        status: 'Unknown',
        court: extractCourtFromContext(html, cn),
        courtCode: deriveCourtCode(html, cn),
        dateFiled: null,
        dateClosed: null,
        debtor: '',
        caseLink: null,
      });
    }
    return cases;
  }

  // Parse table rows
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;

  while ((rowM = rowRe.exec(bestTable)) !== null) {
    const rowContent = rowM[1];
    if (!rowContent.includes('<td')) continue;

    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellM;
    while ((cellM = cellRe.exec(rowContent)) !== null) {
      cells.push(stripHtml(cellM[1]));
    }

    if (cells.length < 3) continue;

    // Find which cell has the case number
    const caseIdx = cells.findIndex(c => /\d{2}-[a-z]{1,3}-\d{4,6}/i.test(c) || /\d{1,2}:\d{2}-\d{4,6}/.test(c));
    if (caseIdx === -1) continue;

    const caseNumber = cells[caseIdx].match(/[\d:]+[-a-z]+-\d{4,6}/i)?.[0] ?? cells[caseIdx];

    // Extract chapter from cells (usually a number: 7, 11, 13, etc.)
    const chapterIdx = cells.findIndex(c => /^(7|11|12|13|15)$/.test(c.trim()));
    const chapter = chapterIdx !== -1 ? cells[chapterIdx].trim() : '';

    // Extract a case link from the row HTML
    const linkM = /href=["']([^"']*(?:DktRpt|docket|case)[^"']*)["']/i.exec(rowContent);
    const caseLink = linkM ? linkM[1] : null;

    // Try to identify court from row
    const courtCell = cells.find(c => /district|bankruptcy/i.test(c)) ?? '';

    // Status
    const statusCell = cells.find(c => /open|closed|discharged|dismissed|converted/i.test(c)) ?? '';
    const status = normalizeStatus(statusCell);

    // Dates — look for cells that look like dates
    const dateCells = cells.filter(c => /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(c));
    const dateFiled  = dateCells[0] || null;
    const dateClosed = dateCells[1] || null;

    // Debtor name — often the first cell or the cell before the case number
    const debtor = caseIdx > 0 ? cells[caseIdx - 1] : (cells[0] !== cells[caseIdx] ? cells[0] : '');

    cases.push({
      caseNumber,
      chapter: chapter || extractChapterFromContext(rowContent, caseNumber),
      status,
      court: courtCell || extractCourtFromContext(html, caseNumber),
      courtCode: deriveCourtCode(courtCell || html, caseNumber),
      dateFiled,
      dateClosed,
      debtor,
      caseLink,
    });
  }

  return cases;
}

function normalizeStatus(raw: string): BankruptcyStatus {
  const s = raw.toLowerCase();
  if (/discharg/i.test(s)) return 'Discharged';
  if (/dismiss/i.test(s))  return 'Dismissed';
  if (/convert/i.test(s))  return 'Converted';
  if (/closed/i.test(s))   return 'Closed';
  if (/open|active|pend/i.test(s)) return 'Active';
  return 'Unknown';
}

function extractChapterFromContext(html: string, caseNumber: string): string {
  const idx = html.indexOf(caseNumber);
  if (idx === -1) return 'unknown';
  const snippet = html.slice(Math.max(0, idx - 200), idx + 200);
  const m = /chapter\s*(\d+)/i.exec(snippet) ?? /ch[.\s]*(\d+)/i.exec(snippet);
  return m?.[1] ?? 'unknown';
}

function extractCourtFromContext(html: string, caseNumber: string): string {
  const idx = html.indexOf(caseNumber);
  if (idx === -1) return '';
  const snippet = html.slice(Math.max(0, idx - 300), idx + 300);
  const m = /(northern|southern|eastern|western)\s+district\s+of\s+\w+/i.exec(snippet);
  return m?.[0] ?? '';
}

function deriveCourtCode(context: string, caseNumber: string): string {
  // Try to extract court code from case number (e.g. "nysb" from "1:24-bk-12345")
  // or from court name mentions
  const knownCourts: Record<string, string> = {
    'southern district of new york': 'nysb',
    'eastern district of new york':  'nyeb',
    'northern district of new york': 'nynb',
    'western district of new york':  'nywb',
    'district of new jersey':        'njb',
    'eastern district of pennsylvania': 'paeb',
    'district of connecticut':       'ctb',
    'district of delaware':          'deb',
  };
  const lower = context.toLowerCase();
  for (const [name, code] of Object.entries(knownCourts)) {
    if (lower.includes(name)) return code;
  }
  // Try to parse from case number format: district:year-type-number
  const m = /^(\w+):\d+-bk-/i.exec(caseNumber);
  return m?.[1]?.toLowerCase() ?? '';
}

// ─── Docket fetch ─────────────────────────────────────────────────────────────

interface DocketDetails {
  hasAssets: boolean | null;
  meetingOfCreditors: string | null;
  proofOfClaimDeadline: string | null;
  trustee: string | null;
  dischargeDate: string | null;
  status: BankruptcyStatus;
}

async function fetchDocket(pclCase: PCLCase, jar: CookieJar): Promise<DocketDetails> {
  const empty: DocketDetails = {
    hasAssets: null, meetingOfCreditors: null, proofOfClaimDeadline: null,
    trustee: null, dischargeDate: null, status: 'Unknown',
  };

  if (!pclCase.courtCode) return empty;

  // Try the court's CM/ECF bankruptcy docket
  const courtUrl = `https://ecf.${pclCase.courtCode}.uscourts.gov`;
  const docketUrl = pclCase.caseLink?.startsWith('http')
    ? pclCase.caseLink
    : `${courtUrl}/cgi-bin/DktRpt.pl?${encodeURIComponent(pclCase.caseNumber)}&type=ap`;

  try {
    const resp = await fetch(docketUrl, {
      headers: { ...BASE_HEADERS, Cookie: jar.toString(), Referer: PCL_SEARCH },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!resp.ok) return empty;
    jar.ingest(resp.headers);
    const html = await resp.text();

    // Assets
    const hasAssets = /no asset/i.test(html) ? false
      : /asset/i.test(html) ? true : null;

    // Meeting of creditors (341 meeting)
    const meetingM = /341\s+meeting[^<]{0,100}(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(html)
      ?? /meeting\s+of\s+creditors[^<]{0,100}(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(html);
    const meetingOfCreditors = meetingM?.[1] ?? null;

    // Proof of claim deadline
    const pocM = /proof\s+of\s+claim[^<]{0,100}(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(html);
    const proofOfClaimDeadline = pocM?.[1] ?? null;

    // Trustee
    const trusteeM = /trustee[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i.exec(html);
    const trustee = trusteeM?.[1]?.trim() ?? null;

    // Discharge date
    const dischargeM = /discharge[d]?[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(html);
    const dischargeDate = dischargeM?.[1] ?? null;

    // Status from docket
    let status: BankruptcyStatus = normalizeStatus(pclCase.status);
    if (/case\s+closed/i.test(html) && dischargeDate) status = 'Discharged';
    else if (/case\s+closed/i.test(html) && /dismiss/i.test(html)) status = 'Dismissed';
    else if (/case\s+closed/i.test(html)) status = 'Closed';
    else if (/pending|open/i.test(html)) status = 'Active';

    return { hasAssets, meetingOfCreditors, proofOfClaimDeadline, trustee, dischargeDate, status };
  } catch {
    return empty;
  }
}

// ─── Action guidance ──────────────────────────────────────────────────────────

function buildActionGuidance(bc: Omit<BankruptcyCase, 'actionRequired'>): string {
  const ch = bc.chapter;
  const st = bc.status;

  if (st === 'Active') {
    if (ch === '7') return `STOP — automatic stay is active. Do not call, write, or attempt to collect. Violating the automatic stay is a federal offense with sanctions. File a proof of claim only if the trustee announces there are assets to distribute (check for a "no asset" designation — if it's no-asset, you will likely recover nothing).`;
    if (ch === '11') return `STOP collecting — automatic stay is active. File a Proof of Claim (Official Form 410) with the bankruptcy court by the bar date. Monitor the reorganization plan to see if your claim is included.`;
    if (ch === '13') return `STOP collecting — automatic stay is active. File a Proof of Claim by the bar date. Under Ch. 13 you may receive partial payment through the repayment plan over 3-5 years.`;
    return `STOP collecting — automatic stay is active. Do not contact the debtor. Consult a bankruptcy attorney before taking any action.`;
  }

  if (st === 'Discharged') {
    return `Debt was likely discharged in bankruptcy — you may no longer be able to collect. If the debt was listed in the bankruptcy schedules, it is probably eliminated. Consult a bankruptcy attorney to confirm. Do not attempt to collect a discharged debt.`;
  }

  if (st === 'Dismissed') {
    return `Bankruptcy was dismissed — the automatic stay has been lifted. You may resume collection efforts. However, verify the dismissal was not a "dismissal with prejudice" which could restrict re-filing and affect your case.`;
  }

  if (st === 'Closed' || st === 'Unknown') {
    return `Bankruptcy case is closed. Verify whether debtor received a discharge (debt wiped) or a dismissal (stay lifted). Pull the docket to confirm before resuming collection.`;
  }

  return `Review bankruptcy case details and consult an attorney before proceeding with collection.`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function checkPACERBankruptcy(debtorName: string): Promise<PACERResult> {
  const searchedName = debtorName.trim();

  if (!process.env.PACER_USERNAME || !process.env.PACER_PASSWORD) {
    return noResult(searchedName, 'PACER_USERNAME and PACER_PASSWORD not set in environment.');
  }

  const jar = new CookieJar();

  // ── Step 1: Authenticate ──────────────────────────────────────────────────
  let authResult: { ok: boolean; error?: string };
  try {
    authResult = await authenticate(jar);
  } catch (err) {
    return noResult(searchedName, `PACER authentication failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!authResult.ok) {
    return noResult(searchedName, authResult.error ?? 'PACER authentication failed.');
  }

  // ── Step 2: Search PCL ────────────────────────────────────────────────────
  let pclCases: PCLCase[];
  try {
    pclCases = await searchPCL(searchedName, jar);
  } catch (err) {
    return noResult(searchedName, `PACER search failed: ${err instanceof Error ? err.message : String(err)}`, 'PCL search may have changed its form structure. Check pcl.uscourts.gov manually.');
  }

  if (pclCases.length === 0) {
    return {
      found: false, totalCases: 0, activeCases: 0, cases: [], searchedName,
      note: `No bankruptcy filings found for "${searchedName}" in PACER. Safe to proceed with collection — no automatic stay detected.`,
    };
  }

  // ── Step 3: Enrich top cases with docket details (max 3) ─────────────────
  const enriched: BankruptcyCase[] = [];
  for (const pc of pclCases.slice(0, 5)) {
    let docket: DocketDetails = {
      hasAssets: null, meetingOfCreditors: null, proofOfClaimDeadline: null,
      trustee: null, dischargeDate: null, status: normalizeStatus(pc.status),
    };

    if (pc.courtCode || pc.caseLink) {
      docket = await fetchDocket(pc, jar);
    }

    const chapter = (pc.chapter || 'unknown') as BankruptcyChapter;
    const status  = (docket.status !== 'Unknown' ? docket.status : normalizeStatus(pc.status)) as BankruptcyStatus;
    const automaticStayActive = status === 'Active';

    const bc: Omit<BankruptcyCase, 'actionRequired'> = {
      caseNumber: pc.caseNumber,
      chapter,
      status,
      court: pc.court,
      courtCode: pc.courtCode,
      dateFiled: pc.dateFiled,
      dateClosed: pc.dateClosed,
      dateDischarge: docket.dischargeDate,
      debtor: pc.debtor || searchedName,
      trustee: docket.trustee,
      hasAssets: docket.hasAssets,
      meetingOfCreditors: docket.meetingOfCreditors,
      proofOfClaimDeadline: docket.proofOfClaimDeadline,
      automaticStayActive,
    };

    enriched.push({ ...bc, actionRequired: buildActionGuidance(bc) });
  }

  const activeCases  = enriched.filter(c => c.status === 'Active').length;
  const hasActiveStay = activeCases > 0;

  // ── Step 4: Build note ────────────────────────────────────────────────────
  let note = '';
  if (hasActiveStay) {
    note = `🚨 ACTIVE BANKRUPTCY — automatic stay in effect. DO NOT ATTEMPT COLLECTION. ${activeCases} active case(s) found. See details below for required action.`;
  } else if (enriched.some(c => c.status === 'Discharged')) {
    note = `Bankruptcy found but debt may be discharged. Verify whether your specific debt was included. Do not collect until confirmed safe.`;
  } else if (enriched.some(c => c.status === 'Dismissed')) {
    note = `Prior bankruptcy found but it was dismissed — automatic stay has been lifted. You may resume collection.`;
  } else {
    note = `${pclCases.length} historical bankruptcy case(s) found — all appear to be closed. Verify status before proceeding.`;
  }

  return {
    found: true,
    totalCases: pclCases.length,
    activeCases,
    cases: enriched,
    searchedName,
    note,
  };
}

function noResult(searchedName: string, error: string, scraperNote?: string): PACERResult {
  return {
    found: false, totalCases: 0, activeCases: 0, cases: [], searchedName,
    note: '', error, scraperNote,
  };
}
