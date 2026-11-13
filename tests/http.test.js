import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, createClient, lastfmClassify, redact } from '../scripts/lib/http.js';

const res = (status, body, headers = {}) => ({
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function harness(responses, opts = {}) {
  const calls = [];
  const sleeps = [];
  let t = 1000;
  const queue = [...responses];
  const client = createClient({
    minIntervalMs: 1000,
    fetchImpl: async (url) => {
      calls.push({ url, at: t });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
    ...opts,
  });
  return { client, calls, sleeps };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spotifort-http-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('redact', () => {
  it('blanks credential query parameters', () => {
    expect(redact('https://x/?method=a&api_key=SECRET123&format=json')).toBe('https://x/?method=a&api_key=REDACTED&format=json');
    expect(redact('fail https://x/?token=abc')).toBe('fail https://x/?token=REDACTED');
  });
});

describe('createClient', () => {
  it('spaces requests by the minimum interval', async () => {
    const { client, calls } = harness([res(200, { a: 1 }), res(200, { a: 2 }), res(200, { a: 3 })]);
    await client.getJson('https://x/1');
    await client.getJson('https://x/2');
    await client.getJson('https://x/3');
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(1000);
  });

  it('honours Retry-After, then succeeds', async () => {
    const { client, sleeps } = harness([res(429, {}, { 'retry-after': '7' }), res(200, { ok: true })]);
    const r = await client.getJson('https://x/');
    expect(r.body).toEqual({ ok: true });
    expect(sleeps).toContain(7000);
  });

  it('aborts when Retry-After is longer than we will wait', async () => {
    const { client } = harness([res(429, {}, { 'retry-after': '3600' })]);
    await expect(client.getJson('https://x/')).rejects.toMatchObject({ name: 'ApiError', abort: true });
  });

  it('retries a transient non-JSON 200 and does not cache it', async () => {
    const { client, calls } = harness([res(200, '<html>oops</html>'), res(200, { artist: 'x' })], { cacheDir: dir });
    const r = await client.getJson('https://x/?api_key=K', { cacheKey: 'k1' });
    expect(r.body).toEqual({ artist: 'x' });
    expect(calls).toHaveLength(2);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, files[0]), 'utf8')).body).toEqual({ artist: 'x' });
  });

  it('retries network errors and 5xx, then gives up with a safe message', async () => {
    const { client, calls } = harness([new Error('boom https://x/?api_key=K'), res(500, {}), res(502, 'bad'), res(200, 'nope'), res(200, 'nope')], { maxAttempts: 5 });
    const err = await client.getJson('https://x/?api_key=SECRETKEY').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(5);
    expect(err.message).not.toContain('SECRETKEY');
    expect(err.message).not.toContain('api_key=K');
  });

  it('caches definitive answers by key (never by URL) and serves them without the network', async () => {
    const first = harness([res(200, { v: 1 })], { cacheDir: dir });
    await first.client.getJson('https://x/?api_key=SUPERSECRET', { cacheKey: 'method?artist=A' });
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text).not.toContain('SUPERSECRET');
      expect(f).not.toContain('SUPERSECRET');
    }
    const second = harness([], { cacheDir: dir });
    const r = await second.client.getJson('https://x/?api_key=OTHER', { cacheKey: 'method?artist=A' });
    expect(r).toMatchObject({ body: { v: 1 }, cached: true });
    expect(second.calls).toHaveLength(0);
    expect(second.client.stats).toEqual({ network: 0, cached: 1 });
  });

  it('caches Last.fm error 6 (a real "not found") and does not cache transient errors', async () => {
    const h = harness([res(200, { error: 29 }), res(404, { error: 6 })], { cacheDir: dir });
    const r = await h.client.getJson('https://x/', { cacheKey: 'nf', classify: lastfmClassify });
    expect(r.body).toEqual({ error: 6 });
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('fails fast on a fatal API error (bad key) without leaking it', async () => {
    const h = harness([res(403, { error: 10, message: 'Invalid API key' })]);
    const err = await h.client.getJson('https://x/?api_key=K', { classify: lastfmClassify }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/403/);
    expect(h.calls).toHaveLength(1);
  });

  it('ignores the cache when useCache is false', async () => {
    const a = harness([res(200, { v: 1 })], { cacheDir: dir });
    await a.client.getJson('https://x/', { cacheKey: 'k' });
    const b = harness([res(200, { v: 2 })], { cacheDir: dir, useCache: false });
    expect((await b.client.getJson('https://x/', { cacheKey: 'k' })).body).toEqual({ v: 2 });
  });

  it('treats a MusicBrainz-style 404 with a JSON body as an answer', async () => {
    const h = harness([res(404, { error: 'Not Found' })], { cacheDir: dir });
    const r = await h.client.getJson('https://x/', { cacheKey: 'nf' });
    expect(r.status).toBe(404);
  });
});
