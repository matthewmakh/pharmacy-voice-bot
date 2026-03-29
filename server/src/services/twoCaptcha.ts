// 2Captcha service — solves reCAPTCHA v2 and other CAPTCHA types.
// API docs: https://2captcha.com/api-docs
//
// CAPTCHA_API_KEY must be set in environment variables.
// Add it to your .env: CAPTCHA_API_KEY=your_key_here
//
// Typical solve time: 15–45 seconds for reCAPTCHA v2.
// We wait 20 seconds before first poll, then poll every 5 seconds up to timeout.

const SUBMIT_URL  = 'https://2captcha.com/in.php';
const RESULT_URL  = 'https://2captcha.com/res.php';
const POLL_DELAY_INITIAL = 20_000;  // ms — reCAPTCHA typically takes at least this long
const POLL_INTERVAL      = 5_000;   // ms between polls
const DEFAULT_TIMEOUT    = 120_000; // ms — 2 minutes max

class CaptchaError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CaptchaError'; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── reCAPTCHA v2 ─────────────────────────────────────────────────────────────

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<string> {
  const key = apiKey ?? process.env.CAPTCHA_API_KEY;
  if (!key) throw new CaptchaError('CAPTCHA_API_KEY not set — cannot solve reCAPTCHA');

  // Step 1: Submit the CAPTCHA task
  const submitParams = new URLSearchParams({
    key,
    method: 'userrecaptcha',
    googlekey: siteKey,
    pageurl: pageUrl,
    json: '1',
  });

  const submitResp = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: submitParams.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitResp.ok) {
    throw new CaptchaError(`2captcha submit failed with HTTP ${submitResp.status}`);
  }

  const submitBody = await submitResp.json() as { status: number; request: string };
  if (submitBody.status !== 1) {
    throw new CaptchaError(`2captcha submit error: ${submitBody.request}`);
  }

  const taskId = submitBody.request;

  // Step 2: Poll for solution
  const deadline = Date.now() + timeoutMs;
  await sleep(POLL_DELAY_INITIAL);

  while (Date.now() < deadline) {
    const pollResp = await fetch(
      `${RESULT_URL}?key=${key}&action=get&id=${taskId}&json=1`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!pollResp.ok) {
      await sleep(POLL_INTERVAL);
      continue;
    }

    const pollBody = await pollResp.json() as { status: number; request: string };

    if (pollBody.status === 1) {
      // Solution ready
      return pollBody.request;
    }

    if (pollBody.request === 'CAPCHA_NOT_READY') {
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Any other response is an error
    throw new CaptchaError(`2captcha poll error: ${pollBody.request}`);
  }

  throw new CaptchaError(`2captcha timed out after ${timeoutMs / 1000}s`);
}

// ─── reCAPTCHA v3 ─────────────────────────────────────────────────────────────

export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  action: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<string> {
  const key = apiKey ?? process.env.CAPTCHA_API_KEY;
  if (!key) throw new CaptchaError('CAPTCHA_API_KEY not set');

  const submitParams = new URLSearchParams({
    key,
    method: 'userrecaptcha',
    version: 'v3',
    googlekey: siteKey,
    pageurl: pageUrl,
    action,
    min_score: '0.3',
    json: '1',
  });

  const submitResp = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: submitParams.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!submitResp.ok) throw new CaptchaError(`2captcha v3 submit HTTP ${submitResp.status}`);

  const submitBody = await submitResp.json() as { status: number; request: string };
  if (submitBody.status !== 1) throw new CaptchaError(`2captcha v3 submit error: ${submitBody.request}`);

  const taskId = submitBody.request;
  const deadline = Date.now() + timeoutMs;
  await sleep(POLL_DELAY_INITIAL);

  while (Date.now() < deadline) {
    const pollResp = await fetch(
      `${RESULT_URL}?key=${key}&action=get&id=${taskId}&json=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!pollResp.ok) { await sleep(POLL_INTERVAL); continue; }

    const pollBody = await pollResp.json() as { status: number; request: string };
    if (pollBody.status === 1) return pollBody.request;
    if (pollBody.request === 'CAPCHA_NOT_READY') { await sleep(POLL_INTERVAL); continue; }
    throw new CaptchaError(`2captcha v3 poll error: ${pollBody.request}`);
  }

  throw new CaptchaError(`2captcha v3 timed out`);
}

// ─── Utility: check balance ───────────────────────────────────────────────────

export async function getCaptchaBalance(apiKey?: string): Promise<number> {
  const key = apiKey ?? process.env.CAPTCHA_API_KEY;
  if (!key) throw new CaptchaError('CAPTCHA_API_KEY not set');
  const resp = await fetch(`${RESULT_URL}?key=${key}&action=getbalance&json=1`);
  const body = await resp.json() as { status: number; request: string };
  if (body.status !== 1) throw new CaptchaError(`Balance check failed: ${body.request}`);
  return parseFloat(body.request);
}
