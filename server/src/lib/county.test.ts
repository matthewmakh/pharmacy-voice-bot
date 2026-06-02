import { describe, it, expect } from 'vitest';
import { resolveVenue } from './county';

describe('resolveVenue', () => {
  it('resolves Manhattan ZIPs to New York County (not the old Queens default)', () => {
    // 10018 / 10128 / 10280 all previously fell through to Queens.
    expect(resolveVenue('350 5th Ave, New York, NY 10018').county).toBe('New York');
    expect(resolveVenue('1 E 70th St, New York, NY 10021').county).toBe('New York');
    expect(resolveVenue('200 Rector Pl, New York, NY 10280').county).toBe('New York');
  });

  it('resolves the other boroughs by ZIP', () => {
    expect(resolveVenue('141 Livingston St, Brooklyn, NY 11201').county).toBe('Kings');
    expect(resolveVenue('89-17 Sutphin Blvd, Jamaica, NY 11435').county).toBe('Queens');
    expect(resolveVenue('851 Grand Concourse, Bronx, NY 10451').county).toBe('Bronx');
    expect(resolveVenue('927 Castleton Ave, Staten Island, NY 10310').county).toBe('Richmond');
  });

  it('does NOT silently default out-of-NYC addresses to a borough', () => {
    const albany = resolveVenue('1 Tower Pl, Albany, NY 12203');
    expect(albany.county).toBeNull();
    expect(albany.inNYC).toBe(false);

    const cali = resolveVenue('1 Market St, San Francisco, CA 94105');
    expect(cali.county).toBeNull();
    expect(cali.inNYC).toBe(false);
  });

  it('flags a missing address instead of guessing', () => {
    const r = resolveVenue('');
    expect(r.county).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('falls back to borough keywords (medium confidence) when no ZIP', () => {
    const r = resolveVenue('Somewhere in Brooklyn');
    expect(r.county).toBe('Kings');
    expect(r.confidence).toBe('medium');
  });
});
