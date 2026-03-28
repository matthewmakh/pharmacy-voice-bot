// NYC Civil Court case history lookup via WebCivil (iapps.courts.state.ny.us)
// Searches the NY eCourts CCCS (Civil Court Case Search) by defendant party name.
//
// NOTE: This is a web scraper against a public government portal. It may require
// parameter adjustments if the court's interface changes. Test carefully before
// deploying. The URL and parameters below are based on the WebCivil FCAS interface.

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

// Parse HTML table rows from iApps search results
function parseCourtTable(html: string): CourtCaseRecord[] {
  const cases: CourtCaseRecord[] = [];
  // Match table rows in the results table
  const rowPattern = /<tr[^>]*class="[^"]*odd|even[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      // Strip HTML tags and decode entities
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }

    // iApps table structure (approximate): index, filedDate, plaintiff, defendant, type, status, court
    if (cells.length >= 5) {
      cases.push({
        caseIndex: cells[0] || '',
        filedDate: cells[1] || null,
        plaintiff: cells[2] || '',
        defendant: cells[3] || '',
        caseType: cells[4] || '',
        status: cells[5] || '',
        court: cells[6] || '',
        amount: cells[7] || null,
      });
    }
  }

  return cases;
}

export async function lookupNYCourtHistory(partyName: string): Promise<CourtHistoryResult> {
  const searchedName = partyName.trim().toUpperCase();

  // WebCivil CCCS party search endpoint
  // POST parameters based on the iApps.courts.state.ny.us WebCivil FCAS interface.
  // If results come back empty or with errors, inspect the form in a browser and
  // update these parameters to match the actual form field names.
  const SEARCH_URL = 'https://iapps.courts.state.ny.us/webcivil/FCASSearch';

  const formParams = new URLSearchParams({
    // Party search by name — "D" for defendant search
    court_type: 'NYC',
    param_type: 'D',
    param_name: searchedName,
    param_firstName: '',
    submit: 'Find',
  });

  try {
    // Step 1: Fetch the main page to establish session cookies
    const initHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const initResp = await fetch('https://iapps.courts.state.ny.us/webcivil/FCASMain', {
      headers: initHeaders,
      signal: AbortSignal.timeout(15000),
    });

    const cookies = initResp.headers.get('set-cookie') || '';

    // Step 2: POST the search
    const searchResp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        ...initHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://iapps.courts.state.ny.us/webcivil/FCASMain',
        'Cookie': cookies,
      },
      body: formParams.toString(),
      signal: AbortSignal.timeout(20000),
    });

    if (!searchResp.ok) {
      return {
        found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
        cases: [], searchedName,
        note: '',
        error: `Court search returned ${searchResp.status}`,
        scraperNote: 'Verify POST parameters match the actual court form via browser dev tools.',
      };
    }

    const html = await searchResp.text();

    // Check for "no results" indicator
    if (html.includes('No cases found') || html.includes('no records') || html.includes('0 cases')) {
      return {
        found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
        cases: [], searchedName,
        note: 'No NYC Civil Court cases found for this name. This search covers NYC Civil Court cases only — does not include Supreme Court, federal court, or out-of-state cases.',
      };
    }

    // Check for unexpected redirects (login page, error page)
    if (html.includes('login') || html.includes('error') || !html.includes('<table') || html.length < 500) {
      return {
        found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
        cases: [], searchedName,
        note: '',
        error: 'Court search returned an unexpected response. The scraper may need parameter updates.',
        scraperNote: 'Check POST parameters against the live court interface at iapps.courts.state.ny.us/webcivil/FCASMain.',
      };
    }

    const cases = parseCourtTable(html);
    const asDefendant = cases.filter(c =>
      c.defendant.toLowerCase().includes(partyName.toLowerCase().slice(0, 6))
    ).length;
    const asPlaintiff = cases.filter(c =>
      c.plaintiff.toLowerCase().includes(partyName.toLowerCase().slice(0, 6))
    ).length;

    let note = '';
    if (cases.length === 0) {
      note = 'No NYC Civil Court cases parsed from results. The court may have returned results in an unexpected format.';
    } else if (asDefendant > 3) {
      note = `${cases.length} NYC Civil Court case(s) found. Debtor has been sued ${asDefendant} time(s) as a defendant — suggests a pattern of non-payment or disputes. Consider QUICK_ESCALATION: serial defendants often require firm action.`;
    } else if (asDefendant > 0) {
      note = `${cases.length} NYC Civil Court case(s) found (${asDefendant} as defendant). Check case statuses below — prior judgments indicate some ability to be collected from; defaults/dismissals may suggest insolvency.`;
    } else {
      note = `${cases.length} case(s) found in NYC Civil Court for this name. None clearly show this party as a defendant — verify manually at iApps.`;
    }

    return { found: cases.length > 0, totalCases: cases.length, asDefendant, asPlaintiff, cases, searchedName, note };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0,
      cases: [], searchedName,
      note: '',
      error: `Court lookup failed: ${msg}`,
      scraperNote: 'If this is a timeout, the iApps server may be slow or blocking automated requests. Try again or look up manually.',
    };
  }
}
