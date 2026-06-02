/**
 * New York City venue resolution.
 *
 * Filing in the wrong county gets a case dismissed or transferred, so we resolve
 * the debtor's county primarily from the ZIP code (authoritative) and fall back to
 * borough/neighborhood keywords. Crucially, when we cannot determine an NYC county
 * with confidence we return `null` and flag it — we never silently default to a
 * borough, which the previous implementation did (everything unknown → Queens).
 */

export type NycCounty = 'New York' | 'Kings' | 'Queens' | 'Bronx' | 'Richmond';

export interface VenueResult {
  /** Resolved NYC county, or null if it could not be determined / is outside NYC. */
  county: NycCounty | null;
  borough: string | null;
  /** True only when we are confident the address is within NYC. */
  inNYC: boolean;
  confidence: 'high' | 'medium' | 'none';
  /** Human-readable note surfaced to the user when venue is uncertain. */
  note: string;
}

export const COURT_ADDRESSES: Record<NycCounty, { civil: string; supreme: string; borough: string }> = {
  'New York': { borough: 'Manhattan', civil: '111 Centre Street, New York, NY 10013', supreme: '60 Centre Street, New York, NY 10007' },
  'Kings':    { borough: 'Brooklyn', civil: '141 Livingston Street, Brooklyn, NY 11201', supreme: '360 Adams Street, Brooklyn, NY 11201' },
  'Queens':   { borough: 'Queens', civil: '89-17 Sutphin Boulevard, Jamaica, NY 11435', supreme: '88-11 Sutphin Boulevard, Jamaica, NY 11435' },
  'Bronx':    { borough: 'Bronx', civil: '851 Grand Concourse, Bronx, NY 10451', supreme: '851 Grand Concourse, Bronx, NY 10451' },
  'Richmond': { borough: 'Staten Island', civil: '927 Castleton Avenue, Staten Island, NY 10310', supreme: '18 Richmond Terrace, Staten Island, NY 10301' },
};

/** Map a NYC 5-digit ZIP to its county. Returns null for non-NYC ZIPs. */
function countyFromZip(zip: string): NycCounty | null {
  const z = parseInt(zip, 10);
  if (Number.isNaN(z)) return null;
  // Manhattan (New York County): 10001–10282
  if (z >= 10001 && z <= 10282) return 'New York';
  // Staten Island (Richmond County): 10301–10314
  if (z >= 10301 && z <= 10314) return 'Richmond';
  // Bronx: 10451–10475
  if (z >= 10451 && z <= 10475) return 'Bronx';
  // Brooklyn (Kings County): 11201–11256
  if (z >= 11201 && z <= 11256) return 'Kings';
  // Queens: 11004–11005, 11101–11120, 11351–11697
  if ((z >= 11004 && z <= 11005) || (z >= 11101 && z <= 11120) || (z >= 11351 && z <= 11697)) return 'Queens';
  return null;
}

const BOROUGH_KEYWORDS: Array<{ county: NycCounty; terms: string[] }> = [
  { county: 'New York', terms: ['manhattan', 'new york county'] },
  { county: 'Kings', terms: ['brooklyn', 'kings county'] },
  { county: 'Bronx', terms: ['bronx'] },
  { county: 'Richmond', terms: ['staten island', 'richmond county'] },
  { county: 'Queens', terms: ['queens', 'jamaica, ny', 'astoria', 'flushing', 'long island city'] },
];

/**
 * Resolve filing venue from a free-text address.
 * ZIP is authoritative; borough keywords are a medium-confidence fallback.
 */
export function resolveVenue(address: string | null | undefined): VenueResult {
  if (!address || !address.trim()) {
    return { county: null, borough: null, inNYC: false, confidence: 'none', note: 'No debtor address on file — county could not be determined. Verify the correct venue before filing.' };
  }
  const a = address.toLowerCase();

  // 1. ZIP (authoritative).
  const zipMatch = a.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) {
    const county = countyFromZip(zipMatch[1]);
    if (county) {
      return { county, borough: COURT_ADDRESSES[county].borough, inNYC: true, confidence: 'high', note: `Venue resolved to ${county} County (${COURT_ADDRESSES[county].borough}) from ZIP ${zipMatch[1]}.` };
    }
    // A ZIP was present but it is not within NYC.
    const looksNY = /\bny\b|new york/.test(a);
    return {
      county: null, borough: null, inNYC: false, confidence: 'none',
      note: looksNY
        ? `Address ZIP ${zipMatch[1]} is in New York State but outside the five NYC boroughs. This tool's court forms target NYC courts — confirm the correct county/court before filing.`
        : `Address ZIP ${zipMatch[1]} does not appear to be in New York City. This tool only prepares NYC court filings — confirm jurisdiction before proceeding.`,
    };
  }

  // 2. Borough keyword (medium confidence — no ZIP to confirm).
  for (const { county, terms } of BOROUGH_KEYWORDS) {
    if (terms.some((t) => a.includes(t))) {
      return { county, borough: COURT_ADDRESSES[county].borough, inNYC: true, confidence: 'medium', note: `Venue inferred as ${county} County from the address text. No ZIP found — verify the county before filing.` };
    }
  }

  return { county: null, borough: null, inNYC: false, confidence: 'none', note: 'Could not determine an NYC county from the debtor address. Verify the correct venue before filing.' };
}

/** County to inject into a document, or an explicit verify-placeholder when unknown. */
export function countyForDocument(address: string | null | undefined): { county: string; civilAddr: string; supremeAddr: string; venue: VenueResult } {
  const venue = resolveVenue(address);
  const county = venue.county ?? '[COUNTY — VERIFY BEFORE FILING]';
  const addrs = venue.county ? COURT_ADDRESSES[venue.county] : null;
  return {
    county,
    civilAddr: addrs?.civil ?? '[COURTHOUSE ADDRESS — VERIFY COUNTY FIRST]',
    supremeAddr: addrs?.supreme ?? '[COURTHOUSE ADDRESS — VERIFY COUNTY FIRST]',
    venue,
  };
}
