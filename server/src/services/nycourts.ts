// NYC Civil Court case history lookup via WebCivil (iapps.courts.state.ny.us)
// Searches the NY eCourts CCCS (Civil Court Case Search) by party name.
//
// Fix log:
//   - Row regex bug fixed: was `/odd|even/` (wrong alternation precedence),
//     now correctly `/(?:odd|even)/`
//   - Upgraded to CookieJar (same class as nysUCC.ts) for proper multi-cookie handling
//   - Extracts and forwards any CSRF/APEX tokens from the initial page load
//   - Removed `html.includes('login')` false positive — now checks for more specific
//     indicators that the page is an error/redirect
//   - Defendant/plaintiff matching now uses full normalized name comparison,
//     not fragile 6-char substring
//   - Runs a second search as plaintiff so we don't miss cases where debtor is suing

export interface CourtCaseRecord {
  caseIndex: string;
  filedDate: string | null;
  plaintiff: string;
  defendant: string;
  caseType: string;
  status: string;
  court: string;
  amount: string | null;
}

export interface CourtHistoryResult {
  found: boolean;
  totalCases: number;
  asDefendant: number;
  asPlaintiff: number;
  cases: CourtCaseRecord[];
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}

const MAIN_URL   = 'https://iapps.courts.state.ny.us/webcivil/FCASMain';
const SEARCH_URL = 'https://iapps.courts.state.ny.us/webcivil/FCASSearch';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Cookie jar (same pattern as nysUCC.ts) ───────────────────────────────────

class CookieJar {
  private map = new Map<string, string>();

  ingest(headers: Headers): void {
    const raw: string[] = typeof (headers as unknown as Record<string, unknown>).getSetCookie === 'function'
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
    .replace(/\s+/g, ' ').trim();
}

/** Extract hidden input values — used to forward any CSRF tokens */
function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag    = m[0];
    const nameM  = /name=["']([^"']*)["']/i.exec(tag);
    const valueM = /value=["']([^"']*)["']/i.exec(tag);
    if (nameM?.[1]) out[nameM[1]] = valueM?.[1] ?? '';
  }
  return out;
}

// ─── Table parser ─────────────────────────────────────────────────────────────

function parseCourtTable(html: string): CourtCaseRecord[] {
  const cases: CourtCaseRecord[] = [];

  // FIX: was `odd|even` (alternation between "odd" and "even[^"]*...") — wrong.
  // Correct: `(?:odd|even)` matches either word as a group.
  const rowPattern = /<tr[^>]*class="[^"]*(?:odd|even)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }

    // WebCivil FCAS table columns (verified structure):
    // 0: Index Number | 1: Filed Date | 2: Plaintiff | 3: Defendant
    // 4: Case Type | 5: Status | 6: Court | 7: Amount (optional)
    if (cells.length >= 5) {
      cases.push({
        caseIndex:  cells[0] ?? '',
        filedDate:  cells[1] || null,
        plaintiff:  cells[2] ?? '',
        defendant:  cells[3] ?? '',
        caseType:   cells[4] ?? '',
        status:     cells[5] ?? '',
        court:      cells[6] ?? '',
        amount:     cells[7] || null,
      });
    }
  }

  // Fallback: if the odd/even class pattern yielded nothing, try any <tr> with <td>
  if (cases.length === 0) {
    const fallbackRow = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let fr;
    while ((fr = fallbackRow.exec(html)) !== null) {
      const rowHtml = fr[1];
      if (!rowHtml.includes('<td')) continue;
      const cells: string[] = [];
      const cp = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cp.exec(rowHtml)) !== null) cells.push(stripHtml(cm[1]));
      if (cells.length >= 5 && cells[0] && /\d/.test(cells[0])) {
        cases.push({
          caseIndex: cells[0] ?? '',
          filedDate: cells[1] || null,
          plaintiff: cells[2] ?? '',
          defendant: cells[3] ?? '',
          caseType:  cells[4] ?? '',
          status:    cells[5] ?? '',
          court:     cells[6] ?? '',
          amount:    cells[7] || null,
        });
      }
    }
  }

  return cases;
}

/** Normalize a party name for comparison — uppercase, strip punctuation/extra spaces */
function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Check if a party string contains the searched name.
 * Uses normalized full-string containment, not fragile substring slicing.
 */
function nameMatches(partyCell: string, searchedName: string): boolean {
  const normalParty    = normalizeName(partyCell);
  const normalSearched = normalizeName(searchedName);
  // Match if the searched name appears as a whole-word sequence in the party cell
  return normalParty.includes(normalSearched) ||
    normalSearched.split(' ').every(w => w.length > 2 && normalParty.includes(w));
}

// ─── Single search (by param_type D or P) ─────────────────────────────────────

async function runSearch(
  partyName: string,
  paramType: 'D' | 'P',
  jar: CookieJar,
  hiddenInputs: Record<string, string>,
): Promise<{ html: string; status: number }> {
  const formParams = new URLSearchParams({
    ...hiddenInputs,        // forward any CSRF / session tokens from the main page
    court_type:    'NYC',
    param_type:    paramType,
    param_name:    partyName,
    param_firstName: '',
    submit:        'Find',
  });

  const resp = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': MAIN_URL,
      'Cookie': jar.toString(),
    },
    body: formParams.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  jar.ingest(resp.headers);
  return { html: await resp.text(), status: resp.status };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function lookupNYCourtHistory(partyName: string): Promise<CourtHistoryResult> {
  const searchedName = partyName.trim().toUpperCase();
  const jar = new CookieJar();

  // ── Step 1: Load main page — establish session + collect any tokens ────────
  let hiddenInputs: Record<string, string> = {};
  try {
    const initResp = await fetch(MAIN_URL, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    jar.ingest(initResp.headers);
    const initHtml = await initResp.text();
    hiddenInputs = extractHiddenInputs(initHtml);
  } catch (err) {
    return error(searchedName, `Could not reach NYC courts portal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 2: Search as defendant ────────────────────────────────────────────
  let defendantCases: CourtCaseRecord[] = [];
  let plaintiffCases: CourtCaseRecord[] = [];

  try {
    const { html, status } = await runSearch(searchedName, 'D', jar, hiddenInputs);
    if (status !== 200) {
      return error(searchedName, `Court defendant search returned HTTP ${status}`, 'Verify POST parameters match the actual court form via browser dev tools at iapps.courts.state.ny.us/webcivil/FCASMain.');
    }
    if (isUnexpectedResponse(html)) {
      return error(searchedName, 'Court search returned an unexpected response (session error or form changed).', 'Check POST parameters against the live iApps interface. The form field names may have changed.');
    }
    if (!isNoResults(html)) {
      defendantCases = parseCourtTable(html);
    }
  } catch (err) {
    return error(searchedName, `Court defendant search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 3: Search as plaintiff (debtor may also be suing others) ──────────
  try {
    const { html, status } = await runSearch(searchedName, 'P', jar, hiddenInputs);
    if (status === 200 && !isUnexpectedResponse(html) && !isNoResults(html)) {
      plaintiffCases = parseCourtTable(html);
    }
  } catch {
    // Best-effort — don't fail the whole lookup if plaintiff search errors
  }

  // ── Step 4: Merge, deduplicate by case index ───────────────────────────────
  const seen = new Set<string>();
  const allCases: CourtCaseRecord[] = [];
  for (const c of [...defendantCases, ...plaintiffCases]) {
    const key = c.caseIndex || `${c.plaintiff}|${c.defendant}|${c.filedDate}`;
    if (!seen.has(key)) { seen.add(key); allCases.push(c); }
  }

  // ── Step 5: Count roles using full-name matching (not 6-char substring) ────
  const asDefendant = allCases.filter(c => nameMatches(c.defendant, searchedName)).length;
  const asPlaintiff = allCases.filter(c => nameMatches(c.plaintiff, searchedName)).length;

  // ── Step 6: Build note ────────────────────────────────────────────────────
  let note = '';
  if (allCases.length === 0) {
    note = 'No NYC Civil Court cases found for this name. This covers NYC Civil Court only — not Supreme Court, federal court, or out-of-state cases.';
  } else if (asDefendant > 3) {
    note = `${allCases.length} NYC Civil Court case(s) found. Debtor has been sued ${asDefendant} time(s) as a defendant — pattern of non-payment or disputes. Consider QUICK_ESCALATION.`;
  } else if (asDefendant > 0) {
    note = `${allCases.length} NYC Civil Court case(s) found (${asDefendant} as defendant, ${asPlaintiff} as plaintiff). Prior judgments may indicate ability to collect; defaults suggest possible insolvency.`;
  } else if (asPlaintiff > 0) {
    note = `${allCases.length} case(s) found — debtor appears primarily as a plaintiff (${asPlaintiff} case(s)). No clear defendant history. Verify roles manually at iApps.`;
  } else {
    note = `${allCases.length} case(s) found but name matching was uncertain — verify manually at iapps.courts.state.ny.us/webcivil/FCASMain.`;
  }

  return {
    found: allCases.length > 0,
    totalCases: allCases.length,
    asDefendant,
    asPlaintiff,
    cases: allCases,
    searchedName,
    note,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNoResults(html: string): boolean {
  const lower = html.toLowerCase();
  return ['no cases found', 'no records found', '0 cases', 'no results'].some(s => lower.includes(s));
}

function isUnexpectedResponse(html: string): boolean {
  // FIX: old `html.includes('login')` was a false positive for pages with nav "Login" links.
  // Now we check for more specific indicators of a session/error page.
  const lower = html.toLowerCase();
  const isErrorPage = lower.includes('session expired') ||
    lower.includes('please log in') ||
    lower.includes('access denied') ||
    (lower.includes('error') && !lower.includes('<table') && html.length < 2000);
  const hasNoTable = !html.includes('<table');
  const isTooShort = html.length < 300;
  return isErrorPage || (hasNoTable && isTooShort);
}

function error(searchedName: string, msg: string, scraperNote?: string): CourtHistoryResult {
  return {
    found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
    cases: [], searchedName,
    note: '',
    error: msg,
    scraperNote,
  };
}
