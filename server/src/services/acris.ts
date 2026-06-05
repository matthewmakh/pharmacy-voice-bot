// NYC ACRIS Real Property Parties lookup via NYC Open Data (Socrata)
// Dataset: ACRIS Real Property Parties — https://data.cityofnewyork.us/resource/636b-3b5g.json
// party_type "2" = GRANTEE (buyer/current holder), "1" = GRANTOR (seller/transferor)
//
// Auth: optional X-App-Token from NYC_OPEN_DATA_TOKEN — strongly recommended.
// Anonymous requests are heavily throttled and return 500 under load.
// Retries on 429/5xx via shared fetchWithRetry.

import { fetchWithRetry } from './lib/httpClient';

export interface ACRISResult {
  found: boolean;
  totalRecords: number;
  asGrantee: number;
  asGrantor: number;
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}

const DATA_LIMIT = 500;
const BASE_URL   = 'https://data.cityofnewyork.us/resource/636b-3b5g.json';

export async function lookupACRIS(partyName: string): Promise<ACRISResult> {
  const cleanName   = partyName.trim().toUpperCase().replace(/'/g, "''");
  const whereClause = `upper(name)='${cleanName}'`;

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (process.env.NYC_OPEN_DATA_TOKEN) {
    headers['X-App-Token'] = process.env.NYC_OPEN_DATA_TOKEN;
  }

  try {
    // Single query — fetch only party_type for up to DATA_LIMIT+1 records.
    // Socrata's count(*) is O(table) on this dataset (~40s for common names);
    // skip it and infer truncation by asking for one extra row.
    const dataUrl = `${BASE_URL}?$where=${encodeURIComponent(whereClause)}&$select=party_type&$limit=${DATA_LIMIT + 1}`;
    const dataResp = await fetchWithRetry(dataUrl, { headers, timeoutMs: 15_000 }, 4);
    if (!dataResp.ok) {
      return noResult(partyName, `ACRIS returned ${dataResp.status}`, hintForStatus(dataResp.status));
    }
    const records = await dataResp.json() as Array<{ party_type: string }>;

    if (records.length === 0) {
      return {
        found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
        searchedName: partyName.trim().toUpperCase(),
        note: 'No NYC property records found for this name in ACRIS. This does not rule out out-of-state property or property held under a different name.',
      };
    }

    const truncated = records.length > DATA_LIMIT;
    const sample    = truncated ? records.slice(0, DATA_LIMIT) : records;
    const asGrantee = sample.filter(r => r.party_type === '2').length;
    const asGrantor = sample.filter(r => r.party_type === '1').length;
    const realTotal = truncated ? DATA_LIMIT : records.length;

    // ── Step 3: build note ───────────────────────────────────────────────────
    let note: string;
    if (asGrantee > asGrantor) {
      note = `${realTotal} NYC property record(s) found${truncated ? ` (showing first ${DATA_LIMIT})` : ''} — debtor has more acquisitions (${asGrantee}) than sales (${asGrantor}). May currently own NYC real estate that can be liened after judgment. Verify current ownership on ACRIS before filing a lien.`;
    } else if (asGrantee > 0 && asGrantor === 0) {
      note = `${realTotal} NYC property record(s) found — debtor acquired property with no corresponding sale on record. May currently own NYC real estate. Verify on ACRIS.`;
    } else if (asGrantor > 0 && asGrantee === 0) {
      note = `${realTotal} NYC property record(s) found — debtor appears only as a grantor (seller/transferor). They may no longer hold NYC real property. Verify on ACRIS.`;
    } else if (asGrantee === 0 && asGrantor === 0) {
      note = `${realTotal} ACRIS record(s) found but none are ownership records (all appear to be reference entries). Verify manually on ACRIS.`;
    } else {
      note = `${realTotal} NYC property record(s) found (${asGrantee} acquisitions, ${asGrantor} transfers). Debtor may retain ownership of some NYC property — verify on ACRIS.`;
    }

    if (truncated) note += ` Note: at least ${DATA_LIMIT} ACRIS records — counts above reflect the first ${DATA_LIMIT} only.`;

    return {
      found: true,
      totalRecords: realTotal,
      asGrantee,
      asGrantor,
      searchedName: partyName.trim().toUpperCase(),
      note,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return noResult(partyName, `ACRIS lookup failed: ${msg}`);
  }
}

function hintForStatus(status: number): string | undefined {
  if (status === 429) return 'Set NYC_OPEN_DATA_TOKEN to bypass anonymous throttling (free at data.cityofnewyork.us/profile/app_tokens).';
  if (status >= 500) return 'Socrata is returning server errors — retried 4x. Try again in a minute.';
  return undefined;
}

function noResult(partyName: string, error: string, scraperNote?: string): ACRISResult {
  return {
    found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
    searchedName: partyName.trim().toUpperCase(),
    note: '',
    error,
    scraperNote,
  };
}
