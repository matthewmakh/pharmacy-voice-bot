// NYS Department of State — Business Entity Search
// Uses the same JSON API that backs apps.dos.ny.gov/publicInquiry/
//
// Endpoints (confirmed from production scraper):
//   POST /PublicInquiryWeb/api/PublicInquiry/GetComplexSearchMatchingEntities
//   POST /PublicInquiryWeb/api/PublicInquiry/GetEntityRecordByID
//
// Returns: entity status, type, registered agent, CEO, service-of-process address,
// formation date, county, jurisdiction.
//
// The registered agent / DOS process address is the legally valid address for
// service of process when no other address is confirmed.

const BASE_URL = 'https://apps.dos.ny.gov/PublicInquiryWeb/api/PublicInquiry';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Origin': 'https://apps.dos.ny.gov',
  'Referer': 'https://apps.dos.ny.gov/publicInquiry/',
};

// Retry helper — retries on network errors and 429/5xx, not on 4xx.
// FIX: accepts timeoutMs separately so each attempt gets a FRESH AbortSignal.
// The old pattern of passing AbortSignal.timeout() inside `init` meant an
// expired signal from attempt 1 would immediately abort all subsequent retries.
async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      // Fresh signal every attempt
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((resp.status === 429 || resp.status >= 500) && i < retries - 1) {
        await new Promise(r => setTimeout(r, (i + 1) * 1500));
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, (i + 1) * 1500));
    }
  }
  throw lastErr;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NYSEntityContact {
  name: string;
  role: string;   // 'CEO', 'Registered Agent', 'Service of Process'
  address: string | null;
}

export interface NYSEntityRecord {
  dosId: string;
  entityName: string;
  entityType: string;        // "Domestic LLC", "Foreign Corporation", etc.
  status: string;            // "Active", "Inactive", "Dissolved"
  jurisdiction: string | null;
  county: string | null;
  formationDate: string | null;
  contacts: NYSEntityContact[];
  // Convenience fields derived from contacts
  registeredAgent: string | null;
  registeredAgentAddress: string | null;
  dosProcessAddress: string | null;
}

export interface NYSEntityResult {
  found: boolean;
  totalRecords: number;
  entities: NYSEntityRecord[];
  searchedName: string;
  note: string;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = [
    a['streetAddress'] ?? a['street'] ?? a['address1'],
    a['city'],
    a['state'],
    a['zipCode'] ?? a['zip'],
  ].filter(p => p && typeof p === 'string' && (p as string).trim());
  return parts.length ? (parts as string[]).join(', ') : null;
}

function isPersonName(name: string): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  const bizWords = ['LLC', 'INC', 'CORP', 'LTD', 'LP', 'LLP', 'COMPANY', 'GROUP',
                    'SERVICES', 'TRUST', 'FUND', 'BANK', 'ASSOCIATES', 'PARTNERS'];
  if (bizWords.some(w => upper.includes(w))) return false;
  const words = name.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 5;
}

// ─── Fetch entity details (second API call) ───────────────────────────────────

async function fetchEntityDetails(dosId: string, entityName: string): Promise<NYSEntityRecord | null> {
  try {
    const resp = await fetchWithRetry(`${BASE_URL}/GetEntityRecordByID`, {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({ SearchID: dosId, EntityName: entityName, AssumedNameFlag: 'false' }),
    }, 12_000);

    if (!resp.ok) return null;
    const d = await resp.json() as Record<string, unknown>;

    const contacts: NYSEntityContact[] = [];

    // Extract contacts from CEO, sopAddress, registeredAgent slots
    const slots: Array<{ key: string; role: string }> = [
      { key: 'ceo', role: 'CEO' },
      { key: 'sopAddress', role: 'Service of Process' },
      { key: 'registeredAgent', role: 'Registered Agent' },
    ];

    for (const { key, role } of slots) {
      const slot = d[key] as Record<string, unknown> | null | undefined;
      if (!slot) continue;
      const name = (slot['name'] as string | undefined)?.trim() ?? '';
      if (!name) continue;
      if (!isPersonName(name) && role === 'CEO') continue; // skip if CEO field has a company name
      contacts.push({ name, role, address: formatAddress(slot['address']) });
    }

    // Convenience getters
    const agentContact = contacts.find(c => c.role === 'Registered Agent');
    const sopContact   = contacts.find(c => c.role === 'Service of Process');

    // dosProcessAddress from top-level field (can be an address object or string)
    const dosProcessAddr = d['dosProcessAddress'];
    const dosProcessFormatted = typeof dosProcessAddr === 'object'
      ? formatAddress(dosProcessAddr)
      : (typeof dosProcessAddr === 'string' ? dosProcessAddr.trim() || null : null);

    return {
      dosId,
      entityName: (d['entityName'] as string | undefined)?.trim() ?? entityName,
      entityType: (d['entityType'] as string | undefined)?.trim() ?? '',
      status:     (d['entityStatus'] as string | undefined)?.trim() ?? '',
      jurisdiction: (d['jurisdiction'] as string | undefined)?.trim() || null,
      county:     (d['county'] as string | undefined)?.trim() || null,
      formationDate: (d['filingDate'] as string | undefined)?.trim() || null,
      contacts,
      registeredAgent: agentContact?.name ?? null,
      registeredAgentAddress: agentContact?.address ?? null,
      dosProcessAddress: dosProcessFormatted ?? sopContact?.address ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function lookupNYSEntity(entityName: string): Promise<NYSEntityResult> {
  const searchedName = entityName.trim();

  // Step 1: Search by name
  const searchPayload = {
    searchValue: searchedName,
    searchByTypeIndicator: 'EntityName',
    searchExpressionIndicator: 'BeginsWith',
    entityStatusIndicator: 'All',
    entityTypeIndicator: [] as string[],  // empty = all types
    listPaginationInfo: { listStartRecord: 1, listEndRecord: 50 },
  };

  try {
    const searchResp = await fetchWithRetry(`${BASE_URL}/GetComplexSearchMatchingEntities`, {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: JSON.stringify(searchPayload),
    }, 15_000);

    if (!searchResp.ok) {
      return {
        found: false, totalRecords: 0, entities: [], searchedName,
        note: '',
        error: `NYS DOS returned ${searchResp.status}. Verify at apps.dos.ny.gov/publicInquiry/`,
      };
    }

    const body = await searchResp.json() as Record<string, unknown>;
    const rawList = (body['entitySearchResultList'] ?? body['results'] ?? body) as unknown[];
    const resultList = Array.isArray(rawList) ? rawList as Record<string, unknown>[] : [];

    if (resultList.length === 0) {
      return {
        found: false, totalRecords: 0, entities: [], searchedName,
        note: `No NYS entity found matching "${searchedName}". The debtor may be registered under a different name, operating as a DBA, or incorporated in another state.`,
      };
    }

    // Sort: exact match first, then active, then alpha
    const sorted = [...resultList].sort((a, b) => {
      const aName = ((a['entityName'] as string) ?? '').toUpperCase();
      const bName = ((b['entityName'] as string) ?? '').toUpperCase();
      const upper = searchedName.toUpperCase();
      const aExact = aName === upper ? 0 : 1;
      const bExact = bName === upper ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aActive = ((a['entityStatus'] as string) ?? '').toLowerCase() === 'active' ? 0 : 1;
      const bActive = ((b['entityStatus'] as string) ?? '').toLowerCase() === 'active' ? 0 : 1;
      return aActive - bActive;
    });

    // Step 2: Fetch details for top match (and up to 2 more if they're active).
    // Staggered: 300ms between each to avoid hitting a rate-limit simultaneously.
    const toFetch = sorted.slice(0, Math.min(3, sorted.length));
    const details: Array<Awaited<ReturnType<typeof fetchEntityDetails>>> = [];
    for (let i = 0; i < toFetch.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      details.push(await fetchEntityDetails(
        String(toFetch[i]['dosID'] ?? toFetch[i]['dosId'] ?? ''),
        String(toFetch[i]['entityName'] ?? ''),
      ));
    }

    // Fall back to search-result data for any that failed the detail fetch
    const entities: NYSEntityRecord[] = toFetch.map((r, i) => {
      if (details[i]) return details[i]!;
      const dosId = String(r['dosID'] ?? r['dosId'] ?? '');
      const name  = String(r['entityName'] ?? '');
      return {
        dosId,
        entityName: name,
        entityType: String(r['entityType'] ?? ''),
        status:     String(r['entityStatus'] ?? ''),
        jurisdiction: (r['jurisdiction'] as string | null) ?? null,
        county:     null,
        formationDate: (r['formationDate'] as string | null) ?? null,
        contacts:   [],
        registeredAgent: null,
        registeredAgentAddress: null,
        dosProcessAddress: null,
      };
    });

    const best = entities[0];
    const isActive   = /active/i.test(best.status);
    const isDissolved = /dissolved|inactive|cancelled|revoked|annulled/i.test(best.status);

    let note = '';
    if (isDissolved) {
      note = `"${best.entityName}" is ${best.status} per NYS DOS. ` +
        `Suing a dissolved entity is more complex — you may need to pursue former members or officers directly, ` +
        `or act before the winding-up period closes. Confirm at apps.dos.ny.gov/publicInquiry/ before filing.`;
    } else if (isActive) {
      const serviceTarget = best.registeredAgent
        ? `${best.registeredAgent}${best.registeredAgentAddress ? ' at ' + best.registeredAgentAddress : ''}`
        : best.dosProcessAddress
          ? `DOS process address: ${best.dosProcessAddress}`
          : null;
      note = `"${best.entityName}" is Active per NYS DOS (DOS ID ${best.dosId}).`;
      if (serviceTarget) {
        note += ` Registered agent: ${serviceTarget} — valid address for service of process.`;
      } else {
        note += ` No registered agent on file — service defaults to the NYS Secretary of State (process fee ~$40).`;
      }
    } else {
      note = `"${best.entityName}" found in NYS DOS with status "${best.status}". Verify before proceeding.`;
    }

    if (resultList.length > 3) {
      note += ` (${resultList.length - 1} other match(es) found — confirm you have the correct entity.)`;
    }

    return {
      found: true,
      totalRecords: resultList.length,
      entities,
      searchedName,
      note,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false, totalRecords: 0, entities: [], searchedName,
      note: '',
      error: `NYS entity lookup failed: ${msg}. Look up manually at apps.dos.ny.gov/publicInquiry/`,
    };
  }
}
