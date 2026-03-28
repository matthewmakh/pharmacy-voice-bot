// NYC ACRIS Real Property Parties lookup via NYC Open Data (free, no auth required)
// Dataset: ACRIS Real Property Parties — https://data.cityofnewyork.us/resource/636b-3b5g.json
// party_type "2" = GRANTEE (buyer/current holder), "1" = GRANTOR (seller/transferor)

export interface ACRISResult {
  found: boolean;
  totalRecords: number;
  asGrantee: number;
  asGrantor: number;
  searchedName: string;
  note: string;
  error?: string;
}

export async function lookupACRIS(partyName: string): Promise<ACRISResult> {
  const cleanName = partyName.trim().toUpperCase().replace(/'/g, "''");
  const whereClause = `upper(name)='${cleanName}'`;
  const url = `https://data.cityofnewyork.us/resource/636b-3b5g.json?$where=${encodeURIComponent(whereClause)}&$limit=50`;

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (process.env.NYC_OPEN_DATA_TOKEN) {
      headers['X-App-Token'] = process.env.NYC_OPEN_DATA_TOKEN;
    }

    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      return {
        found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
        searchedName: cleanName,
        note: '',
        error: `ACRIS API returned ${resp.status}`,
      };
    }

    const records = await resp.json() as Array<{ party_type: string }>;
    const asGrantee = records.filter(r => r.party_type === '2').length;
    const asGrantor = records.filter(r => r.party_type === '1').length;
    const totalRecords = records.length;

    let note: string;
    if (totalRecords === 0) {
      note = 'No NYC property records found for this name in ACRIS. This does not rule out out-of-state property or property held under a different name.';
    } else if (asGrantee > 0 && asGrantor === 0) {
      note = `${totalRecords} NYC property record(s) found — debtor acquired property with no corresponding sale on record. May currently own NYC real estate that can be liened after judgment. Verify current ownership on ACRIS before filing a lien.`;
    } else if (asGrantee > asGrantor) {
      note = `${totalRecords} NYC property record(s) found (${asGrantee} acquisitions, ${asGrantor} transfers). Debtor may retain ownership of some NYC property. Verify on ACRIS to confirm which, if any, properties are currently owned.`;
    } else {
      note = `${totalRecords} historical NYC property record(s) found — debtor has transferred as many properties as they have acquired. They may not currently own NYC real property. Verify on ACRIS.`;
    }

    return { found: totalRecords > 0, totalRecords, asGrantee, asGrantor, searchedName: partyName.trim().toUpperCase(), note };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0,
      searchedName: partyName.trim().toUpperCase(),
      note: '',
      error: `ACRIS lookup failed: ${msg}`,
    };
  }
}
