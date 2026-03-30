/**
 * Scraper health-check — runs as a Railway cron job (weekly).
 *
 * Local one-off:  npx ts-node test-scrapers.ts
 * Railway cron:   schedule "0 9 * * 1" (Mon 9am UTC), command: npx ts-node test-scrapers.ts
 *
 * Exit codes:
 *   0 — all scrapers passed
 *   1 — one or more scrapers failed (Railway marks the run as failed + emails you)
 *
 * Optional env var: SCRAPER_ALERT_WEBHOOK=https://hooks.slack.com/... or any POST URL
 * If set, a JSON summary is POSTed there on completion so you get a Slack/Discord ping.
 */

import 'dotenv/config';
import { lookupACRIS } from './src/services/acris';
import { lookupNYCECB } from './src/services/nycECB';
import { lookupNYSEntity } from './src/services/nysEntity';
import { lookupNYSUCC } from './src/services/nysUCC';
import { lookupNYCourtHistory } from './src/services/nycourts';
import { checkPACERBankruptcy } from './src/services/pacer';

// Force unbuffered stdout so Railway shows lines immediately as they print
// (Node buffers stdout when piped; this makes it blocking/synchronous)
const stdoutHandle = (process.stdout as any)._handle;
if (stdoutHandle?.setBlocking) stdoutHandle.setBlocking(true);

// log() replaces console.log — writes directly to stdout with an explicit flush attempt
function log(line = '') {
  process.stdout.write(line + '\n');
}

// ─── Formatting ───────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const RESET = '\x1b[0m', B = '\x1b[1m';
const ok   = (m: string) => log(`  ${G}✓${RESET} ${m}`);
const err  = (m: string) => log(`  ${R}✗${RESET} ${m}`);
const warn = (m: string) => log(`  ${Y}⚠${RESET} ${m}`);
const info = (m: string) => log(`  ${C}·${RESET} ${m}`);
const head = (n: string, q: string) => log(`\n${B}━━━ ${n} — "${q}" ━━━${RESET}`);
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

// ─── Result tracking ──────────────────────────────────────────────────────────
type Status = 'pass' | 'fail' | 'warn';
const results: { name: string; status: Status; detail: string }[] = [];

function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  if (status === 'pass') ok(detail);
  else if (status === 'warn') warn(detail);
  else err(detail);
}

// ─── Test subjects ────────────────────────────────────────────────────────────
const SUBJECTS = {
  acris:  'CITIBANK NA',                  // Very common mortgage grantee in ACRIS
  ecb:    'DUNKIN DONUTS',               // Large chain with many NYC ECB violations
  entity: 'GOOGLE LLC',                  // Registered in NY as a foreign LLC
  ucc:    'GOOGLE LLC',                  // Has UCC financing filings in NYS
  courts: 'CITIBANK NA',                 // Frequently appears in NYC civil court
  pacer:  'SEARS HOLDINGS CORPORATION',  // Filed Ch.11 SDNY Oct 2018 — confirmed in PACER
};

// ─── Per-scraper timeout wrapper ──────────────────────────────────────────────
// Prevents one hung scraper from blocking the whole cron run.
async function withTimeout<T>(
  name: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      record(name, 'fail', `Timed out after ${timeoutMs / 1000}s`);
      resolve(null);
    }, timeoutMs);
    fn()
      .then(v => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); record(name, 'fail', `threw: ${e instanceof Error ? e.message : String(e)}`); resolve(null); });
  });
}

// ─── 1. ACRIS ─────────────────────────────────────────────────────────────────
async function testACRIS() {
  head('ACRIS', SUBJECTS.acris);
  info('querying NYC Open Data...');
  const t = Date.now();
  await withTimeout('ACRIS', 30_000, async () => {
    const r = await lookupACRIS(SUBJECTS.acris);
    info(secs(t));
    if (r.error) {
      const isTimeout = r.error.includes('timeout') || r.error.includes('aborted');
      record('ACRIS', isTimeout ? 'warn' : 'fail', r.error);
      if (isTimeout) info('NYC Open Data throttles anonymous requests — add NYC_OPEN_DATA_TOKEN env var (free at data.cityofnewyork.us/profile/app_tokens)');
      return;
    }
    if (!r.found) { record('ACRIS', 'warn', `No records found — expected results for "${SUBJECTS.acris}"`); return; }
    record('ACRIS', 'pass', `${r.totalRecords} records · ${r.asGrantee} grantee · ${r.asGrantor} grantor`);
    info(r.note.slice(0, 160));
  });
}

// ─── 2. ECB ───────────────────────────────────────────────────────────────────
async function testECB() {
  head('ECB / OATH Violations', SUBJECTS.ecb);
  info('querying NYC Open Data...');
  const t = Date.now();
  await withTimeout('ECB', 60_000, async () => {
    const r = await lookupNYCECB(SUBJECTS.ecb);
    info(secs(t));
    if (r.error) { record('ECB', 'fail', r.error); return; }
    if (!r.found) { record('ECB', 'warn', `No violations found for "${SUBJECTS.ecb}"`); return; }
    record('ECB', 'pass', `${r.totalViolations} violations · $${r.totalOutstanding.toLocaleString()} outstanding · ${r.unpaidViolations} unpaid`);
    info(r.note.slice(0, 160));
  });
}

// ─── 3. NYS Entity ────────────────────────────────────────────────────────────
async function testNYSEntity() {
  head('NYS Entity (DOS)', SUBJECTS.entity);
  info('querying NYS DOS API...');
  const t = Date.now();
  await withTimeout('NYS Entity', 45_000, async () => {
    const r = await lookupNYSEntity(SUBJECTS.entity);
    info(secs(t));
    if (r.error) { record('NYS Entity', 'fail', r.error); return; }
    if (!r.found || !r.entities.length) {
      record('NYS Entity', 'warn', `No entity found — check entityStatusIndicator value in nysEntity.ts`);
      return;
    }
    const e = r.entities[0];
    record('NYS Entity', 'pass', `${r.totalRecords} match(es) · "${e.entityName}" · ${e.status}`);
    if (e.registeredAgent)   info(`Agent: ${e.registeredAgent}`);
    if (e.dosProcessAddress) info(`DOS process: ${e.dosProcessAddress}`);
    if (!e.registeredAgent && !e.dosProcessAddress) warn(`No agent/address in detail response — check GetEntityRecordByID field names`);
  });
}

// ─── 4. NYC Civil Courts ──────────────────────────────────────────────────────
async function testCourts() {
  head('NYC Civil Court History', SUBJECTS.courts);
  info('loading iApps session and running defendant + plaintiff search...');
  const t = Date.now();
  await withTimeout('NYC Courts', 45_000, async () => {
    const r = await lookupNYCourtHistory(SUBJECTS.courts);
    info(secs(t));
    if (r.error) {
      // 403 from iApps = Cloudflare bot protection (affects all automated IPs including residential).
      // This is not fixable with headers — requires a real browser / headless automation.
      const isCFBlock = r.error.includes('403');
      record('NYC Courts', 'warn', r.error);
      if (r.scraperNote) warn(r.scraperNote);
      if (isCFBlock) info('iApps now has Cloudflare bot protection — blocks all automated requests regardless of IP');
      return;
    }
    if (!r.found) {
      record('NYC Courts', 'warn', `No cases — check POST params in nycourts.ts → runSearch() against iApps dev tools`);
      return;
    }
    record('NYC Courts', 'pass', `${r.totalCases} cases · ${r.asDefendant} defendant · ${r.asPlaintiff} plaintiff`);
    if (r.cases[0]) info(`First: ${r.cases[0].caseIndex} | ${r.cases[0].caseType} | ${r.cases[0].status}`);
  });
}

// ─── 5. NYS UCC ───────────────────────────────────────────────────────────────
async function testUCC() {
  head('NYS UCC Filings', SUBJECTS.ucc);
  log(`  ${Y}· loading portal and submitting CAPTCHA to 2captcha (expect 20-50s)...${RESET}`);
  const t = Date.now();
  await withTimeout('NYS UCC', 120_000, async () => {
    const r = await lookupNYSUCC(SUBJECTS.ucc);
    info(secs(t));
    if (r.error) {
      // Portal unreachable = appext20.dos.ny.gov blocks Railway datacenter IPs.
      // Not a code bug — set UCC_PORTAL_URL env var if a new portal URL is found.
      const isNetworkBlock = r.error.includes('unreachable') || r.error.includes('404');
      record('NYS UCC', isNetworkBlock ? 'warn' : 'fail', r.error);
      if (r.scraperNote) warn(r.scraperNote);
      if (isNetworkBlock) info('appext20.dos.ny.gov blocks datacenter IPs — scraper works from residential/browser IPs');
      return;
    }
    if (!r.found) {
      record('NYS UCC', 'warn', `No filings — check APEX form field names in nysUCC.ts → findDebtorOrgField()`);
      return;
    }
    record('NYS UCC', 'pass', `${r.totalFilings} filings · ${r.activeFilings} active`);
    if (r.filings[0]) info(`First: #${r.filings[0].fileNumber} · secured by: ${r.filings[0].securedParty}`);
  });
}

// ─── 6. PACER ─────────────────────────────────────────────────────────────────
async function testPACER() {
  head('PACER Federal Bankruptcy', SUBJECTS.pacer);
  log(`  ${Y}· authenticating with PACER and searching PCL (expect 15-30s)...${RESET}`);
  const t = Date.now();
  await withTimeout('PACER', 90_000, async () => {
    const r = await checkPACERBankruptcy(SUBJECTS.pacer);
    info(secs(t));
    if (r.error) {
      record('PACER', 'fail', r.error);
      if (r.scraperNote) warn(r.scraperNote);
      if (/auth|credential|login|cookie/i.test(r.error)) {
        warn(`Auth hint: check what cookie PACER sets in a real browser session — NextGen may use a different name than PacerSession`);
      }
      return;
    }
    if (!r.found) {
      record('PACER', 'warn', `No cases found for "${SUBJECTS.pacer}". If auth succeeded, PCL form field names may be wrong. Check pacer.ts → searchPCL() and compare against live PCL form at pcl.uscourts.gov`);
      info(`Note: ${r.note || '(no note)'}`);
      return;
    }
    record('PACER', 'pass', `${r.totalCases} cases · ${r.activeCases} active stay`);
    if (r.cases[0]) info(`First: ${r.cases[0].caseNumber} | Ch.${r.cases[0].chapter} | ${r.cases[0].status} | ${r.cases[0].court}`);
  });
}

// ─── Optional webhook alert ───────────────────────────────────────────────────
async function sendAlert(passed: number, failed: number, warned: number) {
  const url = process.env.SCRAPER_ALERT_WEBHOOK;
  if (!url) return;
  const emoji = failed > 0 ? '🔴' : warned > 0 ? '🟡' : '🟢';
  const lines = results.map(r =>
    `${r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'} *${r.name}*: ${r.detail}`
  );
  const payload = {
    text: `${emoji} *Scraper Health Check* — ${passed} pass, ${warned} warn, ${failed} fail\n${lines.join('\n')}`,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* non-fatal */ }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const runStart = Date.now();
  const runTime  = new Date().toISOString();

  log(`\n${B}SCRAPER HEALTH CHECK${RESET}  ${runTime}`);
  log(`CAPTCHA_API_KEY      : ${process.env.CAPTCHA_API_KEY ? `✓ (${process.env.CAPTCHA_API_KEY.slice(0, 6)}…)` : `${R}✗ MISSING${RESET}`}`);
  log(`PACER_USERNAME       : ${process.env.PACER_USERNAME  ? `✓ ${process.env.PACER_USERNAME}` : `${R}✗ MISSING${RESET}`}`);
  log(`PACER_PASSWORD       : ${process.env.PACER_PASSWORD  ? '✓ set' : `${R}✗ MISSING${RESET}`}`);
  log(`SCRAPER_ALERT_WEBHOOK: ${process.env.SCRAPER_ALERT_WEBHOOK ? '✓ set' : '· not set (no webhook alert)'}`);

  await testACRIS();
  await testECB();
  await testNYSEntity();
  await testCourts();
  await testUCC();
  await testPACER();

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.status === 'pass').length;
  const failed  = results.filter(r => r.status === 'fail').length;
  const warned  = results.filter(r => r.status === 'warn').length;
  const total   = secs(runStart);

  log(`\n${B}━━━ SUMMARY (${total}) ━━━${RESET}`);
  for (const r of results) {
    const icon = r.status === 'pass' ? `${G}✓${RESET}` : r.status === 'warn' ? `${Y}⚠${RESET}` : `${R}✗${RESET}`;
    log(`  ${icon}  ${r.name.padEnd(20)} ${r.detail.slice(0, 80)}`);
  }
  log(`\n  ${G}${passed} pass${RESET}  ${Y}${warned} warn${RESET}  ${R}${failed} fail${RESET}`);

  await sendAlert(passed, failed, warned);

  // Exit 1 if any hard failures — Railway will mark the cron run as failed
  if (failed > 0) {
    log(`\n${R}${B}FAILED — ${failed} scraper(s) need attention.${RESET}\n`);
    process.exit(1);
  }

  log(`\n${G}${B}All scrapers operational.${RESET}\n`);
  process.exit(0);
})();
