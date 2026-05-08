/**
 * Phase A vendor smoke test.
 *
 * Hits a read-only endpoint on each vendor's API to confirm the key in
 * .env is valid and the network is reachable. No data is mutated, no
 * charges, no emails sent.
 *
 * Run from the server/ directory: npx ts-node test-phase-a.ts
 */

import 'dotenv/config';

interface Result {
  vendor: string;
  status: 'OK' | 'SKIP' | 'FAIL';
  detail: string;
}

async function main() {
  const results: Result[] = [];

  results.push(await checkResend());
  results.push(await checkLob());
  results.push(await checkDropboxSign());
  results.push(await checkStripe());
  results.push(checkRedisConfig());

  console.log('');
  console.log('Phase A vendor smoke test');
  console.log('─'.repeat(60));
  for (const r of results) {
    const badge =
      r.status === 'OK' ? '\x1b[32mOK  \x1b[0m'
      : r.status === 'SKIP' ? '\x1b[90mSKIP\x1b[0m'
      : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${badge}  ${r.vendor.padEnd(15)} ${r.detail}`);
  }
  console.log('');

  const failed = results.filter((r) => r.status === 'FAIL').length;
  if (failed > 0) {
    console.error(`\x1b[31m${failed} vendor(s) failed. Fix before testing the end-to-end flow.\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mAll configured vendors reachable. Ready for end-to-end test.\x1b[0m');
}

async function checkResend(): Promise<Result> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return skip('Resend', 'RESEND_API_KEY not set');
  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 401) return fail('Resend', 'invalid API key');
    if (!r.ok) return fail('Resend', `HTTP ${r.status}`);
    const body = await r.json() as { data: Array<{ name: string; status: string }> };
    const verified = body.data?.filter((d) => d.status === 'verified') ?? [];
    if (verified.length === 0) {
      return fail('Resend', `${body.data?.length ?? 0} domain(s) but none verified — check DNS`);
    }
    return ok('Resend', `key valid · ${verified.length} verified domain(s): ${verified.map((d) => d.name).join(', ')}`);
  } catch (err) {
    return fail('Resend', `network error: ${(err as Error).message}`);
  }
}

async function checkLob(): Promise<Result> {
  const key = process.env.LOB_API_KEY;
  if (!key) return skip('Lob', 'LOB_API_KEY not set');
  try {
    const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
    const r = await fetch('https://api.lob.com/v1/letters?limit=1', {
      headers: { Authorization: auth },
    });
    if (r.status === 401) return fail('Lob', 'invalid API key');
    if (!r.ok) return fail('Lob', `HTTP ${r.status}`);
    const env = key.startsWith('test_') ? 'TEST' : 'LIVE';
    return ok('Lob', `key valid · ${env} mode`);
  } catch (err) {
    return fail('Lob', `network error: ${(err as Error).message}`);
  }
}

async function checkDropboxSign(): Promise<Result> {
  const key = process.env.DROPBOX_SIGN_API_KEY;
  if (!key) return skip('Dropbox Sign', 'DROPBOX_SIGN_API_KEY not set');
  try {
    const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
    const r = await fetch('https://api.hellosign.com/v3/account', {
      headers: { Authorization: auth },
    });
    if (r.status === 401) return fail('Dropbox Sign', 'invalid API key');
    if (!r.ok) return fail('Dropbox Sign', `HTTP ${r.status}`);
    const body = await r.json() as { account: { email_address: string; quotas?: { api_signature_requests_left?: number } } };
    const quota = body.account.quotas?.api_signature_requests_left;
    return ok('Dropbox Sign', `account ${body.account.email_address}${quota !== undefined ? ` · ${quota} test sigs left` : ''}`);
  } catch (err) {
    return fail('Dropbox Sign', `network error: ${(err as Error).message}`);
  }
}

async function checkStripe(): Promise<Result> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return skip('Stripe', 'STRIPE_SECRET_KEY not set');
  try {
    const r = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 401) return fail('Stripe', 'invalid API key');
    if (!r.ok) return fail('Stripe', `HTTP ${r.status}`);
    const body = await r.json() as {
      id: string;
      country: string;
      capabilities?: Record<string, string>;
      type?: string;
    };
    const env = key.startsWith('sk_test_') ? 'TEST' : 'LIVE';
    return ok('Stripe', `account ${body.id} · ${body.country} · ${env} mode`);
  } catch (err) {
    return fail('Stripe', `network error: ${(err as Error).message}`);
  }
}

function checkRedisConfig(): Result {
  const url = process.env.REDIS_URL;
  if (!url) return skip('Redis', 'REDIS_URL not set — follow-up scheduler will be a no-op');
  return ok('Redis', `${url.replace(/:[^:@]*@/, ':***@')} (configured, connectivity not tested here)`);
}

function ok(vendor: string, detail: string): Result { return { vendor, status: 'OK', detail }; }
function skip(vendor: string, detail: string): Result { return { vendor, status: 'SKIP', detail }; }
function fail(vendor: string, detail: string): Result { return { vendor, status: 'FAIL', detail }; }

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
