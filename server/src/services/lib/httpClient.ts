// Shared HTTP client for debtor-research scrapers.
//
// Two responsibilities:
//   1. Optional proxy support via undici ProxyAgent — read PROXY_URL or
//      HTTPS_PROXY / HTTP_PROXY. Used in production where the host's
//      datacenter IP is blocked by government portals (Cloudflare, NY DOS).
//   2. fetchWithRetry — retries on network errors and 429/5xx with a FRESH
//      AbortSignal each attempt (so an expired signal from attempt 1 doesn't
//      abort retries) and exponential-ish backoff.
//
// Every scraper should call `proxyFetch` instead of bare `fetch`.

import { ProxyAgent } from 'undici';

let cachedDispatcher: ProxyAgent | null | undefined; // undefined = not initialized

function getDispatcher(): ProxyAgent | null {
  if (cachedDispatcher !== undefined) return cachedDispatcher;
  const url =
    process.env.PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    '';
  if (!url) {
    cachedDispatcher = null;
    return null;
  }
  try {
    cachedDispatcher = new ProxyAgent({ uri: url });
    console.log(`[httpClient] Using proxy: ${url.replace(/\/\/[^@]+@/, '//***@')}`);
    return cachedDispatcher;
  } catch (err) {
    console.warn(`[httpClient] Invalid PROXY_URL "${url}":`, err);
    cachedDispatcher = null;
    return null;
  }
}

export interface ProxyFetchInit extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
}

/** fetch() with optional proxy + per-call timeout. Single attempt. */
export async function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  const dispatcher = getDispatcher();
  const opts: Record<string, unknown> = {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (dispatcher) opts.dispatcher = dispatcher;
  return fetch(url, opts as unknown as RequestInit);
}

/**
 * Retry on network errors and 429/5xx (not 4xx).
 * Each attempt gets a FRESH AbortSignal so a timed-out signal from attempt 1
 * doesn't immediately abort subsequent retries.
 */
export async function fetchWithRetry(
  url: string,
  init: ProxyFetchInit = {},
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await proxyFetch(url, init);
      if ((resp.status === 429 || resp.status >= 500) && i < retries - 1) {
        const wait = (i + 1) * 1500 + Math.floor(Math.random() * 500);
        await sleep(wait);
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await sleep((i + 1) * 1500);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Returns true if proxying is configured. Useful for diagnostics. */
export function isProxyConfigured(): boolean {
  return getDispatcher() !== null;
}
