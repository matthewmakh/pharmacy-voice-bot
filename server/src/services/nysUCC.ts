// NYS UCC Filing Search — appext20.dos.ny.gov/pls/ucc_public/web_search_main
//
// The NYS DOS UCC portal is an Oracle APEX application protected by reCAPTCHA v2.
//
// Flow:
//   1. GET search page → collect session cookies + APEX tokens + reCAPTCHA site key
//   2. Solve reCAPTCHA via 2captcha (~20-45s)
//   3. POST search form with debtor name + CAPTCHA token
//   4. If portal rejects CAPTCHA → report incorrect, retry once
//   5. Parse HTML results table (handles pagination, multiple column layouts)
//   6. For each active filing (up to 5) → GET detail page for collateral description
//
// Requires: CAPTCHA_API_KEY in environment.
// Results help determine whether a post-judgment levy will be subordinate to
// existing secured creditors (banks, MCA lenders, equipment lenders).

import { solveRecaptchaV2WithId, reportIncorrect, CaptchaError } from './twoCaptcha';

const PORTAL_BASE  = 'https://appext20.dos.ny.gov';
// UCC portal path — try known variants in case the path changed
const SEARCH_PAGE_CANDIDATES = [
  process.env.UCC_PORTAL_URL,
  `${PORTAL_BASE}/pls/ucc_public/web_search_main`,
  `${PORTAL_BASE}/pls/ucc_public/web_uccart`,
  `${PORTAL_BASE}/ucc_public/web_search_main`,
].filter(Boolean) as string[];
const DETAIL_PAGE  = `${PORTAL_BASE}/pls/ucc_public/web_detail`;

async function resolveSearchPage(baseHeaders: Record<string, string>): Promise<string | null> {
  for (const url of SEARCH_PAGE_CANDIDATES) {
    try {
      const resp = await fetch(url, { headers: baseHeaders, signal: AbortSignal.timeout(15_000) });
      // 200 or 302 redirect both mean the portal is there
      if (resp.status < 400) return url;
    } catch { /* try next */ }
  }
  return null;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UCCFiling {
  fileNumber: string;
  fileType: string;
  filingDate: string | null;
  lapseDate: string | null;
  status: 'Active' | 'Lapsed' | 'Unknown';
  debtorName: string;
  debtorAddress: string | null;
  securedParty: string;
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
// Node's fetch doesn't merge multiple Set-Cookie headers automatically.
// We collect them all and send them back as a single Cookie: header.

class CookieJar {
  private map = new Map<string, string>();

  ingest(headers: Headers): void {
    // headers.getSetCookie() is Node 18+; fall back to iterating
    const raw: string[] = typeof (headers as any).getSetCookie === 'function'
      ? (headers as any).getSetCookie()
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

  isEmpty(): boolean { return this.map.size === 0; }
}

// ─── HTML utilities ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ')
    .trim();
}

/** Extract all hidden form inputs as a key→value map */
function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag   = m[0];
    const nameM  = /name=["']([^"']*)["']/i.exec(tag);
    const valueM = /value=["']([^"']*)["']/i.exec(tag);
    if (nameM?.[1]) out[nameM[1]] = valueM?.[1] ?? '';
  }
  return out;
}

/** Extract the <form> action URL, resolved against the page URL */
function extractFormAction(html: string, pageUrl: string): string {
  const m = /<form[^>]+action=["']([^"']+)["']/i.exec(html);
  if (!m) return pageUrl;
  const raw = m[1];
  if (raw.startsWith('http')) return raw;
  const u = new URL(pageUrl);
  return raw.startsWith('/') ? `${u.origin}${raw}` : `${u.origin}/pls/ucc_public/${raw}`;
}

/** Extract reCAPTCHA v2 site key */
function extractSiteKey(html: string): string | null {
  const patterns = [
    /data-sitekey=["']([A-Za-z0-9_\-]{30,})["']/i,
    /sitekey['":\s]+["']([A-Za-z0-9_\-]{30,})["']/i,
    /grecaptcha\.render\([^,]+,\s*\{[^}]*['"]sitekey['"]\s*:\s*['"]([^'"]+)['"]/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1];
  }
  return null;
}

/**
 * Find the APEX input field name for "debtor organization name".
 * APEX apps use generic names like p_t01..p_t09 for text inputs.
 * We try to locate the right one by context (label association, id, name).
 */
function findDebtorOrgField(html: string): string {
  // 1. Named field containing 'debtor' or 'org'
  const named = [
    /name=["']([^"']*(?:debtor|org|search)[^"']*)["'][^>]*type=["']text["']/i,
    /type=["']text["'][^>]*name=["']([^"']*(?:debtor|org|search)[^"']*)["']/i,
    /id=["']([^"']*(?:debtor|org|search)[^"']*)["'][^>]*type=["']text["']/i,
  ];
  for (const p of named) {
    const m = p.exec(html);
    if (m) return m[1];
  }

  // 2. Look for a text input near a label that mentions "organization" or "debtor"
  //    by finding the first <input type="text"> whose preceding label text matches
  const labelBlock = /(?:organization|debtor)[\s\S]{0,300}?<input[^>]+type=["']text["'][^>]*name=["']([^"']+)["']/i;
  const lm = labelBlock.exec(html);
  if (lm) return lm[1];

  // 3. Fall back to first APEX text field (p_t01)
  const apex = /name=["'](p_t0[1-9])["'][^>]*type=["']text["']|type=["']text["'][^>]*name=["'](p_t0[1-9])["']/i;
  const am = apex.exec(html);
  if (am) return am[1] ?? am[2];

  // 4. Last resort — common Oracle APEX debtor field names
  return 'P_DEBTOR_ORG_NAME';
}

/**
 * Determine if a filing is lapsed based on the lapse date string.
 * NY UCC filings lapse 5 years from filing date unless continued.
 */
function deriveStatus(lapseDate: string | null, fileType: string): 'Active' | 'Lapsed' | 'Unknown' {
  if (!lapseDate) return 'Unknown';
  try {
    const lapse = new Date(lapseDate);
    if (!isNaN(lapse.getTime())) return lapse > new Date() ? 'Active' : 'Lapsed';
  } catch { /* */ }
  // Sometimes status is embedded in the filing type text
  if (/laps|expir|terminat/i.test(fileType)) return 'Lapsed';
  return 'Unknown';
}

/**
 * Parse the UCC results HTML table.
 * Handles multiple possible column layouts (the portal has slightly different
 * views depending on search type and APEX version).
 *
 * NY UCC standard column order:
 *   File Number | Type | Filing Date | Lapse Date | Debtor Name | Debtor Addr | Secured Party | SP Addr
 *
 * Some views collapse address columns or add a "Status" column.
 */
function parseResultsTable(html: string): UCCFiling[] {
  const filings: UCCFiling[] = [];

  // Find the best table — the one most likely to contain UCC data
  // Criteria: contains "filing" or "debtor" or "secured" in its content
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let bestTable = '';
  let bestScore = 0;
  let m;

  while ((m = tableRe.exec(html)) !== null) {
    const t = m[0];
    let score = 0;
    if (/filing/i.test(t)) score++;
    if (/debtor/i.test(t)) score++;
    if (/secured/i.test(t)) score++;
    if (/<tr/i.test(t) && /<td/i.test(t)) score++;
    if (score > bestScore) { bestScore = score; bestTable = t; }
  }

  if (!bestTable || bestScore < 2) return filings;

  // Extract data rows (skip <th> header rows)
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

    // Identify file number — 10 to 19 digit string (NY UCC: 15 digits)
    const fileIdx = cells.findIndex(c => /^\d{10,19}$/.test(c.replace(/\D/g, '').slice(0, 19)));
    if (fileIdx === -1) continue;

    const fileNumber   = cells[fileIdx].replace(/\D/g, '');
    const afterFile    = cells.slice(fileIdx + 1);

    // Layout sniffing based on cell count after file number
    // 7+ cells: full layout — type, filingDate, lapseDate, debtor, debtorAddr, sp, spAddr
    // 5-6 cells: compact — type, dates combined or missing addr, debtor, sp
    // 3-4 cells: minimal

    let fileType = '', filingDate: string|null = null, lapseDate: string|null = null;
    let debtorName = '', debtorAddress: string|null = null;
    let securedParty = '', spAddress: string|null = null;

    if (afterFile.length >= 7) {
      fileType      = afterFile[0];
      filingDate    = afterFile[1] || null;
      lapseDate     = afterFile[2] || null;
      debtorName    = afterFile[3];
      debtorAddress = afterFile[4] || null;
      securedParty  = afterFile[5];
      spAddress     = afterFile[6] || null;
    } else if (afterFile.length >= 5) {
      fileType      = afterFile[0];
      filingDate    = afterFile[1] || null;
      lapseDate     = afterFile[2] || null;
      debtorName    = afterFile[3];
      securedParty  = afterFile[4];
    } else if (afterFile.length >= 3) {
      fileType      = afterFile[0];
      debtorName    = afterFile[1];
      securedParty  = afterFile[2];
    } else {
      continue;
    }

    // Skip rows that look like table headers mistakenly parsed as data
    if (/^(file|number|type|debtor|secured|date)/i.test(fileType)) continue;
    if (!fileNumber && !debtorName && !securedParty) continue;

    filings.push({
      fileNumber,
      fileType: fileType.toUpperCase().trim(),
      filingDate:    filingDate || null,
      lapseDate:     lapseDate || null,
      status:        deriveStatus(lapseDate, fileType),
      debtorName:    debtorName.trim(),
      debtorAddress: debtorAddress?.trim() || null,
      securedParty:  securedParty.trim(),
      securedPartyAddress: spAddress?.trim() || null,
      collateral: null,
    });
  }

  return filings;
}

/** Fetch collateral description from the filing detail page */
async function fetchCollateral(fileNumber: string, jar: CookieJar): Promise<string | null> {
  try {
    const resp = await fetch(`${DETAIL_PAGE}?p_file_number=${fileNumber}`, {
      headers: { ...BASE_HEADERS, Cookie: jar.toString() },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Try several patterns the collateral section might use
    const patterns = [
      /collateral[^<]{0,30}<\/[^>]+>\s*<[^>]+>([\s\S]{5,600}?)<\//i,
      /<td[^>]*>\s*collateral\s*<\/td>\s*<td[^>]*>([\s\S]{5,600}?)<\/td>/i,
      /collateral description[^<]*<[^>]+>([\s\S]{5,600}?)<\//i,
    ];
    for (const p of patterns) {
      const m = p.exec(html);
      if (m) {
        const text = stripHtml(m[1]).slice(0, 500);
        if (text.length > 5) return text;
      }
    }
  } catch { /* best-effort */ }
  return null;
}

/** Detect whether the result page is rejecting the CAPTCHA */
function isCapRejected(html: string): boolean {
  return /captcha/i.test(html) && /data-sitekey/i.test(html);
}

/** Detect "no results" pages */
function isNoResults(html: string): boolean {
  const lower = html.toLowerCase();
  return ['no records', 'no filings', 'no results', '0 record', '0 filing',
          'not found', 'no match', 'no ucc filings'].some(s => lower.includes(s));
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function lookupNYSUCC(debtorName: string): Promise<UCCResult> {
  const searchedName = debtorName.trim();

  if (!process.env.CAPTCHA_API_KEY) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: 'CAPTCHA_API_KEY not configured.',
      scraperNote: 'Add CAPTCHA_API_KEY to your .env file. Get a key at 2captcha.com.',
    };
  }

  const jar = new CookieJar();

  // ── Step 1: Resolve working portal URL + load the search page ────────────
  const SEARCH_PAGE = await resolveSearchPage(BASE_HEADERS);
  if (!SEARCH_PAGE) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: 'NYS UCC portal is unreachable at all known URLs.',
      scraperNote: `Set UCC_PORTAL_URL env var to override. Known paths tried: ${SEARCH_PAGE_CANDIDATES.join(', ')}`,
    };
  }

  let pageHtml: string;
  try {
    const pageResp = await fetch(SEARCH_PAGE, {
      headers: BASE_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    if (!pageResp.ok) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: `NYS UCC portal returned ${pageResp.status} on initial load.`,
        scraperNote: `Verify portal is up: ${SEARCH_PAGE}`,
      };
    }
    jar.ingest(pageResp.headers);
    pageHtml = await pageResp.text();
  } catch (err) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: `Could not reach NYS UCC portal: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Step 2: Extract APEX tokens, form action, reCAPTCHA site key ──────────
  const hiddenInputs   = extractHiddenInputs(pageHtml);
  const formAction     = extractFormAction(pageHtml, SEARCH_PAGE);
  const debtorField    = findDebtorOrgField(pageHtml);
  const siteKey        = extractSiteKey(pageHtml);

  // ── Step 3 + 4: Solve CAPTCHA and submit form (retry once if rejected) ────
  let resultHtml = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    // FIX: use solveRecaptchaV2WithId so we have the taskId for reportIncorrect()
    let captchaToken: string | null = null;
    let captchaTaskId: string | undefined;
    if (siteKey) {
      try {
        const solved = await solveRecaptchaV2WithId(siteKey, SEARCH_PAGE);
        captchaToken  = solved.token;
        captchaTaskId = solved.taskId;
      } catch (err) {
        if (err instanceof CaptchaError) {
          return {
            found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
            note: '',
            error: `CAPTCHA solving failed: ${err.message}`,
            scraperNote: 'Check your CAPTCHA_API_KEY balance at 2captcha.com.',
          };
        }
        throw err;
      }
    }

    // Build form body
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hiddenInputs)) form.set(k, v);

    // Set debtor org name field + common APEX aliases
    form.set(debtorField, searchedName);
    form.set('P_DEBTOR_ORG_NAME', searchedName);
    form.set('p_debtor_org_name', searchedName);
    form.set('P1_SEARCH_TYPE', 'DEBTOR_ORG');

    if (captchaToken) form.set('g-recaptcha-response', captchaToken);
    if (!form.get('p_request')) form.set('p_request', 'SEARCH');

    const searchResp = await fetch(formAction, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': SEARCH_PAGE,
        'Cookie': jar.toString(),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });

    if (!searchResp.ok) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: `Search POST returned ${searchResp.status}`,
        scraperNote: 'APEX form parameters may need updating. Inspect the portal in a browser and compare POST body field names with nysUCC.ts.',
      };
    }

    jar.ingest(searchResp.headers);
    resultHtml = await searchResp.text();

    // Check if CAPTCHA was rejected by the portal
    if (isCapRejected(resultHtml)) {
      if (attempt === 0) {
        // Report incorrect for the refund, re-solve on next loop iteration
        if (captchaTaskId) await reportIncorrect(captchaTaskId);
        console.warn('[nysUCC] CAPTCHA rejected by portal — retrying with fresh solve');
        await sleep(2_000);
        continue;
      }
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: 'CAPTCHA was rejected by the portal twice. The portal may have changed its CAPTCHA type or the site key has changed.',
        scraperNote: `Check CAPTCHA type at ${SEARCH_PAGE} in a browser.`,
      };
    }

    break; // Got a real results page
  }

  // ── Step 5: No-results check ──────────────────────────────────────────────
  if (isNoResults(resultHtml)) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: `No UCC filings found for "${searchedName}" in the NYS UCC database. No secured creditor has filed a security interest against this debtor in New York.`,
    };
  }

  // ── Step 6: Parse results ─────────────────────────────────────────────────
  const filings = parseResultsTable(resultHtml);

  // Handle pagination — NYS UCC returns 25 rows per page by default
  // Look for a "next page" link and follow it (up to 3 more pages = 100 results max)
  let nextHtml = resultHtml;
  for (let page = 1; page < 4; page++) {
    const nextMatch = /href=["']([^"']*next[^"']*|[^"']*page=\d+[^"']*)["']/i.exec(nextHtml);
    if (!nextMatch) break;
    let nextUrl = nextMatch[1];
    if (!nextUrl.startsWith('http')) nextUrl = `${PORTAL_BASE}${nextUrl.startsWith('/') ? '' : '/pls/ucc_public/'}${nextUrl}`;
    try {
      const nextResp = await fetch(nextUrl, {
        headers: { ...BASE_HEADERS, Referer: SEARCH_PAGE, Cookie: jar.toString() },
        signal: AbortSignal.timeout(20_000),
      });
      if (!nextResp.ok) break;
      jar.ingest(nextResp.headers);
      nextHtml = await nextResp.text();
      filings.push(...parseResultsTable(nextHtml));
    } catch { break; }
  }

  if (filings.length === 0 && resultHtml.includes('<table')) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: 'Results page received but no filings could be parsed.',
      scraperNote: 'The NYS UCC portal HTML structure may have changed. Check column order in nysUCC.ts → parseResultsTable.',
    };
  }

  // ── Step 7: Enrich active filings with collateral (max 5 detail pages) ────
  const activeFilings = filings.filter(f => f.status !== 'Lapsed');
  await Promise.all(
    activeFilings.slice(0, 5).map(async f => {
      f.collateral = await fetchCollateral(f.fileNumber, jar);
    })
  );

  // ── Step 8: Build human-readable note ────────────────────────────────────
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
    MCA_KEYWORDS.some(k => f.securedParty.toLowerCase().includes(k))
  );

  let note = '';
  if (filings.length === 0) {
    note = `No UCC filings found for "${searchedName}".`;
  } else if (totalActive === 0) {
    note = `${filings.length} lapsed UCC filing(s) found — all have expired. No active security interests. A judgment lien should not face subordination issues from prior UCC creditors.`;
  } else {
    note = `${totalActive} active UCC lien(s) (${totalLapsed} lapsed).`;
    if (mcaFilings.length > 0) {
      const mcaNames = [...new Set(mcaFilings.map(f => f.securedParty))].slice(0, 3).join(', ');
      note += ` MCA lender(s) detected: ${mcaNames}${mcaFilings.length > 3 ? ', …' : ''}. MCA agreements typically claim a blanket lien on all assets and receivables — your judgment lien would be subordinate to these.`;
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
