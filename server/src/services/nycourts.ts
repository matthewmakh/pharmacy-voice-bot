// NYC Civil Court case history lookup — WebCivil (iapps.courts.state.ny.us)
//
// IMPORTANT: iapps.courts.state.ny.us is fronted by Cloudflare with a managed
// browser challenge. Plain HTTP clients (curl/node fetch) are blocked with 403
// even from a residential IP unless the request matches a real browser TLS
// fingerprint AND the challenge is solved. There is no honest way to bypass
// this from raw fetch in production — set PROXY_URL to a residential proxy
// that has been used to solve the challenge interactively, or use a managed
// PDFs-on-demand court-records vendor (UniCourt, CourtListener RECAP, etc.).
//
// The scraper still TRIES: it sends Chrome-style headers and forwards any
// cookies/hidden tokens it sees. On a 403 we return a structured error so the
// UI can surface a helpful message instead of failing silently.

import { proxyFetch } from './lib/httpClient';

const MAIN_URL   = 'https://iapps.courts.state.ny.us/webcivil/FCASMain';
const SEARCH_URL = 'https://iapps.courts.state.ny.us/webcivil/FCASSearch';

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not_A Brand";v="8"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

// ─── Types (preserved from previous version) ─────────────────────────────────

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
    .replace(/\s+/g, ' ').trim();
}

function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM  = /name=["']([^"']+)["']/i.exec(tag);
    const valueM = /value=["']([^"']*)["']/i.exec(tag);
    if (nameM?.[1]) out[nameM[1]] = valueM?.[1] ?? '';
  }
  return out;
}

function parseCourtTable(html: string): CourtCaseRecord[] {
  const cases: CourtCaseRecord[] = [];
  // Real WebCivil rows alternate <tr class="odd"> / <tr class="even">.
  const rowRe = /<tr[^>]*class="[^"]*(?:odd|even)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const row = rm[1];
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(row)) !== null) cells.push(stripHtml(cm[1]));
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
  return cases;
}

function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameMatches(partyCell: string, searched: string): boolean {
  const a = normalizeName(partyCell);
  const b = normalizeName(searched);
  if (a.includes(b)) return true;
  return b.split(' ').filter(w => w.length > 2).every(w => a.includes(w));
}

function isCloudflareChallenge(html: string): boolean {
  return /cloudflare|cf-chl|just a moment|enable javascript and cookies/i.test(html);
}

async function runSearch(
  name: string,
  paramType: 'D' | 'P',
  jar: CookieJar,
  hidden: Record<string, string>,
): Promise<{ html: string; status: number }> {
  const body = new URLSearchParams({
    ...hidden,
    court_type: 'NYC',
    param_type: paramType,
    param_name: name,
    param_firstName: '',
    submit: 'Find',
  });
  const resp = await proxyFetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': MAIN_URL,
      'Origin': 'https://iapps.courts.state.ny.us',
      'Cookie': jar.toString(),
    },
    body: body.toString(),
    timeoutMs: 25_000,
  });
  jar.ingest(resp.headers);
  return { html: await resp.text(), status: resp.status };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function lookupNYCourtHistory(partyName: string): Promise<CourtHistoryResult> {
  const searchedName = partyName.trim().toUpperCase();
  const jar = new CookieJar();

  // ── Step 1: bootstrap session at FCASMain ────────────────────────────────
  let hidden: Record<string, string> = {};
  try {
    const r = await proxyFetch(MAIN_URL, { headers: HEADERS, timeoutMs: 20_000 });
    jar.ingest(r.headers);
    const html = await r.text();
    if (r.status === 403 || isCloudflareChallenge(html)) {
      return fail(searchedName,
        'NY courts portal is behind a Cloudflare browser challenge (HTTP 403).',
        'iapps.courts.state.ny.us cannot be scraped from a plain HTTP client. Options: (1) route via a residential PROXY_URL whose IP has cleared the challenge, (2) use a headless-browser worker (puppeteer + stealth) that solves the challenge, or (3) call a paid court-data vendor (UniCourt, CourtListener RECAP).');
    }
    if (!r.ok) return fail(searchedName, `Courts portal returned HTTP ${r.status}`);
    hidden = extractHiddenInputs(html);
  } catch (err) {
    return fail(searchedName, `Could not reach NYC courts portal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 2: search as defendant ──────────────────────────────────────────
  let defendantCases: CourtCaseRecord[] = [];
  let plaintiffCases: CourtCaseRecord[] = [];

  try {
    const { html, status } = await runSearch(searchedName, 'D', jar, hidden);
    if (status === 403 || isCloudflareChallenge(html)) {
      return fail(searchedName, 'Cloudflare blocked the defendant search.',
        'Route through a residential proxy or use a headless browser.');
    }
    if (status !== 200) {
      return fail(searchedName, `Defendant search returned HTTP ${status}`,
        'POST field names may have changed — re-capture FCASSearch form in DevTools.');
    }
    defendantCases = parseCourtTable(html);
  } catch (err) {
    return fail(searchedName, `Defendant search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Step 3: search as plaintiff (best-effort) ────────────────────────────
  try {
    const { html, status } = await runSearch(searchedName, 'P', jar, hidden);
    if (status === 200 && !isCloudflareChallenge(html)) {
      plaintiffCases = parseCourtTable(html);
    }
  } catch {
    // ignore — plaintiff side is enrichment
  }

  // ── Step 4: dedupe + tally ───────────────────────────────────────────────
  const seen = new Set<string>();
  const all: CourtCaseRecord[] = [];
  for (const c of [...defendantCases, ...plaintiffCases]) {
    const key = c.caseIndex || `${c.plaintiff}|${c.defendant}|${c.filedDate}`;
    if (!seen.has(key)) { seen.add(key); all.push(c); }
  }
  const asDefendant = all.filter(c => nameMatches(c.defendant, searchedName)).length;
  const asPlaintiff = all.filter(c => nameMatches(c.plaintiff, searchedName)).length;

  let note: string;
  if (all.length === 0) {
    note = 'No NYC Civil Court cases found for this name. This covers NYC Civil Court only — not Supreme Court, federal court, or out-of-state cases.';
  } else if (asDefendant > 3) {
    note = `${all.length} NYC Civil Court case(s) found. Debtor has been sued ${asDefendant} time(s) as a defendant — pattern of non-payment or disputes. Consider QUICK_ESCALATION.`;
  } else if (asDefendant > 0) {
    note = `${all.length} NYC Civil Court case(s) found (${asDefendant} as defendant, ${asPlaintiff} as plaintiff). Prior judgments may indicate ability to collect; defaults suggest possible insolvency.`;
  } else if (asPlaintiff > 0) {
    note = `${all.length} case(s) found — debtor appears primarily as a plaintiff (${asPlaintiff} case(s)). No clear defendant history.`;
  } else {
    note = `${all.length} case(s) found but name matching was uncertain — verify manually at iapps.courts.state.ny.us/webcivil/FCASMain.`;
  }

  return {
    found: all.length > 0,
    totalCases: all.length,
    asDefendant,
    asPlaintiff,
    cases: all,
    searchedName,
    note,
  };
}

function fail(searchedName: string, error: string, scraperNote?: string): CourtHistoryResult {
  return {
    found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
    cases: [], searchedName,
    note: '', error, scraperNote,
  };
}
