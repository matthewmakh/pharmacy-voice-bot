// NYC ECB (Environmental Control Board) / OATH Violations lookup
// via NYC Open Data — free, no auth required.
//
// Dataset: OATH ECB Violations
//   https://data.cityofnewyork.us/resource/6bgk-in4p.json
//
// What it tells you:
//   Businesses with large unpaid ECB fines are in financial distress.
//   High outstanding balances suggest a debtor who doesn't pay government
//   fines likely isn't paying their vendors either.
//   A debtor with $50k+ in unpaid ECB violations is a red flag for
//   collectability — if they're not paying the city, collecting a judgment
//   may be difficult.
//
// Fields used:
//   respondent_name   — business or individual name
//   issue_date        — when the violation was issued
//   violation_type    — type of code violation
//   imposed_amount    — total fine imposed
//   outstanding_amount / balance_due — remaining unpaid balance
//   hearing_status    — DEFAULT, IN VIOLATION, DISMISSED, etc.
//   boro              — borough

export interface ECBViolation {
  respondentName: string;
  issueDate: string | null;
  violationType: string;
  hearingStatus: string;
  imposedAmount: number | null;
  outstandingAmount: number | null;
  borough: string | null;
}

export interface ECBResult {
  found: boolean;
  totalViolations: number;
  totalImposed: number;
  totalOutstanding: number;
  unpaidViolations: number;    // violations with outstanding balance > 0
  violations: ECBViolation[];
  searchedName: string;
  note: string;
  error?: string;
}

// Dataset IDs to try in order — NYC Open Data migrates datasets occasionally.
// Override with ECB_DATASET_ID env var if the active ID changes again.
const DATASET_ID_CANDIDATES = [
  process.env.ECB_DATASET_ID,  // env override first
  '6bgk-in4p',  // OATH ECB Violations (original)
  'nhy8-p4td',  // OATH Summons
  'jz4z-kudi',  // OATH Hearing Dispositions
  'erm5-jryu',  // ECB Violations (alt)
  'twhy-dzjp',  // ECB Violations (alt)
  'p937-wjvj',  // ECB Violations (alt)
].filter(Boolean) as string[];

const DATA_LIMIT = 200;

/** Try each known dataset ID. If all fail, query the Socrata catalog to find the current one. */
async function resolveDatasetUrl(headers: Record<string, string>): Promise<string | null> {
  // 1. Try known IDs first (fast — 404 if wrong, 200 if right)
  for (const id of DATASET_ID_CANDIDATES) {
    const url = `https://data.cityofnewyork.us/resource/${id}.json`;
    try {
      const resp = await fetch(`${url}?$limit=1`, { headers, signal: AbortSignal.timeout(6_000) });
      if (resp.ok) return url;
    } catch { /* try next */ }
  }

  // 2. Fall back to Socrata catalog search — finds current dataset ID dynamically
  try {
    const catalogUrl = 'https://data.cityofnewyork.us/api/catalog/v1?q=OATH+ECB+violations&limit=10';
    const catResp = await fetch(catalogUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (catResp.ok) {
      const cat = await catResp.json() as { results?: Array<{ resource: { id: string; name: string } }> };
      const match = cat.results?.find(r => {
        const name = (r.resource?.name ?? '').toLowerCase();
        return name.includes('ecb') || name.includes('oath') || name.includes('violation');
      });
      if (match?.resource?.id) {
        const url = `https://data.cityofnewyork.us/resource/${match.resource.id}.json`;
        const checkResp = await fetch(`${url}?$limit=1`, { headers, signal: AbortSignal.timeout(6_000) });
        if (checkResp.ok) return url;
      }
    }
  } catch { /* catalog search failed */ }

  return null;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

export async function lookupNYCECB(partyName: string): Promise<ECBResult> {
  const searchedName = partyName.trim().toUpperCase();
  const cleanName    = searchedName.replace(/'/g, "''");

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (process.env.NYC_OPEN_DATA_TOKEN) {
    headers['X-App-Token'] = process.env.NYC_OPEN_DATA_TOKEN;
  }

  try {
    // ── Step 0: find a working dataset URL ───────────────────────────────────
    const DATASET_URL = await resolveDatasetUrl(headers);
    if (!DATASET_URL) {
      return noResult(searchedName, 'ECB dataset not found — all known NYC Open Data dataset IDs returned errors. Set ECB_DATASET_ID env var with the current ID from data.cityofnewyork.us.');
    }

    // ── Step 1: get real count ───────────────────────────────────────────────
    const countWhere  = `upper(respondent_name)='${cleanName}'`;
    const countUrl    = `${DATASET_URL}?$where=${encodeURIComponent(countWhere)}&$select=count(*)`;
    const countResp   = await fetch(countUrl, { headers, signal: AbortSignal.timeout(12_000) });
    if (!countResp.ok) {
      return noResult(searchedName, `ECB API returned ${countResp.status}`);
    }
    const countData  = await countResp.json() as Array<Record<string, string>>;
    const realTotal  = parseInt(countData[0]?.['count'] ?? '0', 10);

    if (realTotal === 0) {
      return {
        found: false, totalViolations: 0, totalImposed: 0, totalOutstanding: 0,
        unpaidViolations: 0, violations: [], searchedName,
        note: `No ECB/OATH violations found for "${searchedName}". This is a positive sign — no outstanding code violations on record.`,
      };
    }

    // ── Step 2: fetch violation records ─────────────────────────────────────
    // No $order clause — field names vary across dataset versions and an
    // unknown field name causes HTTP 400. Sort client-side after fetch.
    const dataWhere = encodeURIComponent(countWhere);
    const dataUrl   = `${DATASET_URL}?$where=${dataWhere}&$limit=${DATA_LIMIT}`;
    const dataResp  = await fetch(dataUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!dataResp.ok) {
      return noResult(searchedName, `ECB data fetch returned ${dataResp.status}`);
    }

    const raw = await dataResp.json() as Record<string, unknown>[];

    // ── Step 3: normalise records ────────────────────────────────────────────
    const violations: ECBViolation[] = raw.map(r => {
      // Field names vary across dataset versions — handle all known names
      // The dataset uses different field names across versions —
      // handle both current and legacy names
      const outstanding = parseAmount(r['outstanding_amount'] ?? r['balance_due'] ?? r['amount_due']);
      const imposed     = parseAmount(r['imposed_amount'] ?? r['total_imposed'] ?? r['fine_amount']);
      const status      = String(r['hearing_status'] ?? r['case_status'] ?? r['status'] ?? '').trim();
      const vtype       = String(r['violation_type'] ?? r['violation_description'] ?? r['infraction_code'] ?? '').trim();
      const boro        = String(r['boro'] ?? r['borough'] ?? r['borocode'] ?? '').trim() || null;
      const issueDate   = String(r['issue_date'] ?? r['violation_date'] ?? r['hearing_date'] ?? '').trim() || null;
      const respName    = String(r['respondent_name'] ?? '').trim();

      return {
        respondentName: respName,
        issueDate,
        violationType: vtype,
        hearingStatus: status,
        imposedAmount: imposed,
        outstandingAmount: outstanding,
        borough: boro,
      };
    });

    // Sort by outstanding amount descending (client-side, avoids $order field-name dependency)
    violations.sort((a, b) => (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0));

    // ── Step 4: aggregate ────────────────────────────────────────────────────
    const totalImposed      = violations.reduce((s, v) => s + (v.imposedAmount ?? 0), 0);
    const totalOutstanding  = violations.reduce((s, v) => s + (v.outstandingAmount ?? 0), 0);
    const unpaidViolations  = violations.filter(v => (v.outstandingAmount ?? 0) > 0).length;
    const defaultCount      = violations.filter(v => /default/i.test(v.hearingStatus)).length;

    // ── Step 5: build note ───────────────────────────────────────────────────
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    let note = '';
    if (totalOutstanding === 0) {
      note = `${realTotal} ECB/OATH violation(s) found — all fines appear to be paid or dismissed. No outstanding balance.`;
    } else if (totalOutstanding > 50_000) {
      note = `⚠ ${realTotal} ECB/OATH violation(s) found with ${fmt(totalOutstanding)} outstanding (${fmt(totalImposed)} total imposed). This is a significant red flag for collectability — a debtor who doesn't pay large government fines is likely cash-poor or asset-shielding. Proceed with QUICK_ESCALATION and consider collectability carefully before investing in litigation.`;
    } else if (totalOutstanding > 5_000) {
      note = `${realTotal} ECB/OATH violation(s) found with ${fmt(totalOutstanding)} outstanding balance (${fmt(totalImposed)} total imposed). Moderate financial distress signal. ${unpaidViolations} violation(s) have unpaid balances.`;
    } else {
      note = `${realTotal} ECB/OATH violation(s) found with ${fmt(totalOutstanding)} outstanding. Low balance — not a strong collectability concern on its own.`;
    }

    if (defaultCount > 0) {
      note += ` ${defaultCount} violation(s) are in DEFAULT status (debtor failed to appear at hearing).`;
    }

    if (realTotal > DATA_LIMIT) {
      note += ` (Showing first ${DATA_LIMIT} of ${realTotal} total violations — outstanding balance may be higher.)`;
    }

    return {
      found: true,
      totalViolations: realTotal,
      totalImposed: Math.round(totalImposed * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      unpaidViolations,
      violations,
      searchedName,
      note,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return noResult(searchedName, `ECB lookup failed: ${msg}`);
  }
}

function noResult(searchedName: string, error: string): ECBResult {
  return {
    found: false, totalViolations: 0, totalImposed: 0, totalOutstanding: 0,
    unpaidViolations: 0, violations: [], searchedName,
    note: '',
    error,
  };
}
