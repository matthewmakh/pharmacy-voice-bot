// NYC ACRIS Real Property Parties lookup via NYC Open Data (free, no auth required)
// Dataset: ACRIS Real Property Parties — https://data.cityofnewyork.us/resource/636b-3b5g.json
// party_type "2" = GRANTEE (buyer/current holder), "1" = GRANTOR (seller/transferor)
//
// Fix log:
//   - Use a $count query first to get the real total (old $limit=50 silently truncated)
//   - Raise data fetch limit to 500 rows; warn in note when count exceeds it
//   - Ignore party_type values outside '1'/'2' so asGrantee+asGrantor always = totalRecords

export interface ACRISResult {
  found: boolean;
  totalRecords: number;
  asGrantee: number;
  asGrantor: number;
  searchedName: string;
  note: string;
  error?: string;
}

const DATA_LIMIT = 500;

export async function lookupACRIS(partyName: string): Promise<ACRISResult> {
  const cleanName = partyName.trim().toUpperCase().replace(/'/g, "''");
  const whereClause = `upper(name)='${cleanName}'`;
  const baseUrl = 'https://data.cityofnewyork.us/resource/636b-3b5g.json';

  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (process.env.NYC_OPEN_DATA_TOKEN) {
    headers['X-App-Token'] = process.env.NYC_OPEN_DATA_TOKEN;
  }

  try {
    // ── Step 1: get accurate total count ──────────────────────────────────────
    const countUrl = `${baseUrl}?$where=${encodeURIComponent(whereClause)}&$select=count(*)`;
    const countResp = await fetch(countUrl, { headers, signal: AbortSignal.timeout(12_000) });
    if (!countResp.ok) {
      return noResult(partyName, `ACRIS API returned ${countResp.status}`);
    }
    const countData = await countResp.json() as Array<Record<string, string>>;
    const realTotal = parseInt(countData[0]?.['count'] ?? '0', 10);

    if (realTotal === 0) {
      return {
        found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
        searchedName: partyName.trim().toUpperCase(),
        note: 'No NYC property records found for this name in ACRIS. This does not rule out out-of-state property or property held under a different name.',
      };
    }

    // ── Step 2: fetch records (capped at DATA_LIMIT, only columns we need) ───
    const dataUrl = `${baseUrl}?$where=${encodeURIComponent(whereClause)}&$select=party_type&$limit=${DATA_LIMIT}`;
    const dataResp = await fetch(dataUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!dataResp.ok) {
      return noResult(partyName, `ACRIS data fetch returned ${dataResp.status}`);
    }

    const records = await dataResp.json() as Array<{ party_type: string }>;
    // Only count the two canonical party types — ignore reference/other entries
    const asGrantee = records.filter(r => r.party_type === '2').length;
    const asGrantor = records.filter(r => r.party_type === '1').length;
    const fetchedCount = records.length;
    const truncated = realTotal > DATA_LIMIT;

    // ── Step 3: build note ───────────────────────────────────────────────────
    const displayTotal = realTotal; // always show the real total, not the fetched count
    let note: string;

    if (asGrantee > asGrantor) {
      note = `${displayTotal} NYC property record(s) found${truncated ? ` (showing first ${DATA_LIMIT})` : ''} — debtor has more acquisitions (${asGrantee}) than sales (${asGrantor}). May currently own NYC real estate that can be liened after judgment. Verify current ownership on ACRIS before filing a lien.`;
    } else if (asGrantee > 0 && asGrantor === 0) {
      note = `${displayTotal} NYC property record(s) found — debtor acquired property with no corresponding sale on record. May currently own NYC real estate. Verify on ACRIS.`;
    } else if (asGrantor > 0 && asGrantee === 0) {
      note = `${displayTotal} NYC property record(s) found — debtor appears only as a grantor (seller/transferor). They may no longer hold NYC real property. Verify on ACRIS.`;
    } else if (asGrantee === 0 && asGrantor === 0) {
      // Records exist but none have party_type 1 or 2 — reference entries
      note = `${displayTotal} ACRIS record(s) found but none are ownership records (all appear to be reference entries). Verify manually on ACRIS.`;
    } else {
      note = `${displayTotal} NYC property record(s) found (${asGrantee} acquisitions, ${asGrantor} transfers). Debtor may retain ownership of some NYC property — verify on ACRIS to confirm current holdings.`;
    }

    if (truncated) {
      note += ` Note: this debtor has more than ${DATA_LIMIT} ACRIS records — results are partial.`;
    }

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

function noResult(partyName: string, error: string): ACRISResult {
  return {
    found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
    searchedName: partyName.trim().toUpperCase(),
    note: '',
    error,
  };
}
