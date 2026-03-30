/**
 * Scraper diagnostic — run this locally to debug failing scrapers.
 * Prints raw HTTP status codes, response snippets, and detected field names
 * so you can pinpoint exactly what each service is returning.
 *
 * Usage:  npx ts-node diagnose.ts
 */

import 'dotenv/config';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

function sep(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function snip(text: string, n = 600) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + ' …[truncated]' : t;
}

// ─── 1. ACRIS ─────────────────────────────────────────────────────────────────
async function diagACRIS() {
  sep('ACRIS — NYC Open Data');
  const url = 'https://data.cityofnewyork.us/resource/636b-3b5g.json?$where=upper(name)%3D\'CITIBANK NA\'&$select=count(*)';
  console.log('URL:', url);
  const t = Date.now();
  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`Status: ${resp.status}  Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
    const body = await resp.text();
    console.log('Body:', snip(body));
  } catch (e) {
    console.log(`ERROR after ${((Date.now()-t)/1000).toFixed(1)}s:`, e instanceof Error ? e.message : String(e));
  }
}

// ─── 2. ECB ───────────────────────────────────────────────────────────────────
async function diagECB() {
  sep('ECB — NYC Open Data dataset discovery');

  const CANDIDATE_IDS = [
    '6bgk-in4p',
    'nhy8-p4td',
    'jz4z-kudi',
    'erm5-jryu',
    'twhy-dzjp',
    'p937-wjvj',
  ];

  let foundUrl: string | null = null;
  for (const id of CANDIDATE_IDS) {
    const url = `https://data.cityofnewyork.us/resource/${id}.json`;
    try {
      const resp = await fetch(`${url}?$limit=1`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      });
      console.log(`  ${id}  → ${resp.status}`);
      if (resp.ok) { foundUrl = url; break; }
    } catch (e) {
      console.log(`  ${id}  → ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!foundUrl) {
    console.log('\nAll known IDs failed — trying catalog search...');
    try {
      const catResp = await fetch('https://data.cityofnewyork.us/api/catalog/v1?q=OATH+ECB+violations&limit=5', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`Catalog status: ${catResp.status}`);
      if (catResp.ok) {
        const cat = await catResp.json() as { results?: Array<{ resource: { id: string; name: string } }> };
        for (const r of cat.results ?? []) {
          console.log(`  catalog hit: ${r.resource.id}  "${r.resource.name}"`);
          const url = `https://data.cityofnewyork.us/resource/${r.resource.id}.json`;
          const check = await fetch(`${url}?$limit=1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
          if (check.ok) { foundUrl = url; break; }
        }
      }
    } catch (e) {
      console.log('Catalog ERROR:', e instanceof Error ? e.message : String(e));
    }
  }

  if (!foundUrl) { console.log('\nNo working ECB dataset found.'); return; }
  console.log('\nFound dataset:', foundUrl);

  // Fetch one record to see field names
  const sampleResp = await fetch(`${foundUrl}?$limit=1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
  const sample = await sampleResp.json() as Record<string, unknown>[];
  if (sample.length) {
    console.log('Fields in first record:', Object.keys(sample[0]).join(', '));
    console.log('First record:', JSON.stringify(sample[0]).slice(0, 400));
  } else {
    console.log('Sample returned 0 records.');
  }

  // Try the count query with a detected field
  const fields = sample.length ? Object.keys(sample[0]) : [];
  const nameField = fields.find(k => k.includes('respondent') || k === 'business_name' || k === 'name') ?? 'respondent_name';
  console.log(`\nDetected name field: "${nameField}"`);

  const where = `upper(${nameField})='DUNKIN DONUTS'`;
  const countUrl = `${foundUrl}?$where=${encodeURIComponent(where)}&$select=count(*)`;
  console.log('Count URL:', countUrl);
  try {
    const countResp = await fetch(countUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    console.log(`Count status: ${countResp.status}`);
    const body = await countResp.text();
    console.log('Count body:', snip(body, 200));
  } catch (e) {
    console.log('Count ERROR:', e instanceof Error ? e.message : String(e));
  }
}

// ─── 3. Courts ────────────────────────────────────────────────────────────────
async function diagCourts() {
  sep('NYC Courts — iApps');
  const MAIN_URL   = 'https://iapps.courts.state.ny.us/webcivil/FCASMain';
  const SEARCH_URL = 'https://iapps.courts.state.ny.us/webcivil/FCASSearch';

  // Step 1: GET main page
  console.log('GET', MAIN_URL);
  let cookies = '';
  let hiddenInputs: Record<string, string> = {};
  try {
    const resp = await fetch(MAIN_URL, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    console.log('Status:', resp.status);
    const setCookie = resp.headers.get('set-cookie') ?? '';
    cookies = setCookie.split(';')[0];
    console.log('Set-Cookie (first):', setCookie.slice(0, 100));
    const html = await resp.text();
    console.log('Body snippet:', snip(html.slice(0, 1000)));

    // Extract hidden inputs
    const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const nameM  = /name=["']([^"']*)["']/i.exec(m[0]);
      const valueM = /value=["']([^"']*)["']/i.exec(m[0]);
      if (nameM?.[1]) hiddenInputs[nameM[1]] = valueM?.[1] ?? '';
    }
    console.log('Hidden inputs found:', JSON.stringify(hiddenInputs).slice(0, 300));

    // Also show all form field names
    const inputNames: string[] = [];
    const inputRe = /<input[^>]+name=["']([^"']*)["']/gi;
    let im;
    while ((im = inputRe.exec(html)) !== null) inputNames.push(im[1]);
    console.log('All input names:', inputNames.join(', '));

    // Show select/option fields
    const selectRe = /<select[^>]+name=["']([^"']*)["']/gi;
    let sm;
    const selectNames: string[] = [];
    while ((sm = selectRe.exec(html)) !== null) selectNames.push(sm[1]);
    console.log('Select names:', selectNames.join(', '));

  } catch (e) {
    console.log('GET ERROR:', e instanceof Error ? e.message : String(e));
    return;
  }

  // Step 2: POST search
  console.log('\nPOST', SEARCH_URL);
  const form = new URLSearchParams({
    ...hiddenInputs,
    court_type: 'NYC',
    param_type: 'D',
    param_name: 'CITIBANK NA',
    param_firstName: '',
    submit: 'Find',
  });
  console.log('POST body:', form.toString().slice(0, 300));
  try {
    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': MAIN_URL,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    console.log('Status:', resp.status);
    const body = await resp.text();
    console.log('Body snippet:', snip(body.slice(0, 1000)));
  } catch (e) {
    console.log('POST ERROR:', e instanceof Error ? e.message : String(e));
  }
}

// ─── 4. UCC ───────────────────────────────────────────────────────────────────
async function diagUCC() {
  sep('NYS UCC — portal reachability');
  const candidates = [
    'https://appext20.dos.ny.gov/pls/ucc_public/web_search_main',
    'https://appext20.dos.ny.gov/pls/ucc_public/web_uccart',
    'https://apps.dos.ny.gov/pls/ucc_public/web_search_main',
    'https://apps.dos.ny.gov/uccsearch/web_search_main',
    'https://www.dos.ny.gov/corps/ucc_public/web_search_main',
    // Try the main DOS site to see if there's a UCC section
    'https://apps.dos.ny.gov/',
    'https://appext20.dos.ny.gov/',
  ];
  for (const url of candidates) {
    const t = Date.now();
    try {
      const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
      const location = resp.headers.get('location') ?? '';
      console.log(`  ${resp.status}  ${((Date.now()-t)/1000).toFixed(1)}s  ${url}${location ? `  → ${location}` : ''}`);
      if (resp.status < 400) {
        const body = await resp.text();
        console.log('    Body snippet:', snip(body.slice(0, 200), 200));
      }
    } catch (e) {
      console.log(`  ERR  ${((Date.now()-t)/1000).toFixed(1)}s  ${url}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ─── 5. PACER ─────────────────────────────────────────────────────────────────
async function diagPACER() {
  sep('PACER — auth + PCL form');

  const LOGIN_URL = 'https://pacer.login.uscourts.gov/csologin/login.jsf';
  const PCL_SEARCH = 'https://pcl.uscourts.gov/pcl/pages/search/find.jsf';

  // Step 1: GET login page
  console.log('GET', LOGIN_URL);
  const cookies: string[] = [];
  let viewState = '';
  let hiddens: Record<string, string> = {};
  try {
    const resp = await fetch(LOGIN_URL, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    console.log('Status:', resp.status);
    const setCookies = typeof (resp.headers as any).getSetCookie === 'function'
      ? (resp.headers as any).getSetCookie() as string[]
      : [resp.headers.get('set-cookie') ?? ''].filter(Boolean);
    console.log('Cookies set:', setCookies.map((c: string) => c.split(';')[0]).join(', '));
    for (const c of setCookies) cookies.push(c.split(';')[0]);
    const html = await resp.text();

    // Extract ViewState
    const vsM = /name=["']javax\.faces\.ViewState["'][^>]*value=["']([^"']+)["']/i.exec(html)
      ?? /value=["']([^"']+)["'][^>]*name=["']javax\.faces\.ViewState["']/i.exec(html);
    viewState = vsM?.[1] ?? '';
    console.log('ViewState (first 30):', viewState.slice(0, 30));

    const re = /<input[^>]+type=["']hidden["'][^>]*/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const nameM  = /name=["']([^"']*)["']/i.exec(m[0]);
      const valueM = /value=["']([^"']*)["']/i.exec(m[0]);
      if (nameM?.[1]) hiddens[nameM[1]] = valueM?.[1] ?? '';
    }
    console.log('Hidden inputs:', Object.keys(hiddens).join(', '));
  } catch (e) {
    console.log('GET login ERROR:', e instanceof Error ? e.message : String(e));
    return;
  }

  // Step 2: POST login
  const username = process.env.PACER_USERNAME ?? '';
  const password = process.env.PACER_PASSWORD ?? '';
  console.log(`\nPOST login as "${username}"`);
  const loginForm = new URLSearchParams({
    ...hiddens,
    'loginForm:loginName': username,
    'loginForm:password': password,
    'loginForm:fbtnLogin': 'Login',
    'loginForm:clientCode': '',
    'javax.faces.ViewState': viewState,
    'javax.faces.source': 'loginForm:fbtnLogin',
    'javax.faces.partial.event': 'click',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': '@all',
    'javax.faces.behavior.event': 'action',
    'javax.faces.partial.ajax': 'true',
  });
  try {
    const resp = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': LOGIN_URL,
        'Cookie': cookies.join('; '),
        'X-Requested-With': 'XMLHttpRequest',
        'Faces-Request': 'partial/ajax',
      },
      body: loginForm.toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    console.log('Status:', resp.status, '  URL:', resp.url);
    const setCookies = typeof (resp.headers as any).getSetCookie === 'function'
      ? (resp.headers as any).getSetCookie() as string[]
      : [resp.headers.get('set-cookie') ?? ''].filter(Boolean);
    console.log('New cookies:', setCookies.map((c: string) => c.split(';')[0]).join(', '));
    const body = await resp.text();
    console.log('Body:', snip(body, 800));
  } catch (e) {
    console.log('POST login ERROR:', e instanceof Error ? e.message : String(e));
    return;
  }

  // Step 3: GET PCL search page
  console.log('\nGET', PCL_SEARCH);
  try {
    const resp = await fetch(PCL_SEARCH, {
      headers: { ...BROWSER_HEADERS, Cookie: cookies.join('; ') },
      signal: AbortSignal.timeout(15_000),
    });
    console.log('Status:', resp.status);
    const html = await resp.text();
    // Show all input names on PCL form
    const inputNames: string[] = [];
    const inputRe = /<input[^>]+name=["']([^"']*)["']/gi;
    let im;
    while ((im = inputRe.exec(html)) !== null) inputNames.push(im[1]);
    console.log('PCL form inputs:', inputNames.join(', '));
    console.log('PCL body snippet:', snip(html.slice(0, 800)));
  } catch (e) {
    console.log('GET PCL ERROR:', e instanceof Error ? e.message : String(e));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('SCRAPER DIAGNOSTIC', new Date().toISOString());
  console.log('Running from IP: (your local residential IP)');
  await diagACRIS();
  await diagECB();
  await diagCourts();
  await diagUCC();
  await diagPACER();
  console.log('\n\nDone.');
})();
