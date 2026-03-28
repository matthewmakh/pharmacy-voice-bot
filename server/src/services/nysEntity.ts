// NYS Department of State — Business Entity Search
// Searches the public NYS entity database at apps.dos.ny.gov
//
// The NYS DOS site uses a JSON API that backs its public inquiry portal.
// We hit the same endpoint the browser calls. No auth required.
// URL: https://apps.dos.ny.gov/publicInquiry/entitySearch
// Method: POST with JSON body
//
// Results include: entity name, DOS ID, entity type (LLC, Corp, LP, etc.),
// status (Active/Inactive/Dissolved), county of formation, date of formation,
// registered agent name, registered agent address.
//
// Critical use: Registered agent address is the legally valid address for service
// of process when no other address is available. Entity status tells you whether
// you're chasing a dissolved shell.

export interface NYSEntityRecord {
  dosId: string;
  entityName: string;
  entityType: string;        // "DOMESTIC LLC", "FOREIGN CORPORATION", etc.
  status: string;            // "Active", "Inactive", "Dissolved"
  county: string | null;
  formationDate: string | null;
  registeredAgent: string | null;
  registeredAgentAddress: string | null;
  principalAddress: string | null;
}

export interface NYSEntityResult {
  found: boolean;
  totalRecords: number;
  entities: NYSEntityRecord[];
  searchedName: string;
  note: string;
  error?: string;
}

// Normalise whatever the API returns into our interface
function normaliseEntity(raw: Record<string, unknown>): NYSEntityRecord {
  // The DOS API uses various key formats across versions; handle both
  const get = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = raw[k];
      if (v && typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  // Build registered agent address from parts
  const agentAddr1 = get(['registeredAgentAddress1', 'regAgentAddress1', 'service_address_1']);
  const agentCity  = get(['registeredAgentCity', 'regAgentCity', 'service_city']);
  const agentState = get(['registeredAgentState', 'regAgentState', 'service_state']);
  const agentZip   = get(['registeredAgentZip', 'regAgentZip', 'service_zip']);
  const agentAddrParts = [agentAddr1, agentCity, agentState, agentZip].filter(Boolean);
  const registeredAgentAddress = agentAddrParts.length ? agentAddrParts.join(', ') : null;

  // Build principal address
  const prinAddr1  = get(['principalAddress1', 'address1', 'prin_address_1']);
  const prinCity   = get(['principalCity', 'city', 'prin_city']);
  const prinState  = get(['principalState', 'state', 'prin_state']);
  const prinZip    = get(['principalZip', 'zip', 'prin_zip']);
  const prinParts  = [prinAddr1, prinCity, prinState, prinZip].filter(Boolean);
  const principalAddress = prinParts.length ? prinParts.join(', ') : null;

  return {
    dosId:                  get(['dosId', 'dos_id', 'id', 'entityId']) ?? '',
    entityName:             get(['entityName', 'name', 'businessName']) ?? '',
    entityType:             get(['entityType', 'type', 'entity_type', 'businessType']) ?? '',
    status:                 get(['entityStatus', 'status', 'entity_status']) ?? '',
    county:                 get(['county', 'countyOfFormation', 'formation_county']),
    formationDate:          get(['dateOfFormation', 'formationDate', 'formation_date', 'dateFormed']),
    registeredAgent:        get(['registeredAgentName', 'regAgentName', 'agent_name']),
    registeredAgentAddress,
    principalAddress,
  };
}

export async function lookupNYSEntity(entityName: string): Promise<NYSEntityResult> {
  const searchedName = entityName.trim();

  // Primary: NYS DOS public inquiry JSON API
  // This endpoint is undocumented but is the backing service for
  // apps.dos.ny.gov/publicInquiry — it's stable and has been used
  // by third-party tools for several years. If it starts returning
  // 403, try adding a Referer header or updating the User-Agent.
  const API_URL = 'https://apps.dos.ny.gov/publicInquiry/entitySearch';

  const payload = {
    nameType: 'Current',
    searchName: searchedName,
    // Broad search — returns all matching entity types
    entityType: '',
    entityStatus: '',
    countyId: '',
  };

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://apps.dos.ny.gov/publicInquiry/',
        'Origin': 'https://apps.dos.ny.gov',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return {
        found: false, totalRecords: 0, entities: [], searchedName,
        note: '',
        error: `NYS entity search returned ${resp.status}. The public API may have changed — verify at apps.dos.ny.gov/publicInquiry/.`,
      };
    }

    const body = await resp.json() as unknown;

    // The API wraps results in different shapes across versions
    let rawEntities: Record<string, unknown>[] = [];
    if (Array.isArray(body)) {
      rawEntities = body as Record<string, unknown>[];
    } else if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      // Common shapes: { entities: [...] }, { results: [...] }, { data: [...] }
      const inner = b['entities'] ?? b['results'] ?? b['data'] ?? b['businessEntities'];
      if (Array.isArray(inner)) {
        rawEntities = inner as Record<string, unknown>[];
      }
    }

    if (rawEntities.length === 0) {
      return {
        found: false, totalRecords: 0, entities: [], searchedName,
        note: `No NYS entity found matching "${searchedName}". If the debtor is a business, they may be registered under a different name, as a DBA, or in another state.`,
      };
    }

    const entities = rawEntities.map(normaliseEntity);

    // Best match: exact or starts-with match, prefer active
    const sorted = [...entities].sort((a, b) => {
      const aExact = a.entityName.toUpperCase() === searchedName.toUpperCase() ? 0 : 1;
      const bExact = b.entityName.toUpperCase() === searchedName.toUpperCase() ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aActive = a.status.toLowerCase() === 'active' ? 0 : 1;
      const bActive = b.status.toLowerCase() === 'active' ? 0 : 1;
      return aActive - bActive;
    });

    const best = sorted[0];
    const isActive = best.status.toLowerCase() === 'active';
    const isDissolved = /dissolved|inactive|cancelled|revoked/i.test(best.status);

    let note = '';
    if (isDissolved) {
      note = `"${best.entityName}" is ${best.status} (not active) per NYS DOS. ` +
        `Suing a dissolved entity is more complex — you may need to pursue former members/officers directly or file against the entity before the dissolution deadline. ` +
        `Confirm status at apps.dos.ny.gov/publicInquiry/ before filing.`;
    } else if (isActive) {
      const agentPart = best.registeredAgent
        ? ` Registered agent: ${best.registeredAgent}${best.registeredAgentAddress ? ' at ' + best.registeredAgentAddress : ''} — use this address for service of process if needed.`
        : ' No registered agent on file — service may need to go to the Secretary of State.';
      note = `"${best.entityName}" is Active per NYS DOS (DOS ID ${best.dosId}).${agentPart}`;
    } else {
      note = `"${best.entityName}" found in NYS DOS with status "${best.status}". Verify status before proceeding.`;
    }

    if (entities.length > 1) {
      note += ` (${entities.length - 1} other entity name match(es) found — confirm you have the right entity.)`;
    }

    return {
      found: true,
      totalRecords: entities.length,
      entities: sorted,
      searchedName,
      note,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false, totalRecords: 0, entities: [], searchedName,
      note: '',
      error: `NYS entity search failed: ${msg}. Look up manually at apps.dos.ny.gov/publicInquiry/.`,
    };
  }
}
