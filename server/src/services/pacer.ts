// PACER Bankruptcy Check — PACER Case Locator (PCL)
//
// Verified flow (run locally, IP-restricted from datacenters — use PROXY_URL in prod):
//   1. POST https://pacer.login.uscourts.gov/services/cso-auth
//        body: {"loginId","password","redactFlag":"1"}, Accept: application/json
//        → { nextGenCSO, loginResult } (loginResult "0" = success)
//   2. GET https://pcl.uscourts.gov/pcl/index.jsf  (Cookie: NextGenCSO=<token>)
//        → 302 to /pcl/pages/welcome.jsf — establishes JSESSIONID + TS* cookies
//   3. GET https://pcl.uscourts.gov/pcl/pages/search/findParty.jsf
//        → JSF page with frmSearch:* fields + jakarta.faces.ViewState
//   4. POST same URL with txtPartyNameLast=<business or surname>, ViewState, and
//        the btnSearch trigger → results page (HTML table)
//   5. Parse rows
//
// PCL is $0.10/page and the account MUST have PCL search access. If you see
// a redirect back to welcome.jsf when you POST the search, the account lacks
// PCL privileges — fix at pacer.uscourts.gov → Manage My Account → Maintenance.

import { fetchWithRetry, proxyFetch } from './lib/httpClient';

const AUTH_URL    = 'https://pacer.login.uscourts.gov/services/cso-auth';
const PCL_BASE    = 'https://pcl.uscourts.gov';
const PCL_INDEX   = `${PCL_BASE}/pcl/index.jsf`;
const PCL_PARTY   = `${PCL_BASE}/pcl/pages/search/findParty.jsf`;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type BankruptcyChapter = '7' | '11' | '12' | '13' | '15' | 'unknown';
export type BankruptcyStatus  = 'Active' | 'Discharged' | 'Dismissed' | 'Converted' | 'Closed' | 'Unknown';

export interface BankruptcyCase {
  caseNumber: string;
  chapter: BankruptcyChapter;
  status: BankruptcyStatus;
  court: string;
  courtCode: string;
  dateFiled: string | null;
  dateClosed: string | null;
  dateDischarge: string | null;
  debtor: string;
  trustee: string | null;
  hasAssets: boolean | null;
  meetingOfCreditors: string | null;
  proofOfClaimDeadline: string | null;
  automaticStayActive: boolean;
  actionRequired: string;
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
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const val  = pair.slice(eq + 1).trim();
      if (name) this.map.set(name, val);
    }
  }
  set(name: string, value: string): void { this.map.set(name, value); }
  has(name: string): boolean { return this.map.has(name); }
  toString(): string { return Array.from(this.map.entries()).map(([k, v]) => `${k}=${v}`).join('; '); }
}

/**
 * Manual redirect follower that carries cookies across hops. Node's built-in
 * fetch with `redirect: 'follow'` drops Set-Cookie between hops, which causes
 * PCL (JSF) to redirect-loop forever waiting for a JSESSIONID it just issued.
 */
async function fetchFollowingRedirects(
  url: string,
  init: { headers: Record<string, string>; jar: CookieJar; timeoutMs?: number; method?: string; body?: string },
  maxHops = 8,
): Promise<Response> {
  let currentUrl = url;
  let lastResp: Response | null = null;
  for (let hop = 0; hop < maxHops; hop++) {
    const resp = await proxyFetch(currentUrl, {
      method:   init.method ?? 'GET',
      headers:  { ...init.headers, Cookie: init.jar.toString() },
      body:     init.body,
      redirect: 'manual',
      timeoutMs: init.timeoutMs ?? 20_000,
    });
    init.jar.ingest(resp.headers);
    lastResp = resp;
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      currentUrl = new URL(loc, currentUrl).toString();
      // After the first hop, subsequent hops should always be GET.
      init.method = 'GET';
      init.body = undefined;
      continue;
    }
    return resp;
  }
  return lastResp!;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractHiddenInputs(html: string, formId: string): Record<string, string> {
  // Scope to the named form so we don't drag inputs from other forms on the page.
  const formMatch = new RegExp(`<form[^>]*id="${formId}"[^>]*>([\\s\\S]*?)</form>`, 'i').exec(html);
  const scope = formMatch?.[1] ?? html;
  const out: Record<string, string> = {};
  const re = /<input[^>]+type="hidden"[^>]*>/gi;
  let m;
  while ((m = re.exec(scope)) !== null) {
    const tag = m[0];
    const nameM  = /name="([^"]+)"/i.exec(tag);
    const valueM = /value="([^"]*)"/i.exec(tag);
    if (nameM?.[1]) out[nameM[1]] = valueM?.[1] ?? '';
  }
  return out;
}

function extractViewState(html: string): string {
  // PCL uses Jakarta Faces 4 → jakarta.faces.ViewState
  const re = /name="jakarta\.faces\.ViewState"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="jakarta\.faces\.ViewState"/i;
  const m = re.exec(html);
  return m?.[1] ?? m?.[2] ?? '';
}

// ─── Authentication: PACER PSC REST ───────────────────────────────────────────

interface CsoAuthResponse {
  nextGenCSO?: string;
  loginResult?: string;
  errorDescription?: string;
}

async function authenticate(jar: CookieJar): Promise<{ ok: boolean; error?: string; scraperNote?: string }> {
  const loginId  = process.env.PACER_USERNAME;
  const password = process.env.PACER_PASSWORD;
  if (!loginId || !password) {
    return { ok: false, error: 'PACER_USERNAME and PACER_PASSWORD not set in environment' };
  }

  let authBody: CsoAuthResponse;
  try {
    const resp = await proxyFetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ loginId, password, redactFlag: '1' }),
      timeoutMs: 20_000,
    });
    if (!resp.ok) {
      return { ok: false, error: `PACER auth endpoint returned ${resp.status}`,
        scraperNote: resp.status === 403 ? 'pacer.login.uscourts.gov is blocking this IP — set PROXY_URL to a residential proxy.' : undefined };
    }
    authBody = await resp.json() as CsoAuthResponse;
  } catch (err) {
    return { ok: false, error: `PACER auth request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (authBody.loginResult !== '0' || !authBody.nextGenCSO) {
    return { ok: false, error: `PACER credentials rejected: ${authBody.errorDescription || 'no nextGenCSO returned'}` };
  }

  jar.set('NextGenCSO', authBody.nextGenCSO);

  // Establish JSESSIONID on pcl.uscourts.gov by hitting /pcl/index.jsf.
  try {
    await fetchFollowingRedirects(PCL_INDEX, {
      headers: BASE_HEADERS,
      jar,
      timeoutMs: 20_000,
    });
    if (!jar.has('JSESSIONID')) {
      return { ok: false, error: 'PCL did not set JSESSIONID — account may lack PCL access.',
        scraperNote: 'Add PCL search access to the PACER account at pacer.uscourts.gov → Manage My Account → Maintenance → "Non-Attorney E-File Registration" or "PACER Account Maintenance".' };
    }
  } catch (err) {
    return { ok: false, error: `PCL session bootstrap failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true };
}

// ─── Search ───────────────────────────────────────────────────────────────────

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
  isBankruptcy: boolean;
}

async function searchParty(partyName: string, jar: CookieJar): Promise<{ cases: PCLCase[]; warn?: string }> {
  // 1. GET the search form for ViewState + hidden inputs
  const formResp = await fetchFollowingRedirects(PCL_PARTY, {
    headers: BASE_HEADERS,
    jar,
    timeoutMs: 20_000,
  });
  if (!formResp.ok) throw new Error(`findParty.jsf returned ${formResp.status}`);
  const formHtml  = await formResp.text();

  // If we were bounced to welcome.jsf, the account lacks PCL privilege.
  if (!formHtml.includes('frmSearch:txtPartyNameLast')) {
    return { cases: [], warn: 'PCL findParty form not available — account likely lacks PCL search access.' };
  }

  const hidden    = extractHiddenInputs(formHtml, 'frmSearch');
  const viewState = extractViewState(formHtml);

  // 2. POST search — PACER PCL form, real-name business goes in txtPartyNameLast.
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) form.set(k, v);
  form.set('frmSearch', 'frmSearch');
  form.set('frmSearch:txtPartyNameLast',  partyName);
  form.set('frmSearch:txtPartyNameFirst', '');
  form.set('frmSearch:txtPartyNameMiddle', '');
  form.set('frmSearch:cbExactMatches_input', 'on');
  form.set('frmSearch:cbEmptyMatches_input', 'on');
  // Limit to bankruptcy: PCL's case-type filter. Without this, the visible
  // 54-row first page is dominated by civil/appellate cases and bankruptcy
  // hits are pushed past the fold.
  form.set('frmSearch:ddCaseTypeBasic_input', 'bk');
  form.set('frmSearch:btnSearch', 'Search');
  form.set('jakarta.faces.ViewState', viewState);

  const resp = await fetchFollowingRedirects(PCL_PARTY, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': PCL_BASE,
      'Referer': PCL_PARTY,
    },
    body: form.toString(),
    jar,
    timeoutMs: 30_000,
  });

  if (!resp.ok) throw new Error(`PCL search POST returned ${resp.status}`);
  const html = await resp.text();

  // If the response is the welcome page, billing/access failed.
  if (html.includes('Welcome | PACER') && !html.includes('Search Results')) {
    return { cases: [], warn: 'PCL bounced search back to welcome page — likely billing or PCL access issue.' };
  }

  return { cases: parsePCLResults(html) };
}

function parsePCLResults(html: string): PCLCase[] {
  const cases: PCLCase[] = [];

  // Modern PCL renders results inside <tbody id="frmSearch:partyTable_data">
  // with rows that have data-ri="N". Case numbers use a colon+year+kind
  // format, e.g. 1:2024bk12345, 0:2013civil01469, 2:2022cr00100.
  //
  // The DOM is heavily PrimeFaces-nested (tooltips with their own <table>s
  // inside <td>s), which defeats <tr>/<td> regex extraction. Instead we
  // split on data-ri and pull out structured pieces with targeted regexes.
  const tbodyM = /<tbody[^>]*id="frmSearch:partyTable_data"[^>]*>([\s\S]*?)<\/tbody>/i.exec(html);
  if (!tbodyM) return cases;
  const body = tbodyM[1];

  const CASE_RE = /\b(\d{1,2}:\d{4}(bk|civil|cv|cr|mj|md|mc|ap|sw|po|ml|adv)\d{2,7})\b/i;

  const rawRows = body.split(/<tr data-ri="\d+"/i).slice(1);
  for (let chunk of rawRows) {
    // Trim chunk to this row only (split returns everything until next data-ri)
    const nextIdx = chunk.search(/<tr data-ri="\d+"/i);
    if (nextIdx > 0) chunk = chunk.slice(0, nextIdx);

    // Case number sits inside an <a> link.
    const linkM = /<a[^>]*\btarget="_blank"[^>]*>\s*(\d{1,2}:\d{4}[a-z]+\d+)\s*<\/a>/i.exec(chunk);
    if (!linkM) continue;
    const caseNumber = linkM[1];
    const kindM = CASE_RE.exec(caseNumber);
    const kind  = (kindM?.[2] ?? '').toLowerCase();
    const isBankruptcy = kind === 'bk';

    const hrefM   = /<a[^>]*\bhref="([^"]+)"[^>]*\btarget="_blank"[^>]*>\s*\d{1,2}:\d{4}[a-z]+/i.exec(chunk);
    const caseLink = hrefM?.[1] ?? null;

    // Strip ALL tags then collapse whitespace to extract free text from this row chunk
    const text = chunk
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const courtM   = /\b([A-Z][A-Z .,'&-]+(?:DISTRICT|BANKRUPTCY|CIRCUIT|COURT|APPEALS)[A-Z .,'&-]*)\b/.exec(text);
    const court    = courtM?.[1]?.trim() ?? '';
    const chapterM = /\bChapter:\s*(\d{1,2})\b/i.exec(text);
    const chapter  = chapterM?.[1] ?? '';
    const dispM    = /\bDisposition:\s*([^|]+?)(?:\s+(?:Party|Chapter|Jurisdiction|Discharged|Date|$))/i.exec(text);
    const status   = dispM?.[1]?.trim() ?? (text.match(/\b(Dismissed|Discharged|Closed|Open|Pending|Active|Terminated|Converted)\b[^|]{0,30}/i)?.[0] ?? '');
    const dates    = [...text.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)].map(m => m[1]);
    const debtorM  = /<td[^>]*pcl-search-results-column[^>]*>\s*([^<]+?)\s*<\/td>/i.exec(chunk);
    const debtor   = debtorM?.[1]?.trim() ?? '';

    cases.push({
      caseNumber,
      chapter,
      status,
      court,
      courtCode: deriveCourtCode(court + ' ' + caseNumber),
      dateFiled:  dates[0] ?? null,
      dateClosed: dates[1] ?? null,
      debtor,
      caseLink,
      isBankruptcy,
    });
  }

  return cases;
}

function deriveCourtCode(context: string): string {
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
  return '';
}

function normalizeStatus(raw: string): BankruptcyStatus {
  const s = raw.toLowerCase();
  if (/discharg/.test(s)) return 'Discharged';
  if (/dismiss/.test(s))  return 'Dismissed';
  if (/convert/.test(s))  return 'Converted';
  if (/closed|terminated/.test(s)) return 'Closed';
  if (/open|active|pend/.test(s))  return 'Active';
  return 'Unknown';
}

function actionGuidance(chapter: BankruptcyChapter, status: BankruptcyStatus): string {
  if (status === 'Active') {
    if (chapter === '7')  return 'STOP — Ch. 7 automatic stay is active. Do not call, write, or attempt to collect. File a proof of claim only if the trustee announces an asset distribution.';
    if (chapter === '11') return 'STOP collecting — Ch. 11 stay is active. File a Proof of Claim (Form 410) by the bar date.';
    if (chapter === '13') return 'STOP collecting — Ch. 13 stay is active. File a Proof of Claim by the bar date. You may receive partial payment over 3–5 years.';
    return 'STOP collecting — automatic stay is active. Consult a bankruptcy attorney before any action.';
  }
  if (status === 'Discharged') return 'Debt likely discharged. Do not attempt to collect a discharged debt. Confirm with a bankruptcy attorney whether your specific claim was listed.';
  if (status === 'Dismissed')  return 'Bankruptcy dismissed — automatic stay lifted. You may resume collection. Confirm the dismissal was not with prejudice.';
  if (status === 'Closed' || status === 'Unknown') return 'Case closed. Verify discharge vs dismissal on the docket before resuming collection.';
  return 'Review case details and consult counsel.';
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function checkPACERBankruptcy(debtorName: string): Promise<PACERResult> {
  const searchedName = debtorName.trim();
  if (!process.env.PACER_USERNAME || !process.env.PACER_PASSWORD) {
    return fail(searchedName, 'PACER_USERNAME and PACER_PASSWORD not set in environment.');
  }

  const jar = new CookieJar();

  // ── Authenticate ──────────────────────────────────────────────────────────
  const auth = await authenticate(jar);
  if (!auth.ok) return fail(searchedName, auth.error ?? 'PACER authentication failed.', auth.scraperNote);

  // ── Search PCL ────────────────────────────────────────────────────────────
  let cases: PCLCase[];
  let warn: string | undefined;
  try {
    const r = await searchParty(searchedName, jar);
    cases = r.cases;
    warn  = r.warn;
  } catch (err) {
    return fail(searchedName, `PACER search failed: ${err instanceof Error ? err.message : String(err)}`,
      'PCL form fields may have changed — re-capture from findParty.jsf in a browser.');
  }

  // Filter to bankruptcy cases (we only care about those for stay analysis).
  const bk = cases.filter(c => c.isBankruptcy);

  if (bk.length === 0) {
    if (warn) return fail(searchedName, warn, 'Add PCL search access to the PACER account at pacer.uscourts.gov → Manage My Account.');
    return {
      found: false, totalCases: 0, activeCases: 0, cases: [], searchedName,
      note: `No bankruptcy filings found for "${searchedName}" in PACER. Safe to proceed with collection — no automatic stay detected.`,
    };
  }

  const enriched: BankruptcyCase[] = bk.slice(0, 10).map(pc => {
    const chapter = (pc.chapter || 'unknown') as BankruptcyChapter;
    const status  = normalizeStatus(pc.status);
    return {
      caseNumber: pc.caseNumber,
      chapter,
      status,
      court: pc.court,
      courtCode: pc.courtCode,
      dateFiled: pc.dateFiled,
      dateClosed: pc.dateClosed,
      dateDischarge: null,
      debtor: pc.debtor || searchedName,
      trustee: null,
      hasAssets: null,
      meetingOfCreditors: null,
      proofOfClaimDeadline: null,
      automaticStayActive: status === 'Active',
      actionRequired: actionGuidance(chapter, status),
    };
  });

  const activeCases = enriched.filter(c => c.status === 'Active').length;

  let note: string;
  if (activeCases > 0) {
    note = `🚨 ACTIVE BANKRUPTCY — automatic stay in effect. DO NOT ATTEMPT COLLECTION. ${activeCases} active case(s) found. See details below for required action.`;
  } else if (enriched.some(c => c.status === 'Discharged')) {
    note = `Bankruptcy found but debt may be discharged. Verify whether your specific debt was included before any further action.`;
  } else if (enriched.some(c => c.status === 'Dismissed')) {
    note = `Prior bankruptcy found but it was dismissed — automatic stay has been lifted. You may resume collection.`;
  } else {
    note = `${bk.length} historical bankruptcy case(s) found — all appear to be closed. Verify status before proceeding.`;
  }

  return {
    found: true,
    totalCases: bk.length,
    activeCases,
    cases: enriched,
    searchedName,
    note,
  };
}

function fail(searchedName: string, error: string, scraperNote?: string): PACERResult {
  return {
    found: false, totalCases: 0, activeCases: 0, cases: [], searchedName,
    note: '', error, scraperNote,
  };
}

// Suppress unused-import warning — fetchWithRetry is intentionally exported for
// future PCL detail-fetch enrichment; kept here so the helper graph is obvious.
void fetchWithRetry;
