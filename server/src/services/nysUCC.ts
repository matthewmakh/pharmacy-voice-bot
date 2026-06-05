// NYS UCC Filing Search — modern portal at ucc-efiling.dos.ny.gov.
//
// The legacy Oracle APEX portal (appext20.dos.ny.gov/pls/ucc_public/) is retired.
// The new portal is a .NET MVC app run by Cenuity (with Cloudflare in front)
// and — crucially — has NO CAPTCHA. We don't need 2captcha at all.
//
// Flow (verified live):
//   1. GET /                                             — splash page, collects:
//                                                          __RequestVerificationToken (hidden input
//                                                          inside the splash search <form>)
//                                                        + __cf_bm + __RequestVerificationToken cookies
//   2. POST /OnlineUCCSearch/PublicOnlineUccSearch       — with token, returns the search form page
//   3. POST /OnlineUCCSearch/OnlineUCCSearch             — actual search; returns full HTML page
//                                                          containing a <table id="xhtml_grid"> of results
//   4. (optional) POST /OnlineUCCSearch/OnlineLienInformation
//                                                        — { lienId, source } for collateral details
//
// Result columns:
//   Lien Number | Serial Number | Lien Subtype | Debtor Name | Debtor Address
//   | Debtor Type | Filing Date | Lapse Date | Lien Status
//
// Status "Active" / "Inactive" comes straight from the portal — no date math needed.

import { fetchWithRetry } from './lib/httpClient';

const PORTAL_BASE = 'https://ucc-efiling.dos.ny.gov';
const SPLASH_URL  = `${PORTAL_BASE}/`;
const FORM_URL    = `${PORTAL_BASE}/OnlineUCCSearch/PublicOnlineUccSearch`;
const SEARCH_URL  = `${PORTAL_BASE}/OnlineUCCSearch/OnlineUCCSearch`;
const DETAIL_URL  = `${PORTAL_BASE}/OnlineUCCSearch/OnlineLienInformation`;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UCCFiling {
  fileNumber: string;          // lien / file number (e.g. "201802288087342")
  fileType: string;            // lien subtype (often blank for initial filings)
  filingDate: string | null;
  lapseDate: string | null;
  status: 'Active' | 'Lapsed' | 'Unknown';
  debtorName: string;
  debtorAddress: string | null;
  securedParty: string;        // only populated if we fetch the detail page
  securedPartyAddress: string | null;
  collateral: string | null;
}

export interface UCCResult {
  found: boolean;
  totalFilings: number;
  activeFilings: number;
  filings: UCCFiling[];
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

  toString(): string {
    return Array.from(this.map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ')
    .trim();
}

function extractVerificationToken(html: string, formIdHint?: string): string | null {
  // Splash page wraps the token inside the search <form>; just grab the first __RequestVerificationToken value.
  const re = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i;
  const m = re.exec(html);
  if (formIdHint && !html.includes(formIdHint)) {
    // form not present → token irrelevant
  }
  return m?.[1] ?? null;
}

// ─── Results parser ───────────────────────────────────────────────────────────

/**
 * Parse the results table.
 * The grid is `<table id="xhtml_grid">` with these columns (per live capture):
 *   0: Lien Number (contains <a onclick=NavigateLienInfo(<id>)> + hidden hdnIFS)
 *   1: Serial Number
 *   2: Lien Subtype
 *   3: Debtor Name
 *   4: Debtor Address
 *   5: Debtor Type
 *   6: Filing Date/Time
 *   7: Lapse Date/Time
 *   8: Lien Status   ("Active" / "Inactive" / ...)
 */
function parseResultsTable(html: string): UCCFiling[] {
  const filings: UCCFiling[] = [];

  const tableMatch = /<table[^>]*id=['"]xhtml_grid['"][^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) return filings;
  const tableBody = tableMatch[1];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(tableBody)) !== null) {
    const row = rowM[1];
    if (!row.includes('<td')) continue;          // skip header row

    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(row)) !== null) cells.push(cm[1]);

    if (cells.length < 9) continue;

    const fileNumber = stripHtml(cells[0]);
    // Skip rows where the file number cell didn't yield digits — likely a stray header
    if (!/\d{8,}/.test(fileNumber)) continue;

    const rawStatus  = stripHtml(cells[8]).toLowerCase();
    const status: UCCFiling['status'] =
      rawStatus.startsWith('active')   ? 'Active'  :
      rawStatus.startsWith('inactive') || rawStatus.startsWith('laps') ? 'Lapsed' :
      'Unknown';

    filings.push({
      fileNumber,
      fileType:      stripHtml(cells[2]),
      filingDate:    stripHtml(cells[6]) || null,
      lapseDate:     stripHtml(cells[7]) || null,
      status,
      debtorName:    stripHtml(cells[3]),
      debtorAddress: stripHtml(cells[4]) || null,
      securedParty:  '',
      securedPartyAddress: null,
      collateral:    null,
    });
  }
  return filings;
}

// ─── Detail fetch (best-effort: secured party + collateral) ───────────────────

async function fetchDetail(filing: UCCFiling, html: string, jar: CookieJar): Promise<void> {
  // Find the row's lien id from the onclick handler: NavigateLienInfo(<id>)
  // and the hidden hdnIFS value (source) — both required by the detail endpoint.
  const idRe   = new RegExp(`NavigateLienInfo\\((\\d+)\\)[^<]*${filing.fileNumber.slice(0, 8)}`);
  // Fallback: just take the next NavigateLienInfo near the filing number
  const idM    = idRe.exec(html) ?? new RegExp(`${filing.fileNumber}[\\s\\S]{0,500}?NavigateLienInfo\\((\\d+)\\)`).exec(html);
  const lienId = idM?.[1];
  if (!lienId) return;

  const sourceM = new RegExp(`NavigateLienInfo\\(${lienId}\\)[\\s\\S]{0,200}?hdnIFS['"]\\s+value=(\\d+)`).exec(html);
  const source  = sourceM?.[1] ?? lienId;

  try {
    const form = new URLSearchParams({ lienId, source });
    const resp = await fetchWithRetry(DETAIL_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': SEARCH_URL,
        'Cookie': jar.toString(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form.toString(),
      timeoutMs: 15_000,
    }, 2);
    if (!resp.ok) return;
    jar.ingest(resp.headers);
    const dHtml = await resp.text();

    // Secured-party block — heuristic; the portal renders it with labels.
    const spM = /Secured\s*Party[\s\S]{0,80}?(?:<td[^>]*>|<span[^>]*>|<div[^>]*>)([\s\S]{2,200}?)<\//i.exec(dHtml);
    if (spM) filing.securedParty = stripHtml(spM[1]);

    const spAddrM = /Secured\s*Party[\s\S]{0,400}?Address[\s\S]{0,80}?(?:<td[^>]*>|<span[^>]*>|<div[^>]*>)([\s\S]{2,300}?)<\//i.exec(dHtml);
    if (spAddrM) filing.securedPartyAddress = stripHtml(spAddrM[1]);

    const colM = /Collateral[\s\S]{0,80}?(?:<td[^>]*>|<span[^>]*>|<div[^>]*>)([\s\S]{2,800}?)<\//i.exec(dHtml);
    if (colM) filing.collateral = stripHtml(colM[1]).slice(0, 500);
  } catch {
    // best-effort
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function lookupNYSUCC(debtorName: string): Promise<UCCResult> {
  const searchedName = debtorName.trim();
  if (searchedName.length < 3) {
    return fail(searchedName, 'Debtor name must be at least 3 characters for UCC search.');
  }

  const jar = new CookieJar();

  // ── Step 1: splash page → token + session cookies ────────────────────────
  let token: string | null;
  try {
    const r = await fetchWithRetry(SPLASH_URL, { headers: BASE_HEADERS, timeoutMs: 15_000 }, 3);
    if (!r.ok) return fail(searchedName, `UCC portal splash returned ${r.status}`, splashHint(r.status));
    jar.ingest(r.headers);
    token = extractVerificationToken(await r.text(), 'searchForm');
    if (!token) return fail(searchedName, 'Anti-forgery token not found on splash page.',
      'The Cenuity portal HTML may have changed — re-capture the token field name from the splash page.');
  } catch (err) {
    return fail(searchedName, `Could not reach UCC portal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 2: POST to PublicOnlineUccSearch → search form HTML ─────────────
  try {
    const r = await fetchWithRetry(FORM_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': SPLASH_URL,
        'Origin': PORTAL_BASE,
        'Cookie': jar.toString(),
      },
      body: new URLSearchParams({ __RequestVerificationToken: token }).toString(),
      timeoutMs: 20_000,
    }, 2);
    if (!r.ok) return fail(searchedName, `UCC search form returned ${r.status}`);
    jar.ingest(r.headers);
    // Body discarded — we just need the cookies set during this leg.
    await r.text();
  } catch (err) {
    return fail(searchedName, `UCC form load failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 3: POST the actual search ───────────────────────────────────────
  let resultsHtml = '';
  try {
    const form = new URLSearchParams({
      rdbType: 'DebtorName',
      rdbDebtorType: 'Organization',
      searchType: 'DebtorName',
      UCCSearch_UCCSearch_txtFilingNo: '',
      UCCSearch_UCCSerach_txtFirstName: '',
      UCCSearch_UCCSerach_txtMiddleName: '',
      UCCSearch_UCCSerach_txtLastName: '',
      UCCSearch_UCCSerach_txtOrgName: searchedName,
      UCCSearch_UCCSerach_selectOrgType: '',
      UCCSearch_UCCSerach_txtOrgID: '',
      UCCSearch_UCCSerach_txtOrgJur: '',
      UCCSearch_UCCSerach_txtFilingDateFrom: '',
      UCCSearch_UCCSerach_txtFilingDateTo: '',
      UCCSearch_UCCSerach_txtLapseDateFrom: '',
      UCCSearch_UCCSerach_txtLapseDateTo: '',
      ddlLienStatus: '',
      hdnSuffixDesc: '',
    });

    const r = await fetchWithRetry(SEARCH_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': FORM_URL,
        'Origin': PORTAL_BASE,
        'Cookie': jar.toString(),
      },
      body: form.toString(),
      timeoutMs: 30_000,
    }, 2);
    if (!r.ok) return fail(searchedName, `UCC search POST returned ${r.status}`);
    jar.ingest(r.headers);
    resultsHtml = await r.text();
  } catch (err) {
    return fail(searchedName, `UCC search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 4: parse ────────────────────────────────────────────────────────
  const filings = parseResultsTable(resultsHtml);

  if (filings.length === 0) {
    // Distinguish "0 results" from "table missing entirely"
    if (resultsHtml.includes('xhtml_grid')) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: `No UCC filings found for "${searchedName}" in the NYS UCC database. No secured creditor has filed a security interest against this debtor in New York.`,
      };
    }
    return fail(searchedName, 'UCC results table was not in the response.',
      'The Cenuity portal HTML structure may have changed — re-check parseResultsTable in nysUCC.ts.');
  }

  // ── Step 5: best-effort enrich up to 5 active filings with secured party + collateral
  const active = filings.filter(f => f.status === 'Active');
  await Promise.all(active.slice(0, 5).map(f => fetchDetail(f, resultsHtml, jar)));

  // ── Step 6: build note ───────────────────────────────────────────────────
  const totalActive = filings.filter(f => f.status === 'Active').length;
  const totalLapsed = filings.filter(f => f.status === 'Lapsed').length;

  const MCA_KEYWORDS = [
    'ondeck', 'kabbage', 'bluevine', 'fundbox', 'credibly', 'greenbox',
    'yellowstone', 'fora financial', 'pearl capital', 'can capital',
    'reliant', 'forward financing', 'merchant', 'rapid finance',
    'national funding', 'everest business', 'fox capital', 'libertas',
    'newtek', 'capify', 'swift capital',
  ];
  const mcaFilings = filings.filter(f =>
    f.securedParty && MCA_KEYWORDS.some(k => f.securedParty.toLowerCase().includes(k))
  );

  let note = '';
  if (totalActive === 0) {
    note = `${filings.length} lapsed UCC filing(s) found — all have expired. No active security interests. A judgment lien should not face subordination issues from prior UCC creditors.`;
  } else {
    note = `${totalActive} active UCC lien(s) (${totalLapsed} lapsed).`;
    if (mcaFilings.length > 0) {
      const names = [...new Set(mcaFilings.map(f => f.securedParty))].slice(0, 3).join(', ');
      note += ` MCA lender(s) detected: ${names}${mcaFilings.length > 3 ? ', …' : ''}. MCA agreements typically claim a blanket lien on all assets and receivables — your judgment lien would be subordinate to these.`;
    } else {
      note += ` These secured creditors hold a prior claim on debtor collateral. Review what each lien covers before attempting a levy.`;
    }
  }

  return {
    found: filings.length > 0,
    totalFilings: filings.length,
    activeFilings: totalActive,
    filings,
    searchedName,
    note,
  };
}

function splashHint(status: number): string | undefined {
  if (status === 403) return 'ucc-efiling.dos.ny.gov is fronted by Cloudflare and may block datacenter IPs — set PROXY_URL to a residential proxy.';
  return undefined;
}

function fail(searchedName: string, error: string, scraperNote?: string): UCCResult {
  return {
    found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
    note: '', error, scraperNote,
  };
}
