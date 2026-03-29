// 2Captcha service — solves reCAPTCHA v2/v3 and image CAPTCHAs.
// API docs: https://2captcha.com/api-docs
//
// Set CAPTCHA_API_KEY in your environment (.env or Railway/deploy secrets).
//
// Typical solve time for reCAPTCHA v2: 20–45s.
// We wait 18s before first poll, then every 5s up to timeout.
// On ERROR_CAPTCHA_UNSOLVABLE we auto-retry once before throwing.

const SUBMIT_URL = 'https://2captcha.com/in.php';
const RESULT_URL = 'https://2captcha.com/res.php';

// Timing constants (ms)
const RECAPTCHA_INITIAL_WAIT = 18_000;
const POLL_INTERVAL          = 5_000;
const DEFAULT_TIMEOUT        = 120_000;

// 2captcha error codes that indicate a permanent failure (don't retry billing)
const PERMANENT_ERRORS = new Set([
  'ERROR_KEY_DOES_NOT_EXIST',
  'ERROR_ZERO_BALANCE',
  'ERROR_IP_NOT_ALLOWED',
  'ERROR_WRONG_CAPTCHA_ID',
  'ERROR_BAD_PARAMETERS',
]);

export class CaptchaError extends Error {
  constructor(
    msg: string,
    public readonly code?: string,
    public readonly taskId?: string,
  ) {
    super(msg);
    this.name = 'CaptchaError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getKey(apiKey?: string): string {
  const key = apiKey ?? process.env.CAPTCHA_API_KEY;
  if (!key) throw new CaptchaError('CAPTCHA_API_KEY not set');
  return key;
}

// ─── Internal: submit a task ─────────────────────────────────────────────────

async function submitTask(
  params: Record<string, string>,
  apiKey: string,
): Promise<string> {
  const body = new URLSearchParams({ key: apiKey, json: '1', ...params });

  const resp = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new CaptchaError(`2captcha submit HTTP ${resp.status}`);

  const result = await resp.json() as { status: number; request: string };
  if (result.status !== 1) {
    throw new CaptchaError(`2captcha submit error: ${result.request}`, result.request);
  }

  return result.request; // task ID
}

// ─── Internal: poll until solved ─────────────────────────────────────────────

async function pollResult(
  taskId: string,
  apiKey: string,
  initialWaitMs: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  await sleep(initialWaitMs);

  while (Date.now() < deadline) {
    let resp: Response;
    try {
      resp = await fetch(
        `${RESULT_URL}?key=${apiKey}&action=get&id=${taskId}&json=1`,
        { signal: AbortSignal.timeout(10_000) },
      );
    } catch {
      // Network hiccup — keep polling
      await sleep(POLL_INTERVAL);
      continue;
    }

    if (!resp.ok) { await sleep(POLL_INTERVAL); continue; }

    const result = await resp.json() as { status: number; request: string };

    if (result.status === 1) return result.request; // token!

    if (result.request === 'CAPCHA_NOT_READY') {
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Any other response is a terminal error
    throw new CaptchaError(
      `2captcha poll error: ${result.request}`,
      result.request,
      taskId,
    );
  }

  throw new CaptchaError(`2captcha timed out after ${timeoutMs / 1000}s`, 'TIMEOUT', taskId);
}

// ─── Report incorrect (trigger refund + allows caller to retry) ──────────────

export async function reportIncorrect(taskId: string, apiKey?: string): Promise<void> {
  const key = getKey(apiKey);
  try {
    await fetch(`${RESULT_URL}?key=${key}&action=reportbad&id=${taskId}&json=1`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Best-effort — don't throw if reporting fails
  }
}

// ─── reCAPTCHA v2 ─────────────────────────────────────────────────────────────

/** Returns { token, taskId } so callers can report incorrect if the site rejects it */
export async function solveRecaptchaV2WithId(
  siteKey: string,
  pageUrl: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<{ token: string; taskId: string }> {
  const key = getKey(apiKey);

  for (let attempt = 0; attempt < 2; attempt++) {
    let taskId: string | undefined;
    try {
      taskId = await submitTask(
        { method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl },
        key,
      );
      const token = await pollResult(taskId, key, RECAPTCHA_INITIAL_WAIT, timeoutMs);
      return { token, taskId };
    } catch (err) {
      if (err instanceof CaptchaError && err.code === 'ERROR_CAPTCHA_UNSOLVABLE' && attempt === 0) {
        if (taskId) await reportIncorrect(taskId, key);
        await sleep(3_000);
        continue;
      }
      throw err;
    }
  }
  throw new CaptchaError('reCAPTCHA v2 unsolvable after 2 attempts');
}

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<string> {
  const key = getKey(apiKey);

  // Auto-retry once on ERROR_CAPTCHA_UNSOLVABLE (worker couldn't read it)
  for (let attempt = 0; attempt < 2; attempt++) {
    let taskId: string | undefined;
    try {
      taskId = await submitTask(
        { method: 'userrecaptcha', googlekey: siteKey, pageurl: pageUrl },
        key,
      );
      const token = await pollResult(taskId, key, RECAPTCHA_INITIAL_WAIT, timeoutMs);
      return token;
    } catch (err) {
      if (
        err instanceof CaptchaError &&
        err.code === 'ERROR_CAPTCHA_UNSOLVABLE' &&
        attempt === 0
      ) {
        // Report bad so we don't get charged, then retry
        if (taskId) await reportIncorrect(taskId, key);
        await sleep(3_000);
        continue;
      }
      throw err;
    }
  }

  throw new CaptchaError('reCAPTCHA v2 unsolvable after 2 attempts');
}

// ─── reCAPTCHA v3 ─────────────────────────────────────────────────────────────

export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  action: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<string> {
  const key = getKey(apiKey);
  const taskId = await submitTask(
    {
      method: 'userrecaptcha',
      version: 'v3',
      googlekey: siteKey,
      pageurl: pageUrl,
      action,
      min_score: '0.3',
    },
    key,
  );
  return pollResult(taskId, key, RECAPTCHA_INITIAL_WAIT, timeoutMs);
}

// ─── Balance check ────────────────────────────────────────────────────────────

export async function getCaptchaBalance(apiKey?: string): Promise<number> {
  const key = getKey(apiKey);
  const resp = await fetch(
    `${RESULT_URL}?key=${key}&action=getbalance&json=1`,
    { signal: AbortSignal.timeout(8_000) },
  );
  const body = await resp.json() as { status: number; request: string };
  if (body.status !== 1) throw new CaptchaError(`Balance check failed: ${body.request}`);
  return parseFloat(body.request);
}
