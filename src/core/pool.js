// The visitor's artist pool: plain serialisable data plus pure functions (every function returns a new pool;
// nothing is mutated). Every library source (typed artists, Spotify, later Tidal and Apple Music) feeds one pool.
// Pure, no DOM, no storage. docs/ARCHITECTURE.md, "Pool to lineup recommendations".
//
// Pool:  { entries: Entry[] }
// Entry: { key, name, weight, sources: string[], sourceWeights: { [sourceId]: number }, ids: { [platform]: string }, n?: number }
//   key      normalised name; entries are unique by key
//   weight   the highest of sourceWeights (kept in step by every function here)
//   n        lineup number, present when the visitor picked a lineup artist from autocomplete
//   ids      platform artist ids from a library source, e.g. { spotify: '0abc...' }

import { normalizeName } from './normalize.js';

export const POOL_VERSION = 1;
export const MAX_POOL_ENTRIES = 5000;
export const MAX_NAME_LENGTH = 200;
const MAX_SERIALISED_LENGTH = 2_000_000;
const MAX_SOURCES_PER_ENTRY = 8;

export const SOURCE_TYPED = 'typed';
export const SOURCE_PICKED = 'picked';
const SOURCE_ID = /^[a-z0-9][a-z0-9:_-]{0,39}$/i;
const ID_PLATFORMS = new Set(['spotify', 'tidal', 'appleMusic', 'deezer']);
const PLATFORM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_N = 100000;

// --- weights ------------------------------------------------------------------------------------

export const WEIGHT_TYPED = 1;
export const WEIGHT_FOLLOWED = 0.7;
export const TOP_WEIGHT_FIRST = 1;
export const TOP_WEIGHT_LAST = 0.6;

/**
 * Weight of a Spotify top artist: 1.0 for rank 0 falling linearly to 0.6 for the last of `total`.
 * @param {number} rank zero-based position in the top list
 * @param {number} total length of the top list
 * @returns {number}
 */
export function topArtistWeight(rank, total) {
  if (!(total > 1) || !(rank > 0)) return TOP_WEIGHT_FIRST;
  const t = Math.min(rank, total - 1) / (total - 1);
  return TOP_WEIGHT_FIRST + (TOP_WEIGHT_LAST - TOP_WEIGHT_FIRST) * t;
}

/**
 * Weight of an artist from Liked Songs: min(1, 0.4 + 0.2 * log2(1 + count)).
 * @param {number} count liked songs by the artist
 * @returns {number}
 */
export function likedSongsWeight(count) {
  const c = Number.isFinite(count) && count > 0 ? count : 0;
  return Math.min(1, 0.4 + 0.2 * Math.log2(1 + c));
}

/** @returns {number} weight of a followed artist */
export function followedWeight() {
  return WEIGHT_FOLLOWED;
}

// --- construction -------------------------------------------------------------------------------

/** @returns {{ entries: object[] }} an empty pool */
export function emptyPool() {
  return { entries: [] };
}

const validWeight = (w) => (typeof w === 'number' && w > 0 && w <= 1 ? w : null);

function cleanIds(ids) {
  const out = {};
  if (ids && typeof ids === 'object') {
    for (const [platform, id] of Object.entries(ids)) {
      if (ID_PLATFORMS.has(platform) && typeof id === 'string' && PLATFORM_ID.test(id)) out[platform] = id;
    }
  }
  return out;
}

/** Build a valid entry from loose input, or null if it cannot be one. */
function makeEntry({ name, n, ids, sourceId, weight }) {
  const text = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!text || text.length > MAX_NAME_LENGTH) return null;
  const key = normalizeName(text);
  const w = validWeight(weight);
  if (!key || w === null || typeof sourceId !== 'string' || !SOURCE_ID.test(sourceId)) return null;
  const entry = { key, name: text, weight: w, sources: [sourceId], sourceWeights: { [sourceId]: w }, ids: cleanIds(ids) };
  if (Number.isInteger(n) && n >= 1 && n <= MAX_N) entry.n = n;
  return entry;
}

/** Merge b into a (same key): all sources, highest weight, first name unless b is a picked lineup artist, ids filled in. */
function mergeEntries(a, b) {
  const sourceWeights = { ...a.sourceWeights };
  for (const [id, w] of Object.entries(b.sourceWeights)) sourceWeights[id] = Math.max(sourceWeights[id] ?? 0, w);
  const sources = Object.keys(sourceWeights).slice(0, MAX_SOURCES_PER_ENTRY);
  const kept = {};
  for (const s of sources) kept[s] = sourceWeights[s];
  const merged = {
    key: a.key,
    name: b.n !== undefined && a.n === undefined ? b.name : a.name,
    weight: Math.max(...Object.values(kept)),
    sources,
    sourceWeights: kept,
    ids: { ...b.ids, ...a.ids },
  };
  const n = a.n ?? b.n;
  if (n !== undefined) merged.n = n;
  return merged;
}

/**
 * Add entries, merging duplicates by key. New keys beyond MAX_POOL_ENTRIES are dropped (merges always apply).
 * @param {{ entries: object[] }} pool
 * @param {object[]} incoming valid entries
 */
function addEntries(pool, incoming) {
  const map = new Map(pool.entries.map((e) => [e.key, e]));
  for (const e of incoming) {
    const existing = map.get(e.key);
    if (existing) map.set(e.key, mergeEntries(existing, e));
    else if (map.size < MAX_POOL_ENTRIES) map.set(e.key, e);
  }
  return { entries: [...map.values()] };
}

/**
 * Add an outside artist the visitor typed (by display name), weight 1.0.
 * @param {{ entries: object[] }} pool
 * @param {string} name
 * @returns {{ entries: object[] }} the pool unchanged if the name is unusable
 */
export function addTyped(pool, name) {
  const e = makeEntry({ name, sourceId: SOURCE_TYPED, weight: WEIGHT_TYPED });
  return e ? addEntries(pool, [e]) : pool;
}

/**
 * Add a lineup artist the visitor picked from autocomplete, by lineup number, weight 1.0.
 * @param {{ entries: object[] }} pool
 * @param {{ n: number, name: string }} artist the lineup artist (from the lineup index)
 * @returns {{ entries: object[] }}
 */
export function addPicked(pool, artist) {
  const e = makeEntry({ name: artist?.name, n: artist?.n, sourceId: SOURCE_PICKED, weight: WEIGHT_TYPED });
  return e && e.n !== undefined ? addEntries(pool, [e]) : pool;
}

/**
 * Add a batch from a library source. Items that are malformed are skipped. If the batch would overflow the
 * pool, the highest-weight items are kept. Re-adding a source id does not clear its earlier entries; call
 * clearSource first to replace.
 * @param {{ entries: object[] }} pool
 * @param {string} sourceId e.g. 'spotify:liked', 'spotify:top', 'spotify:followed'
 * @param {{ name: string, ids?: Record<string, string>, weight: number }[]} items
 * @returns {{ entries: object[] }}
 */
export function addBatch(pool, sourceId, items) {
  if (!Array.isArray(items)) return pool;
  const incoming = [];
  for (const item of items) {
    const e = item && makeEntry({ name: item.name, ids: item.ids, sourceId, weight: item.weight });
    if (e) incoming.push(e);
  }
  incoming.sort((a, b) => b.weight - a.weight); // stable: ties keep source order
  return addEntries(pool, incoming);
}

/**
 * Remove an entry (all of its sources).
 * @param {{ entries: object[] }} pool
 * @param {string} key
 * @returns {{ entries: object[] }}
 */
export function removeEntry(pool, key) {
  return { entries: pool.entries.filter((e) => e.key !== key) };
}

/**
 * Remove some sources from one entry; the entry disappears if no source is left, otherwise it is re-weighted.
 * Used when the visitor removes an artist they added by hand that a library source also holds: the library keeps it.
 * @param {{ entries: object[] }} pool
 * @param {string} key
 * @param {string[]} sourceIds
 * @returns {{ entries: object[] }}
 */
export function removeSources(pool, key, sourceIds) {
  const drop = new Set(sourceIds);
  const entries = [];
  for (const e of pool.entries) {
    if (e.key !== key) {
      entries.push(e);
      continue;
    }
    const sourceWeights = {};
    for (const [id, w] of Object.entries(e.sourceWeights)) if (!drop.has(id)) sourceWeights[id] = w;
    const sources = Object.keys(sourceWeights);
    if (!sources.length) continue;
    const kept = { ...e, sources, sourceWeights, weight: Math.max(...Object.values(sourceWeights)) };
    if (drop.has(SOURCE_PICKED)) delete kept.n;
    entries.push(kept);
  }
  return { entries };
}

/**
 * Remove one source from every entry; entries left with no source disappear, the rest are re-weighted.
 * @param {{ entries: object[] }} pool
 * @param {string} sourceId
 * @returns {{ entries: object[] }}
 */
export function clearSource(pool, sourceId) {
  const entries = [];
  for (const e of pool.entries) {
    if (!(sourceId in e.sourceWeights)) {
      entries.push(e);
      continue;
    }
    const sourceWeights = { ...e.sourceWeights };
    delete sourceWeights[sourceId];
    const sources = Object.keys(sourceWeights);
    if (!sources.length) continue;
    entries.push({ ...e, sources, sourceWeights, weight: Math.max(...Object.values(sourceWeights)) });
  }
  return { entries };
}

// --- serialisation ------------------------------------------------------------------------------

/**
 * Serialise a pool to a JSON string with a version field. Derived fields (key, weight, sources) are not stored.
 * @param {{ entries: object[] }} pool
 * @returns {string}
 */
export function serialise(pool) {
  const entries = pool.entries.slice(0, MAX_POOL_ENTRIES).map((e) => {
    const o = { name: e.name, sw: e.sourceWeights };
    if (e.n !== undefined) o.n = e.n;
    if (Object.keys(e.ids).length) o.ids = e.ids;
    return o;
  });
  return JSON.stringify({ v: POOL_VERSION, entries });
}

/**
 * Parse and strictly validate a serialised pool. Never throws: malformed input gives an empty pool, malformed
 * entries are dropped, keys and weights are recomputed rather than trusted, and the pool is capped.
 * @param {unknown} text
 * @returns {{ entries: object[] }}
 */
export function deserialise(text) {
  if (typeof text !== 'string' || text.length > MAX_SERIALISED_LENGTH) return emptyPool();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyPool();
  }
  if (!data || typeof data !== 'object' || data.v !== POOL_VERSION || !Array.isArray(data.entries)) return emptyPool();

  const incoming = [];
  for (const raw of data.entries) {
    if (!raw || typeof raw !== 'object' || !raw.sw || typeof raw.sw !== 'object' || Array.isArray(raw.sw)) continue;
    let entry = null;
    for (const [sourceId, weight] of Object.entries(raw.sw).slice(0, MAX_SOURCES_PER_ENTRY)) {
      const part = makeEntry({ name: raw.name, n: raw.n, ids: raw.ids, sourceId, weight });
      if (part) entry = entry ? mergeEntries(entry, part) : part;
    }
    if (entry) incoming.push(entry);
  }
  return addEntries(emptyPool(), incoming);
}
