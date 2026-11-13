// Library source: Spotify. Reads Liked Songs, top artists (medium and long term) and followed artists, and turns
// them into ONE pool source ('spotify') of { name, ids: { spotify }, weight } items. docs/ARCHITECTURE.md,
// "App modules". A later Tidal module is a sibling with the same shape (id, label, isAvailable, connect, fetchArtists).
//
// The paging, retry and weighting logic takes an injected fetch and sleep, so it is unit tested without a network
// (tests/spotify-source.test.js). The bearer token is only ever sent to https://api.spotify.com/.
//
// Endpoint limits checked against the Web API reference on 2026-11-13 (unchanged by the February 2026 changes,
// which reduced only search to 10 per page): GET /me/tracks limit 1..50 with offset and `total`;
// GET /me/top/artists limit 1..50, time_range short_term|medium_term|long_term; GET /me/following?type=artist
// limit 1..50, cursor paging via `artists.cursors.after`, response wrapped in `artists`.

import { cryptoAvailable, getAccessToken, startAuth } from '../auth.js';
import { followedWeight, likedSongsWeight, topArtistWeight } from '../core/pool.js';
import { log } from '../log.js';

export const SOURCE_ID = 'spotify';
const API_ORIGIN = 'https://api.spotify.com/';
const API_BASE = `${API_ORIGIN}v1/`;
export const PAGE_SIZE = 50;
export const CONCURRENCY = 4;
export const TOP_RANGES = ['medium_term', 'long_term'];
const MAX_ATTEMPTS = 5;
const MAX_RETRY_AFTER_S = 30;
const MAX_FOLLOWED_PAGES = 200;

/** A Spotify call that failed. kind: 'auth' (token expired or revoked), 'forbidden', 'rate', 'http', 'network'. */
export class SpotifyError extends Error {
  constructor(message, { kind, status } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.kind = kind;
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Seconds to wait from a Retry-After header (seconds form), clamped to [1, MAX_RETRY_AFTER_S].
 * @param {string|null} value
 */
export function retryAfterSeconds(value) {
  const s = Number.parseInt(value ?? '', 10);
  return Number.isFinite(s) && s > 0 ? Math.min(s, MAX_RETRY_AFTER_S) : 1;
}

/**
 * A tiny GET client for the Web API.
 * @param {{ token: string, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void> }} options
 * @returns {{ get: (path: string) => Promise<any> }} path relative to /v1/, e.g. 'me/tracks?limit=50'
 */
export function createApi({ token, fetch: fetchFn = (...a) => globalThis.fetch(...a), sleep = defaultSleep }) {
  return {
    async get(path) {
      const url = new URL(path, API_BASE).href;
      // The bearer token must only ever go to Spotify's API host.
      if (!url.startsWith(API_ORIGIN)) throw new Error('Refusing to send the access token to an unexpected host');
      for (let attempt = 1; ; attempt++) {
        let res;
        try {
          res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) throw new SpotifyError('Could not reach Spotify. Check your connection and try again.', { kind: 'network' });
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        if (res.ok) return res.json();
        if (res.status === 401) throw new SpotifyError('Your Spotify login has expired. Please connect again.', { kind: 'auth', status: 401 });
        if (res.status === 403) throw new SpotifyError('Spotify did not allow this request.', { kind: 'forbidden', status: 403 });
        if (attempt < MAX_ATTEMPTS && res.status === 429) {
          const wait = retryAfterSeconds(res.headers?.get?.('Retry-After'));
          log.warn(`Spotify rate limit; waiting ${wait}s`);
          await sleep(wait * 1000);
          continue;
        }
        if (attempt < MAX_ATTEMPTS && res.status >= 500) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw new SpotifyError(
          res.status === 429 ? 'Spotify is busy right now. Please try again in a minute.' : `Spotify returned an error (${res.status}). Please try again.`,
          { kind: res.status === 429 ? 'rate' : 'http', status: res.status }
        );
      }
    },
  };
}

/** Run fn over items with at most `limit` in flight. Rejects on the first failure. */
export async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** Add a page of saved tracks to per-artist counts. Local files (no id) are skipped. */
function countPage(items, counts) {
  for (const item of Array.isArray(items) ? items : []) {
    for (const a of Array.isArray(item?.track?.artists) ? item.track.artists : []) {
      if (typeof a?.id !== 'string' || !a.id || typeof a.name !== 'string') continue;
      const c = counts.get(a.id);
      if (c) c.count++;
      else counts.set(a.id, { name: a.name, count: 1 });
    }
  }
}

/**
 * Every Liked Song, read in parallel pages once the first page gives the total.
 * @param {{ get: Function }} api
 * @param {(p: { phase: 'liked', done: number, total: number }) => void} [onProgress]
 * @returns {Promise<{ counts: Map<string, { name: string, count: number }>, songs: number }>}
 */
export async function fetchLikedSongs(api, onProgress = () => {}) {
  const counts = new Map();
  const first = await api.get(`me/tracks?limit=${PAGE_SIZE}&offset=0`);
  const total = Number.isInteger(first?.total) && first.total >= 0 ? first.total : 0;
  countPage(first?.items, counts);
  let done = Array.isArray(first?.items) ? first.items.length : 0;
  onProgress({ phase: 'liked', done, total });
  const offsets = [];
  for (let o = PAGE_SIZE; o < total; o += PAGE_SIZE) offsets.push(o);
  await mapLimit(offsets, CONCURRENCY, async (offset) => {
    const page = await api.get(`me/tracks?limit=${PAGE_SIZE}&offset=${offset}`);
    countPage(page?.items, counts);
    done += Array.isArray(page?.items) ? page.items.length : 0;
    onProgress({ phase: 'liked', done: Math.min(done, total), total });
  });
  log.info(`Liked Songs: ${done} songs, ${counts.size} artists, ${offsets.length + 1} requests`);
  return { counts, songs: done };
}

/**
 * Top artists for each time range, weighted by rank within that range.
 * @returns {Promise<{ id: string, name: string, weight: number }[]>}
 */
export async function fetchTopArtists(api) {
  const out = [];
  for (const range of TOP_RANGES) {
    const data = await api.get(`me/top/artists?limit=${PAGE_SIZE}&time_range=${range}`);
    const items = (Array.isArray(data?.items) ? data.items : []).filter((a) => typeof a?.id === 'string' && typeof a?.name === 'string');
    items.forEach((a, rank) => out.push({ id: a.id, name: a.name, weight: topArtistWeight(rank, items.length) }));
  }
  return out;
}

/**
 * Every followed artist (cursor paging).
 * @returns {Promise<{ id: string, name: string, weight: number }[]>}
 */
export async function fetchFollowed(api) {
  const out = [];
  let after = null;
  for (let page = 0; page < MAX_FOLLOWED_PAGES; page++) {
    const q = `me/following?type=artist&limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const data = (await api.get(q))?.artists;
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const a of items) if (typeof a?.id === 'string' && typeof a?.name === 'string') out.push({ id: a.id, name: a.name, weight: followedWeight() });
    after = data?.cursors?.after ?? null;
    if (!data?.next || !after || !items.length) break;
  }
  return out;
}

/**
 * Merge the three lists into pool items, one per Spotify artist id, taking the highest weight.
 * @param {{ liked?: Map<string, { name: string, count: number }>, top?: object[], followed?: object[] }} parts
 * @returns {{ name: string, ids: { spotify: string }, weight: number }[]}
 */
export function combineLibrary({ liked = new Map(), top = [], followed = [] }) {
  const byId = new Map();
  const put = (id, name, weight) => {
    const cur = byId.get(id);
    if (!cur) byId.set(id, { name, ids: { spotify: id }, weight });
    else if (weight > cur.weight) cur.weight = weight;
  };
  for (const [id, { name, count }] of liked) put(id, name, likedSongsWeight(count));
  for (const a of top) put(a.id, a.name, a.weight);
  for (const a of followed) put(a.id, a.name, a.weight);
  return [...byId.values()];
}

/**
 * Read the whole library. Liked Songs are required; top and followed artists are optional extras (a 403, e.g. a
 * scope that was not granted, or another failure is reported in `missing` and the import carries on). An expired
 * login always stops the import.
 * @param {{ get: Function }} api
 * @param {(p: object) => void} [onProgress] { phase: 'liked', done, total } then { phase: 'extras' }
 * @returns {Promise<{ items: object[], songs: number, missing: string[] }>}
 */
export async function importLibrary(api, onProgress = () => {}) {
  const { counts, songs } = await fetchLikedSongs(api, onProgress);
  onProgress({ phase: 'extras' });
  const missing = [];
  const optional = async (label, fn) => {
    try {
      return await fn(api);
    } catch (err) {
      if (err?.kind === 'auth') throw err;
      log.warn(`Could not read ${label}:`, err?.message);
      missing.push(label);
      return [];
    }
  };
  const top = await optional('top artists', fetchTopArtists);
  const followed = await optional('followed artists', fetchFollowed);
  const items = combineLibrary({ liked: counts, top, followed });
  log.info(`Spotify import: ${songs} songs, ${counts.size} liked artists, ${top.length} top entries, ${followed.length} followed; ${items.length} artists`);
  return { items, songs, missing };
}

/** The Spotify source, as the app uses it. */
export const spotifySource = {
  id: SOURCE_ID,
  label: 'Spotify',
  /** @returns {boolean} whether this browser can log in (PKCE needs Web Crypto) */
  isAvailable: () => cryptoAvailable(),
  /** Redirects to Spotify. @param {string} clientId */
  connect: (clientId) => startAuth(clientId),
  /** @returns {boolean} whether a token from this page load is in memory (so a refresh needs no redirect) */
  isConnected: () => getAccessToken() !== null,
  /**
   * @param {(p: object) => void} [onProgress]
   * @returns {Promise<{ items: { name: string, ids: object, weight: number }[], songs: number, missing: string[] }>}
   */
  fetchArtists(onProgress) {
    const token = getAccessToken();
    if (!token) return Promise.reject(new SpotifyError('Your Spotify login has expired. Please connect again.', { kind: 'auth' }));
    return importLibrary(createApi({ token }), onProgress);
  },
};
