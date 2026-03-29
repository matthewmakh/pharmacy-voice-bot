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

const DATASET_URL = 'https://data.cityofnewyork.us/resource/6bgk-in4p.json';
const DATA_LIMIT  = 200;

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
    // Order by outstanding amount descending so the worst debts come first
    const dataWhere = encodeURIComponent(countWhere);
    const dataUrl   = `${DATASET_URL}?$where=${dataWhere}&$limit=${DATA_LIMIT}&$order=outstanding_amount DESC`;
    const dataResp  = await fetch(dataUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!dataResp.ok) {
      return noResult(searchedName, `ECB data fetch returned ${dataResp.status}`);
    }

    const raw = await dataResp.json() as Record<string, unknown>[];

    // ── Step 3: normalise records ────────────────────────────────────────────
    const violations: ECBViolation[] = raw.map(r => {
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
