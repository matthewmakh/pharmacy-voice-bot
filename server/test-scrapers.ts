/**
 * Scraper health-check script.
 * Run: npx ts-node test-scrapers.ts
 * Tests each scraper against live endpoints with known-good + edge-case inputs.
 */

import 'dotenv/config';

// ─── ACRIS ────────────────────────────────────────────────────────────────────
async function testACRIS() {
  const ACRIS_URL = 'https://data.cityofnewyork.us/resource/636b-3b5g.json';

  const tests = [
    { name: 'Known company (VERIZON)', query: "upper(name)='VERIZON'" },
    { name: 'Common name with apostrophe (O\'NEIL)', query: "upper(name)='O''NEIL'" },
    { name: 'Empty result (unlikely name)', query: "upper(name)='ZZZNOTACOMPANY999'" },
  ];

  for (const t of tests) {
    try {
      const url = `${ACRIS_URL}?$where=${encodeURIComponent(t.query)}&$limit=5`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await r.json() as unknown[];
      console.log(`ACRIS [${t.name}]: HTTP ${r.status}, ${data.length} record(s)`);
    } catch (e) {
      console.log(`ACRIS [${t.name}]: ERROR — ${e}`);
    }
  }
}

// ─── NYS Entity ───────────────────────────────────────────────────────────────
async function testNYSEntity() {
  const BASE = 'https://apps.dos.ny.gov/PublicInquiryWeb/api/PublicInquiry';
  const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://apps.dos.ny.gov',
    'Referer': 'https://apps.dos.ny.gov/publicInquiry/',
  };

  const tests = [
    { name: 'Search known entity (GOOGLE)', searchValue: 'GOOGLE LLC' },
    { name: 'Search dissolved entity (test)', searchValue: 'KODAK' },
    { name: 'Empty result', searchValue: 'ZZZNOENTITY999XYZ' },
    { name: 'Short/ambiguous name', searchValue: 'ABC' },
  ];

  for (const t of tests) {
    try {
      const payload = {
        searchValue: t.searchValue,
        searchByTypeIndicator: 'EntityName',
        searchExpressionIndicator: 'BeginsWith',
        entityStatusIndicator: 'AllStatuses',
        entityTypeIndicator: ['Corporation', 'LimitedLiabilityCompany', 'LimitedPartnership', 'LimitedLiabilityPartnership'],
        listPaginationInfo: { listStartRecord: 1, listEndRecord: 10 },
      };
      const r = await fetch(`${BASE}/GetComplexSearchMatchingEntities`, {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await r.json() as Record<string, unknown>;
      const list = (body['entitySearchResultList'] ?? body['results'] ?? body) as unknown[];
      const count = Array.isArray(list) ? list.length : '(unexpected shape)';
      const firstStatus = Array.isArray(list) && list.length > 0
        ? (list[0] as Record<string, unknown>)['entityStatus'] : 'N/A';
      console.log(`NYS Entity [${t.name}]: HTTP ${r.status}, ${count} result(s), first status=${firstStatus}`);

      // If we got results, test the detail endpoint too
      if (Array.isArray(list) && list.length > 0 && t.name.includes('GOOGLE')) {
        const first = list[0] as Record<string, unknown>;
        const dosId = first['dosID'] ?? first['dosId'];
        const name  = first['entityName'];
        const dr = await fetch(`${BASE}/GetEntityRecordByID`, {
          method: 'POST', headers: HEADERS,
          body: JSON.stringify({ SearchID: String(dosId), EntityName: String(name), AssumedNameFlag: 'false' }),
          signal: AbortSignal.timeout(12_000),
        });
        const detail = await dr.json() as Record<string, unknown>;
        const agent = (detail['registeredAgent'] as Record<string,unknown> | null)?.['name'] ?? 'none';
        const ceo   = (detail['ceo'] as Record<string,unknown> | null)?.['name'] ?? 'none';
        console.log(`  Detail: HTTP ${dr.status}, registeredAgent=${agent}, ceo=${ceo}`);
        console.log(`  Raw detail keys: ${Object.keys(detail).join(', ')}`);
      }
    } catch (e) {
      console.log(`NYS Entity [${t.name}]: ERROR — ${e}`);
    }
  }
}

// ─── NYC Courts ───────────────────────────────────────────────────────────────
async function testNYCourts() {
  const MAIN_URL   = 'https://iapps.courts.state.ny.us/webcivil/FCASMain';
  const SEARCH_URL = 'https://iapps.courts.state.ny.us/webcivil/FCASSearch';
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Test 1: Can we load the main page?
  try {
    const r = await fetch(MAIN_URL, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    const html = await r.text();
    const cookies = r.headers.get('set-cookie') ?? '';
    const hasForm = html.includes('<form');
    const hasCaptcha = /captcha|recaptcha/i.test(html);
    console.log(`NYCourts [Load main page]: HTTP ${r.status}, hasForm=${hasForm}, hasCaptcha=${hasCaptcha}, cookies=${cookies.length > 0}`);
    console.log(`  Page snippet: ${html.slice(0, 200).replace(/\s+/g, ' ')}`);

    // Test 2: What form fields exist?
    const inputMatches = [...html.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*>/gi)];
    const fieldNames = inputMatches.map(m => m[1]);
    console.log(`  Form fields found: ${fieldNames.join(', ') || 'NONE'}`);

    // Test 3: Try a POST search with our current params
    const params = new URLSearchParams({
      court_type: 'NYC',
      param_type: 'D',
      param_name: 'SMITH',
      param_firstName: '',
      submit: 'Find',
    });
    const sr = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies, 'Referer': MAIN_URL },
      body: params.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const sHtml = await sr.text();
    const hasTable = sHtml.includes('<table');
    const hasNoResults = /no cases|no records|0 case/i.test(sHtml);
    const hasCaptchaResult = /captcha|recaptcha/i.test(sHtml);
    console.log(`NYCourts [POST search SMITH]: HTTP ${sr.status}, hasTable=${hasTable}, noResults=${hasNoResults}, captcha=${hasCaptchaResult}`);
    console.log(`  Response snippet: ${sHtml.slice(0, 300).replace(/\s+/g, ' ')}`);
    if (hasTable) {
      // Try to find row data
      const rowCount = (sHtml.match(/<tr/gi) ?? []).length;
      console.log(`  Table rows found: ${rowCount}`);
    }
  } catch (e) {
    console.log(`NYCourts: ERROR — ${e}`);
  }
}

// ─── NYS UCC portal (no captcha solve — just check if page loads and inspect form) ───
async function testNYSUCCPortal() {
  const SEARCH_PAGE = 'https://appext20.dos.ny.gov/pls/ucc_public/web_search_main';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  try {
    const r = await fetch(SEARCH_PAGE, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await r.text();
    const hasCaptcha = /captcha|recaptcha/i.test(html);
    const hasForm    = html.includes('<form');

    // Extract sitekey
    const siteKeyMatch = /data-sitekey=["']([^"']+)["']/i.exec(html)
      ?? /sitekey['":\s]+["']([A-Za-z0-9_\-]{30,})["']/i.exec(html);
    const siteKey = siteKeyMatch?.[1] ?? 'NOT FOUND';

    // Extract form action
    const actionMatch = /<form[^>]+action=["']([^"']+)["']/i.exec(html);
    const formAction = actionMatch?.[1] ?? 'NOT FOUND';

    // Extract all input field names
    const inputMatches = [...html.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*>/gi)];
    const allFields = inputMatches.map(m => m[1]);
    const hiddenFields = [...html.matchAll(/<input[^>]+type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*/gi)].map(m => m[1]);
    const textFields  = [...html.matchAll(/<input[^>]+type=["']text["'][^>]*name=["']([^"']+)["'][^>]*/gi)].map(m => m[1]);
    const textFields2 = [...html.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]*type=["']text["'][^>]*/gi)].map(m => m[1]);

    // Find select dropdowns too
    const selectMatches = [...html.matchAll(/<select[^>]+name=["']([^"']+)["'][^>]*/gi)].map(m => m[1]);

    console.log(`NYSUCC [Load portal]: HTTP ${r.status}, hasForm=${hasForm}, hasCaptcha=${hasCaptcha}`);
    console.log(`  reCAPTCHA siteKey: ${siteKey}`);
    console.log(`  Form action: ${formAction}`);
    console.log(`  All input names: ${allFields.join(', ') || 'NONE'}`);
    console.log(`  Hidden fields: ${hiddenFields.join(', ') || 'NONE'}`);
    console.log(`  Text fields: ${[...new Set([...textFields, ...textFields2])].join(', ') || 'NONE'}`);
    console.log(`  Select fields: ${selectMatches.join(', ') || 'NONE'}`);
    console.log(`  Page snippet: ${html.slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch (e) {
    console.log(`NYSUCC [Load portal]: ERROR — ${e}`);
  }
}

// ─── 2captcha balance check ───────────────────────────────────────────────────
async function testCaptchaBalance() {
  const key = process.env.CAPTCHA_API_KEY;
  if (!key) { console.log('2captcha: CAPTCHA_API_KEY not set'); return; }
  try {
    const r = await fetch(`https://2captcha.com/res.php?key=${key}&action=getbalance&json=1`);
    const body = await r.json() as { status: number; request: string };
    if (body.status === 1) {
      console.log(`2captcha: Balance = $${body.request}`);
    } else {
      console.log(`2captcha: Error = ${body.request}`);
    }
  } catch (e) {
    console.log(`2captcha: ERROR — ${e}`);
  }
}

// ─── Run all tests ────────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(60));
  console.log('SCRAPER HEALTH CHECK');
  console.log('='.repeat(60));

  console.log('\n── 2captcha balance ──');
  await testCaptchaBalance();

  console.log('\n── ACRIS (NYC real property) ──');
  await testACRIS();

  console.log('\n── NYS Entity (DOS API) ──');
  await testNYSEntity();

  console.log('\n── NYC Civil Courts (iApps) ──');
  await testNYCourts();

  console.log('\n── NYS UCC portal (form inspection) ──');
  await testNYSUCCPortal();

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
})();
