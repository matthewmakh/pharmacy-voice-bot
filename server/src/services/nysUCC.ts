// NYS UCC Filing Search — appext20.dos.ny.gov
//
// The NYS DOS UCC public search portal is an Oracle APEX application protected
// by reCAPTCHA v2. This scraper:
//   1. GETs the search page and extracts APEX session tokens + reCAPTCHA site key
//   2. Solves reCAPTCHA via 2captcha (CAPTCHA_API_KEY env var required)
//   3. POSTs the search form with the debtor name and solved CAPTCHA token
//   4. Parses the HTML results table
//   5. For each filing found, optionally fetches the detail page for collateral info
//
// Results show: file number, type, dates, secured party, debtor, status (active/lapsed).
// Critical for: knowing if a post-judgment levy will be subordinate to existing liens.
//
// Requires: CAPTCHA_API_KEY in environment.

import { solveRecaptchaV2 } from './twoCaptcha';

const SEARCH_PAGE  = 'https://appext20.dos.ny.gov/pls/ucc_public/web_search_main';
const DETAIL_BASE  = 'https://appext20.dos.ny.gov/pls/ucc_public/web_detail';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UCCFiling {
  fileNumber: string;
  fileType: string;           // "ORIGINAL FINANCING STATEMENT", "AMENDMENT", etc.
  filingDate: string | null;
  lapseDate: string | null;
  status: 'Active' | 'Lapsed' | 'Unknown';
  debtorName: string;
  debtorAddress: string | null;
  securedParty: string;
  securedPartyAddress: string | null;
  collateral: string | null;  // from detail page when available
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

// ─── HTML helpers ─────────────────────────────────────────────────────────────

/** Extract the value of a hidden input by name */
function extractHiddenInput(html: string, name: string): string | null {
  // Match both single and double quotes, case-insensitive name
  const re = new RegExp(
    `<input[^>]+name=["']${name}["'][^>]*value=["']([^"']*)["']|` +
    `<input[^>]+value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i'
  );
  const m = re.exec(html);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** Extract ALL hidden inputs as a key-value map */
function extractAllHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const nameM  = /name=["']([^"']*)["']/i.exec(tag);
    const valueM = /value=["']([^"']*)["']/i.exec(tag);
    if (nameM) {
      result[nameM[1]] = valueM ? valueM[1] : '';
    }
  }
  return result;
}

/** Extract reCAPTCHA v2 site key from page HTML */
function extractSiteKey(html: string): string | null {
  // data-sitekey="..."  or  grecaptcha.render('id', { sitekey: '...' })
  const patterns = [
    /data-sitekey=["']([^"']{30,})["']/i,
    /sitekey['":\s]+["']([A-Za-z0-9_\-]{30,})["']/i,
    /grecaptcha\.render\([^)]+['"](6L[A-Za-z0-9_\-]{30,})["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1];
  }
  return null;
}

/** Extract the form action URL */
function extractFormAction(html: string, baseUrl: string): string {
  const m = /<form[^>]+action=["']([^"']*)["']/i.exec(html);
  if (!m) return baseUrl;
  const action = m[1];
  if (action.startsWith('http')) return action;
  const u = new URL(baseUrl);
  return action.startsWith('/') ? `${u.origin}${action}` : `${u.origin}/${action}`;
}

/** Find the debtor name field in the APEX form.
 *  APEX uses p_t01..p_t09 for text inputs. We look for:
 *  - An input with name/id containing 'debtor' or 'org'
 *  - Or fall back to the first visible text input (p_t01)
 */
function findDebtorOrgField(html: string): string | null {
  // Try named fields first
  const patterns = [
    /name=["']([^"']*debtor[^"']*)["'][^>]*type=["']text["']/i,
    /type=["']text["'][^>]*name=["']([^"']*debtor[^"']*)["']/i,
    /name=["']([^"']*org[^"']*)["'][^>]*type=["']text["']/i,
    /type=["']text["'][^>]*name=["']([^"']*org[^"']*)["']/i,
    /name=["']([^"']*name[^"']*)["'][^>]*type=["']text["']/i,
    /type=["']text["'][^>]*name=["']([^"']*name[^"']*)["']/i,
    // APEX generic text inputs
    /name=["'](p_t0[1-9])["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m) return m[1];
  }
  return null;
}

/** Strip HTML tags and decode entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse UCC results table from HTML */
function parseResultsTable(html: string): UCCFiling[] {
  const filings: UCCFiling[] = [];

  // Find the results table — it typically has class "tablesorter" or similar
  // Try multiple table patterns
  const tablePatterns = [
    /<table[^>]*class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*class=["'][^"']*ucc[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*id=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*>([\s\S]*?)<\/table>/i,  // last resort: first table
  ];

  let tableHtml = '';
  for (const p of tablePatterns) {
    const m = p.exec(html);
    if (m && m[1].includes('<tr') && m[1].includes('<td')) {
      tableHtml = m[1];
      break;
    }
  }

  if (!tableHtml) return filings;

  // Parse each data row (skip header)
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowIndex = 0;

  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    if (!rowHtml.includes('<td')) continue;  // skip header rows

    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }

    if (cells.length < 4) { rowIndex++; continue; }

    // NY UCC table column order (approximate — may vary by site version):
    // 0: File Number | 1: Type | 2: Filing Date | 3: Lapse Date |
    // 4: Debtor Name | 5: Debtor Address | 6: Secured Party | 7: SP Address
    //
    // Some views show fewer columns (file number + type + dates + parties).
    // We're flexible here.

    const fileNumber = cells[0] ?? '';
    // Basic sanity check: NY file numbers are 15 digits
    if (fileNumber && !/^\d{10,15}$/.test(fileNumber.replace(/\D/g, ''))) {
      rowIndex++;
      continue;
    }

    const fileType    = cells[1] ?? '';
    const filingDate  = cells[2] || null;
    const lapseDate   = cells[3] || null;

    // Determine if active based on lapse date
    let status: 'Active' | 'Lapsed' | 'Unknown' = 'Unknown';
    if (lapseDate) {
      try {
        const lapse = new Date(lapseDate);
        status = lapse > new Date() ? 'Active' : 'Lapsed';
      } catch { /* ignore */ }
    }

    // Remaining cells vary — try to extract debtor/secured party
    const debtorName    = cells[4] ?? '';
    const debtorAddress = cells[5] || null;
    const securedParty  = cells[6] ?? '';
    const spAddress     = cells[7] || null;

    if (!fileNumber && !debtorName && !securedParty) { rowIndex++; continue; }

    filings.push({
      fileNumber: fileNumber.replace(/\D/g, ''),
      fileType: fileType.toUpperCase(),
      filingDate,
      lapseDate,
      status,
      debtorName,
      debtorAddress,
      securedParty,
      securedPartyAddress: spAddress,
      collateral: null,
    });

    rowIndex++;
  }

  return filings;
}

/** Fetch collateral description from the UCC filing detail page */
async function fetchCollateral(fileNumber: string, cookies: string): Promise<string | null> {
  try {
    const resp = await fetch(`${DETAIL_BASE}?p_file_number=${fileNumber}`, {
      headers: { ...BROWSER_HEADERS, Cookie: cookies },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Look for collateral description in common patterns
    const patterns = [
      /collateral[^:]*:\s*<\/td>[^<]*<td[^>]*>([\s\S]*?)<\/td>/i,
      /collateral description[^<]*<\/[^>]+>([\s\S]*?)<\/td>/i,
      /<td[^>]*>collateral<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
    ];
    for (const p of patterns) {
      const m = p.exec(html);
      if (m) {
        const text = stripHtml(m[1]);
        if (text && text.length > 3) return text.slice(0, 500);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function lookupNYSUCC(debtorName: string): Promise<UCCResult> {
  const searchedName = debtorName.trim();

  if (!process.env.CAPTCHA_API_KEY) {
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: 'CAPTCHA_API_KEY not configured — cannot query the NYS UCC portal.',
      scraperNote: 'Add CAPTCHA_API_KEY to your .env file. Get a key at 2captcha.com.',
    };
  }

  try {
    // ── Step 1: Load the search page to get APEX session tokens + captcha key ──
    const pageResp = await fetch(SEARCH_PAGE, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });

    if (!pageResp.ok) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: `NYS UCC search page returned ${pageResp.status}`,
        scraperNote: `Verify portal is up at ${SEARCH_PAGE}`,
      };
    }

    const pageHtml = await pageResp.text();
    const cookies  = pageResp.headers.get('set-cookie') ?? '';

    // ── Step 2: Extract APEX tokens and reCAPTCHA site key ───────────────────
    const hiddenInputs = extractAllHiddenInputs(pageHtml);
    const formAction   = extractFormAction(pageHtml, SEARCH_PAGE);
    const debtorField  = findDebtorOrgField(pageHtml);
    const siteKey      = extractSiteKey(pageHtml);

    if (!siteKey) {
      // No reCAPTCHA found — try submitting directly (portal may have changed)
      console.warn('[nysUCC] No reCAPTCHA site key found — attempting direct submit');
    }

    // ── Step 3: Solve reCAPTCHA (if present) ─────────────────────────────────
    let captchaToken: string | null = null;
    if (siteKey) {
      captchaToken = await solveRecaptchaV2(siteKey, SEARCH_PAGE);
    }

    // ── Step 4: Build and POST the search form ────────────────────────────────
    const formData = new URLSearchParams();

    // Include all APEX hidden fields
    for (const [k, v] of Object.entries(hiddenInputs)) {
      formData.set(k, v);
    }

    // Set debtor org name — use detected field name or fallback to common APEX names
    const nameField = debtorField ?? 'P_DEBTOR_ORG_NAME';
    formData.set(nameField, searchedName);

    // Also try alternate field names in case the primary isn't right
    formData.set('p_debtor_org_name', searchedName);
    formData.set('P1_SEARCH_TYPE', 'DEBTOR_ORG');
    formData.set('p_search_type', 'DEBTOR_ORG');

    if (captchaToken) {
      formData.set('g-recaptcha-response', captchaToken);
    }

    // APEX submission requires p_request to trigger the search action
    if (!formData.get('p_request')) {
      formData.set('p_request', 'SEARCH');
    }

    const searchResp = await fetch(formAction, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': SEARCH_PAGE,
        'Cookie': cookies,
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(30_000),
    });

    if (!searchResp.ok) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: `Search POST returned ${searchResp.status}`,
        scraperNote: 'The APEX form parameters may need updating. Check the portal in a browser and update field names.',
      };
    }

    const resultHtml = await searchResp.text();
    const resultCookies = `${cookies}; ${searchResp.headers.get('set-cookie') ?? ''}`.trim();

    // ── Step 5: Detect no-results page ───────────────────────────────────────
    const noResults = [
      'no records', 'no filings', 'no results', '0 record', '0 filing',
      'not found', 'no match',
    ].some(s => resultHtml.toLowerCase().includes(s));

    if (noResults) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: `No UCC filings found for "${searchedName}" in the NYS UCC database. This means no creditor has filed a security interest in this debtor's personal property in New York.`,
      };
    }

    // Detect CAPTCHA failure / unexpected response
    if (resultHtml.includes('recaptcha') && resultHtml.includes('data-sitekey')) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: 'CAPTCHA was not accepted by the portal. This may indicate an invalid 2captcha key or the portal changed its CAPTCHA type.',
        scraperNote: 'Check your CAPTCHA_API_KEY balance and try again.',
      };
    }

    // ── Step 6: Parse results ─────────────────────────────────────────────────
    const filings = parseResultsTable(resultHtml);

    if (filings.length === 0 && resultHtml.includes('<table')) {
      return {
        found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
        note: '',
        error: 'Results page received but no filings could be parsed from the table.',
        scraperNote: 'The NYS UCC portal HTML structure may have changed. The table column order may need updating in nysUCC.ts.',
      };
    }

    // ── Step 7: Fetch collateral for active filings (max 5 detail requests) ──
    const activeFilings = filings.filter(f => f.status !== 'Lapsed');
    const toEnrich = activeFilings.slice(0, 5);
    await Promise.all(
      toEnrich.map(async f => {
        f.collateral = await fetchCollateral(f.fileNumber, resultCookies);
      })
    );

    // ── Step 8: Build note ────────────────────────────────────────────────────
    const totalActive = filings.filter(f => f.status === 'Active').length;
    const totalLapsed = filings.filter(f => f.status === 'Lapsed').length;

    // Identify if any MCA lenders are present (common ones)
    const mcaKeywords = ['ondeck', 'kabbage', 'bluevine', 'fundbox', 'credibly', 'greenbox',
      'yellowstone', 'fora financial', 'pearl capital', 'can capital', 'reliant', 'forward financing',
      'merchant', 'rapid', 'national funding', 'everest business'];
    const mcaFilings = filings.filter(f =>
      mcaKeywords.some(k => f.securedParty.toLowerCase().includes(k))
    );

    let note = '';
    if (filings.length === 0) {
      note = `No UCC filings found for "${searchedName}".`;
    } else if (totalActive === 0) {
      note = `${filings.length} lapsed UCC filing(s) found — all have expired. No active security interests on record. A judgment lien should not face subordination issues from prior UCC creditors.`;
    } else {
      note = `${totalActive} active UCC filing(s) found (${totalLapsed} lapsed).`;
      if (mcaFilings.length > 0) {
        note += ` ${mcaFilings.length} MCA lender(s) detected (${mcaFilings.map(f => f.securedParty).slice(0, 2).join(', ')}${mcaFilings.length > 2 ? ', …' : ''}). MCA agreements typically claim a blanket lien on all business assets — a judgment lien would be subordinate to these.`;
      } else {
        note += ` These secured creditors have a prior claim on the debtor's collateral. A post-judgment lien is subordinate to existing UCC filings. Review the collateral descriptions to determine which assets are encumbered.`;
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

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName,
      note: '',
      error: `UCC lookup failed: ${msg}`,
      scraperNote: `Search manually at ${SEARCH_PAGE}`,
    };
  }
}
