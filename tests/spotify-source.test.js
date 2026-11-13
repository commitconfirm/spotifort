import { describe, it, expect, vi } from 'vitest';
import {
  createApi, fetchLikedSongs, fetchTopArtists, fetchFollowed, combineLibrary, importLibrary, mapLimit, retryAfterSeconds,
  SpotifyError, PAGE_SIZE, CONCURRENCY,
} from '../src/sources/spotify.js';
import { likedSongsWeight, topArtistWeight, followedWeight } from '../src/core/pool.js';

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});

/** A fake Spotify with a library of `songs` tracks; track i is by artist `a${i % artists}`. */
function fakeSpotify({ songs = 0, artists = 7, top = {}, followed = [], fail = {} } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = vi.fn(async (url, init) => {
    calls.push(url);
    expect(init.headers.Authorization).toBe('Bearer tok');
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const u = new URL(url);
    for (const [prefix, res] of Object.entries(fail)) if (u.pathname.startsWith(prefix)) return typeof res === 'function' ? res() : res;
    if (u.pathname === '/v1/me/tracks') {
      const offset = Number(u.searchParams.get('offset'));
      const limit = Number(u.searchParams.get('limit'));
      const items = [];
      for (let i = offset; i < Math.min(offset + limit, songs); i++) {
        items.push({ track: { artists: [{ id: `a${i % artists}`, name: `Artist ${i % artists}` }] } });
      }
      return json({ total: songs, items, next: offset + limit < songs ? 'x' : null });
    }
    if (u.pathname === '/v1/me/top/artists') return json({ items: top[u.searchParams.get('time_range')] ?? [] });
    if (u.pathname === '/v1/me/following') {
      const after = u.searchParams.get('after');
      const start = after ? followed.findIndex((a) => a.id === after) + 1 : 0;
      const page = followed.slice(start, start + 2);
      const more = start + 2 < followed.length;
      return json({ artists: { items: page, next: more ? 'x' : null, cursors: { after: more ? page[page.length - 1].id : null } } });
    }
    return json({}, 404);
  });
  return { fetch, calls, get maxInFlight() { return maxInFlight; } };
}

const noSleep = vi.fn(async () => {});

describe('createApi', () => {
  it('only ever sends the token to api.spotify.com', async () => {
    const f = fakeSpotify();
    const api = createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep });
    await expect(api.get('https://evil.example/steal')).rejects.toThrow(/unexpected host/);
    await expect(api.get('//evil.example/x')).rejects.toThrow(/unexpected host/);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('waits for Retry-After on 429 and retries', async () => {
    let n = 0;
    const fetch = vi.fn(async () => (++n === 1 ? json({}, 429, { 'Retry-After': '3' }) : json({ ok: 1 })));
    const sleep = vi.fn(async () => {});
    expect(await createApi({ token: 'tok', fetch, sleep }).get('me')).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it('gives up after repeated 429s with a plain message', async () => {
    const fetch = vi.fn(async () => json({}, 429));
    await expect(createApi({ token: 'tok', fetch, sleep: noSleep }).get('me')).rejects.toMatchObject({ kind: 'rate' });
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it('401 is an expired login, 403 forbidden, not retried', async () => {
    const f401 = vi.fn(async () => json({}, 401));
    await expect(createApi({ token: 'tok', fetch: f401, sleep: noSleep }).get('me')).rejects.toMatchObject({ kind: 'auth' });
    expect(f401).toHaveBeenCalledTimes(1);
    await expect(createApi({ token: 'tok', fetch: async () => json({}, 403), sleep: noSleep }).get('me')).rejects.toMatchObject({ kind: 'forbidden' });
  });
  it('retries server errors and network failures', async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError('offline');
      if (n === 2) return json({}, 503);
      return json({ fine: true });
    });
    expect(await createApi({ token: 'tok', fetch, sleep: noSleep }).get('me')).toEqual({ fine: true });
  });
  it('clamps Retry-After', () => {
    expect(retryAfterSeconds('5')).toBe(5);
    expect(retryAfterSeconds('9999')).toBe(30);
    expect(retryAfterSeconds(null)).toBe(1);
    expect(retryAfterSeconds('soon')).toBe(1);
  });
});

describe('mapLimit', () => {
  it('runs everything with bounded concurrency', async () => {
    let running = 0, peak = 0;
    const seen = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (x) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(x);
      running--;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
  });
});

describe('fetchLikedSongs', () => {
  it('reads every page in parallel from the total, counts songs per artist, and reports progress', async () => {
    const f = fakeSpotify({ songs: 1234, artists: 7 });
    const progress = [];
    const { counts, songs } = await fetchLikedSongs(createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep }), (p) => progress.push(p));
    expect(songs).toBe(1234);
    expect(f.calls).toHaveLength(Math.ceil(1234 / PAGE_SIZE));
    expect(new Set(f.calls).size).toBe(f.calls.length); // no page read twice
    expect(f.maxInFlight).toBeLessThanOrEqual(CONCURRENCY);
    expect(f.maxInFlight).toBeGreaterThan(1);
    expect([...counts.values()].reduce((s, c) => s + c.count, 0)).toBe(1234);
    expect(counts.get('a0')).toEqual({ name: 'Artist 0', count: 177 });
    expect(progress[0]).toEqual({ phase: 'liked', done: 50, total: 1234 });
    expect(progress.at(-1)).toEqual({ phase: 'liked', done: 1234, total: 1234 });
  });
  it('handles an empty library and skips local files without ids', async () => {
    const empty = await fetchLikedSongs(createApi({ token: 'tok', fetch: fakeSpotify({ songs: 0 }).fetch, sleep: noSleep }));
    expect(empty).toEqual({ counts: new Map(), songs: 0 });
    const fetch = async () => json({ total: 2, items: [{ track: { artists: [{ id: null, name: 'Local' }] } }, { track: null }] });
    expect((await fetchLikedSongs(createApi({ token: 'tok', fetch, sleep: noSleep }))).counts.size).toBe(0);
  });
});

describe('top and followed artists', () => {
  it('weights top artists by rank within each time range', async () => {
    const top = { medium_term: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }], long_term: [{ id: 't3', name: 'Three' }] };
    const out = await fetchTopArtists(createApi({ token: 'tok', fetch: fakeSpotify({ top }).fetch, sleep: noSleep }));
    expect(out).toEqual([
      { id: 't1', name: 'One', weight: topArtistWeight(0, 2) },
      { id: 't2', name: 'Two', weight: topArtistWeight(1, 2) },
      { id: 't3', name: 'Three', weight: 1 },
    ]);
  });
  it('follows the cursor through every page of followed artists', async () => {
    const followed = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
    const f = fakeSpotify({ followed });
    const out = await fetchFollowed(createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep }));
    expect(out.map((a) => a.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(out.every((a) => a.weight === followedWeight())).toBe(true);
    expect(f.calls[1]).toMatch(/after=f1/);
    expect(f.calls[0]).toMatch(/type=artist/);
  });
});

describe('combineLibrary', () => {
  it('one item per Spotify id with the highest weight from any list', () => {
    const liked = new Map([['a', { name: 'A', count: 1 }], ['b', { name: 'B', count: 40 }]]);
    const items = combineLibrary({ liked, top: [{ id: 'a', name: 'A', weight: 0.9 }], followed: [{ id: 'c', name: 'C', weight: 0.7 }, { id: 'b', name: 'B', weight: 0.7 }] });
    const by = Object.fromEntries(items.map((i) => [i.ids.spotify, i]));
    expect(Object.keys(by).sort()).toEqual(['a', 'b', 'c']);
    expect(by.a.weight).toBe(0.9);
    expect(by.b.weight).toBe(likedSongsWeight(40));
    expect(by.c).toEqual({ name: 'C', ids: { spotify: 'c' }, weight: 0.7 });
  });
});

describe('importLibrary', () => {
  it('carries on without top or followed artists when they are forbidden, and says so', async () => {
    const f = fakeSpotify({ songs: 60, fail: { '/v1/me/top': json({}, 403), '/v1/me/following': json({}, 403) } });
    const phases = [];
    const r = await importLibrary(createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep }), (p) => phases.push(p.phase));
    expect(r.missing).toEqual(['top artists', 'followed artists']);
    expect(r.items).toHaveLength(7);
    expect(r.songs).toBe(60);
    expect(phases.at(-1)).toBe('extras');
  });
  it('stops on an expired login, even in the optional parts', async () => {
    const f = fakeSpotify({ songs: 10, fail: { '/v1/me/top': json({}, 401) } });
    await expect(importLibrary(createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep }))).rejects.toBeInstanceOf(SpotifyError);
  });
  it('fails when Liked Songs cannot be read', async () => {
    const f = fakeSpotify({ fail: { '/v1/me/tracks': json({}, 403) } });
    await expect(importLibrary(createApi({ token: 'tok', fetch: f.fetch, sleep: noSleep }))).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
