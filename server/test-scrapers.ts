/**
 * Live scraper test — run from Railway console:
 *
 *   npx ts-node test-scrapers.ts
 *
 * Tests all 6 scrapers against live endpoints with real-world names
 * that should return results. Prints a clear pass/fail for each.
 */

import 'dotenv/config';
import { lookupACRIS } from './src/services/acris';
import { lookupNYCECB } from './src/services/nycECB';
import { lookupNYSEntity } from './src/services/nysEntity';
import { lookupNYSUCC } from './src/services/nysUCC';
import { lookupNYCourtHistory } from './src/services/nycourts';
import { checkPACERBankruptcy } from './src/services/pacer';

// ─── Colors ───────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', RESET = '\x1b[0m', B = '\x1b[1m';
const pass = (m: string) => console.log(`  ${G}✓${RESET} ${m}`);
const fail = (m: string) => console.log(`  ${R}✗${RESET} ${m}`);
const warn = (m: string) => console.log(`  ${Y}⚠${RESET} ${m}`);
const info = (m: string) => console.log(`  ${C}·${RESET} ${m}`);
const sep  = (n: string, q: string) => console.log(`\n${B}━━━ ${n} — "${q}" ━━━${RESET}`);
const ms   = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

// ─── Test subjects ────────────────────────────────────────────────────────────
// Chosen because each should have real records in its respective database.
const SUBJECTS = {
  acris:   'TRUMP',                 // Extensive NYC property history
  ecb:     'MCDONALD',             // Large chain with ECB violations on record
  entity:  'GOOGLE LLC',           // Registered in NY as a foreign LLC
  ucc:     'GOOGLE LLC',           // Has financing/bank UCC filings
  courts:  'TRUMP',                // Frequently named in NYC civil court
  pacer:   'SEARS ROEBUCK AND CO', // Filed Ch.11 in SDNY in 2018 — confirmed in PACER
};

// ─── 1. ACRIS ─────────────────────────────────────────────────────────────────
async function testACRIS() {
  sep('ACRIS (NYC Property Records)', SUBJECTS.acris);
  const t = Date.now();
  try {
    const r = await lookupACRIS(SUBJECTS.acris);
    info(`${ms(t)}`);
    if (r.error)        { fail(r.error); return; }
    if (!r.found)       { warn(`No records — expected results for "${SUBJECTS.acris}". API may be rate-limiting or name format changed.`); return; }
    pass(`${r.totalRecords} record(s) · ${r.asGrantee} grantee · ${r.asGrantor} grantor`);
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── 2. ECB Violations ────────────────────────────────────────────────────────
async function testECB() {
  sep('ECB / OATH Violations', SUBJECTS.ecb);
  const t = Date.now();
  try {
    const r = await lookupNYCECB(SUBJECTS.ecb);
    info(`${ms(t)}`);
    if (r.error)        { fail(r.error); return; }
    if (!r.found)       { warn(`No violations — try a different name if this seems wrong.`); info(r.note.slice(0, 160)); return; }
    pass(`${r.totalViolations} violation(s) · $${r.totalOutstanding.toLocaleString()} outstanding · ${r.unpaidViolations} unpaid`);
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── 3. NYS Entity ────────────────────────────────────────────────────────────
async function testNYSEntity() {
  sep('NYS Entity (DOS)', SUBJECTS.entity);
  const t = Date.now();
  try {
    const r = await lookupNYSEntity(SUBJECTS.entity);
    info(`${ms(t)}`);
    if (r.error)        { fail(r.error); return; }
    if (!r.found || !r.entities.length) {
      warn(`No entity found. Check entityStatusIndicator value in nysEntity.ts — may need to be '' or 'All' instead of 'AllStatuses'.`);
      return;
    }
    const e = r.entities[0];
    pass(`${r.totalRecords} match(es) · top: "${e.entityName}" · status: ${e.status}`);
    if (e.registeredAgent)   info(`Registered agent: ${e.registeredAgent}`);
    if (e.dosProcessAddress) info(`DOS process: ${e.dosProcessAddress}`);
    if (!e.registeredAgent && !e.dosProcessAddress) warn(`No agent/address returned — check detail response field names (GetEntityRecordByID)`);
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── 4. NYC Civil Court ───────────────────────────────────────────────────────
async function testCourts() {
  sep('NYC Civil Court History', SUBJECTS.courts);
  const t = Date.now();
  try {
    const r = await lookupNYCourtHistory(SUBJECTS.courts);
    info(`${ms(t)}`);
    if (r.error) {
      fail(r.error);
      if (r.scraperNote) warn(r.scraperNote);
      return;
    }
    if (!r.found) {
      warn(`No cases — if unexpected: open iapps.courts.state.ny.us/webcivil/FCASMain in browser dev tools, run a search, copy the POST body field names and compare with nycourts.ts → runSearch()`);
      return;
    }
    pass(`${r.totalCases} case(s) · ${r.asDefendant} defendant · ${r.asPlaintiff} plaintiff`);
    if (r.cases[0]) {
      const c = r.cases[0];
      info(`First: ${c.caseIndex} | ${c.caseType} | filed ${c.filedDate ?? 'n/a'} | ${c.status}`);
    }
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── 5. NYS UCC ───────────────────────────────────────────────────────────────
async function testUCC() {
  sep('NYS UCC Filings', SUBJECTS.ucc);
  console.log(`  ${Y}(CAPTCHA solve — expect 20-50s)${RESET}`);
  const t = Date.now();
  try {
    const r = await lookupNYSUCC(SUBJECTS.ucc);
    info(`${ms(t)}`);
    if (r.error) {
      fail(r.error);
      if (r.scraperNote) warn(r.scraperNote);
      return;
    }
    if (!r.found) {
      warn(`No filings — if unexpected: open appext20.dos.ny.gov/pls/ucc_public/web_search_main in browser dev tools, submit a search, copy POST body field names and compare with nysUCC.ts → findDebtorOrgField()`);
      return;
    }
    pass(`${r.totalFilings} filing(s) · ${r.activeFilings} active`);
    if (r.filings[0]) info(`First: #${r.filings[0].fileNumber} | ${r.filings[0].fileType} | secured by: ${r.filings[0].securedParty}`);
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── 6. PACER ─────────────────────────────────────────────────────────────────
async function testPACER() {
  sep('PACER Federal Bankruptcy', SUBJECTS.pacer);
  console.log(`  ${Y}(PACER auth + PCL search — expect 15-30s)${RESET}`);
  const t = Date.now();
  try {
    const r = await checkPACERBankruptcy(SUBJECTS.pacer);
    info(`${ms(t)}`);
    if (r.error) {
      fail(r.error);
      if (r.scraperNote) warn(r.scraperNote);
      // Extra hint for auth failures
      if (/auth|credential|login|cookie/i.test(r.error)) {
        warn(`Auth hint: PACER NextGen may set a different session cookie. Log into pacer.uscourts.gov in a browser, check what cookies are set (DevTools → Application → Cookies), and update the cookie name check in pacer.ts → authenticate()`);
      }
      return;
    }
    if (!r.found) {
      warn(`No cases found — Sears Roebuck should have a Ch.11 in PACER (SDNY 2018). Auth may have succeeded but PCL form field names are wrong. Check PCL search POST params in pacer.ts → searchPCL()`);
      return;
    }
    pass(`${r.totalCases} case(s) · ${r.activeCases} active stay`);
    if (r.cases[0]) {
      const c = r.cases[0];
      pass(`First: ${c.caseNumber} | Ch. ${c.chapter} | ${c.status} | ${c.court || 'court unknown'}`);
      if (c.proofOfClaimDeadline) info(`POC deadline: ${c.proofOfClaimDeadline}`);
      info(`Action: ${c.actionRequired.slice(0, 120)}`);
    }
    info(r.note.slice(0, 160));
  } catch (e) { fail(`threw: ${e instanceof Error ? e.message : e}`); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${B}SCRAPER LIVE TEST${RESET}`);
  console.log(`CAPTCHA_API_KEY : ${process.env.CAPTCHA_API_KEY ? `✓ set (${process.env.CAPTCHA_API_KEY.slice(0, 6)}…)` : `${R}✗ MISSING${RESET}`}`);
  console.log(`PACER_USERNAME  : ${process.env.PACER_USERNAME  ? `✓ ${process.env.PACER_USERNAME}` : `${R}✗ MISSING${RESET}`}`);
  console.log(`PACER_PASSWORD  : ${process.env.PACER_PASSWORD  ? '✓ set'                          : `${R}✗ MISSING${RESET}`}`);
  console.log(`NYC_OPEN_DATA_TOKEN: ${process.env.NYC_OPEN_DATA_TOKEN ? '✓ set (higher rate limit)' : '· not set (anonymous limit — fine for testing)'}`);

  await testACRIS();
  await testECB();
  await testNYSEntity();
  await testCourts();
  await testUCC();
  await testPACER();

  console.log(`\n${B}━━━ DONE ━━━${RESET}\n`);
})();
