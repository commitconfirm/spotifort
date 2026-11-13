/**
 * Polite JSON-over-HTTP client for the pipeline: spacing between requests, Retry-After, retries of
 * transient failures, and an on-disk cache of definitive answers.
 *
 * Secrets: callers pass the real URL (which may hold an api key) plus a separate `cacheKey` that does not.
 * Nothing here ever writes, logs or throws a URL without `redact()` having removed credentials.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRetryAfter } from './lineup-pipeline.js';

const SECRET_PARAM = /\b(api_key|access_token|client_secret|client_id|token)=[^&\s"')]*/gi;

/** @param {unknown} text @returns {string} text with credential query parameters blanked */
export const redact = (text) => String(text).replace(SECRET_PARAM, '$1=REDACTED');

export class ApiError extends Error {
  /**
   * @param {string} message already safe to print
   * @param {{status?: number, abort?: boolean}} [info] abort: retrying other records will not help (rate limit, bad key)
   */
  constructor(message, info = {}) {
    super(redact(message));
    this.name = 'ApiError';
    this.status = info.status ?? 0;
    this.abort = info.abort ?? false;
  }
}

/** Default judgement of a response: 'ok' (final answer, cacheable), 'retry' (transient) or 'fail'. */
export function defaultClassify(status, body) {
  if (body === null) return 'retry';
  if (status === 200 || status === 404) return 'ok';
  if (status >= 400 && status < 500) return 'fail';
  return 'retry';
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string|null} opts.cacheDir where answers are cached; null disables caching
 * @param {number} opts.minIntervalMs minimum time between request starts
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.maxWaitSeconds] longest Retry-After we will wait out; longer aborts the stage
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]
 * @param {()=>number} [opts.now]
 * @param {boolean} [opts.useCache] false = ignore existing cache entries (still writes)
 * @param {(msg:string)=>void} [opts.log]
 */
export function createClient(opts) {
  const {
    cacheDir,
    minIntervalMs,
    headers = {},
    maxAttempts = 5,
    maxWaitSeconds = 120,
    fetchImpl = fetch,
    sleep = sleepReal,
    now = Date.now,
    useCache = true,
    log = () => {},
  } = opts;
  let lastStart = -Infinity;
  const stats = { network: 0, cached: 0 };

  const fileFor = (key) => join(cacheDir, createHash('sha1').update(key).digest('hex') + '.json');

  function readCache(key, classify) {
    if (!cacheDir || !key || !useCache) return null;
    const f = fileFor(key);
    if (!existsSync(f)) return null;
    try {
      const entry = JSON.parse(readFileSync(f, 'utf8'));
      if (classify(entry.status, entry.body) === 'ok') return entry;
    } catch {
      // unreadable entry: treat as a miss
    }
    return null;
  }

  function writeCache(key, status, body) {
    if (!cacheDir || !key) return;
    mkdirSync(cacheDir, { recursive: true });
    const f = fileFor(key);
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify({ key, status, body }));
    renameSync(tmp, f);
  }

  /**
   * @param {string} url full URL (may contain credentials)
   * @param {{cacheKey?: string, classify?: (status:number, body:any)=>'ok'|'retry'|'fail'}} [o]
   * @returns {Promise<{status:number, body:any, cached:boolean}>}
   * @throws {ApiError}
   */
  async function getJson(url, { cacheKey, classify = defaultClassify } = {}) {
    const hit = readCache(cacheKey, classify);
    if (hit) {
      stats.cached++;
      return { status: hit.status, body: hit.body, cached: true };
    }

    let last = 'no attempt';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      stats.network++;

      let res;
      try {
        res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers } });
      } catch (err) {
        last = `network error (${redact(err?.cause?.code ?? err?.message ?? 'unknown')})`;
        await sleep(Math.min(30000, 1000 * 2 ** attempt));
        continue;
      }

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'));
        if (retryAfter !== null && retryAfter > maxWaitSeconds) {
          throw new ApiError(`rate limited (HTTP ${res.status}) with Retry-After ${Math.ceil(retryAfter)}s, more than the ${maxWaitSeconds}s limit`, { status: res.status, abort: true });
        }
        const secs = retryAfter !== null ? Math.max(1, Math.ceil(retryAfter)) : Math.min(60, 2 ** (attempt + 1));
        last = `HTTP ${res.status}`;
        log(`  HTTP ${res.status}; waiting ${secs}s (attempt ${attempt}/${maxAttempts})`);
        await sleep(secs * 1000);
        continue;
      }

      let body = null;
      try {
        body = JSON.parse(await res.text());
      } catch {
        body = null; // transient non-JSON answer; never cached
      }

      const verdict = classify(res.status, body);
      if (verdict === 'ok') {
        writeCache(cacheKey, res.status, body);
        return { status: res.status, body, cached: false };
      }
      if (verdict === 'fail') throw new ApiError(`HTTP ${res.status}${body?.error ? ` (API error ${body.error})` : ''}`, { status: res.status });
      last = body === null ? `HTTP ${res.status} with a non-JSON body` : `HTTP ${res.status}${body?.error ? ` (API error ${body.error})` : ''}`;
      await sleep(Math.min(30000, 1000 * 2 ** attempt));
    }
    throw new ApiError(`gave up after ${maxAttempts} attempts (last: ${last})`);
  }

  return { getJson, stats };
}

/** Last.fm: error 6 is a real "not found"; 8/11/16/29 and non-JSON are transient; other errors are fatal. */
export function lastfmClassify(status, body) {
  if (body === null) return 'retry';
  if (body.error === undefined) return status >= 500 ? 'retry' : 'ok';
  if (body.error === 6) return 'ok';
  if ([8, 11, 16, 29].includes(body.error)) return 'retry';
  return 'fail';
}

/** MusicBrainz: 200 and 404 (with JSON) are answers. */
export const musicbrainzClassify = defaultClassify;
