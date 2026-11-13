/**
 * Pure parsing of Last.fm responses. No network, no file I/O.
 * Last.fm reports "artist not found" as error 6; everything else in the body is treated as data.
 */
import { normalizeName } from '../../src/core/normalize.js';
import { filterGenres } from './genre-filter.js';
import { LASTFM_MIN_TAG_COUNT, LASTFM_SIMILAR_LIMIT } from './constants.js';

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Last.fm answers a single result as an object instead of a one-element array. */
export const NOT_FOUND = Symbol('lastfm-not-found');

/**
 * @param {object} body artist.getInfo response
 * @returns {{resolvedName: string, listeners: number|null, url: string|null}|typeof NOT_FOUND}
 * @throws when the body is neither an artist nor error 6
 */
export function parseInfo(body) {
  if (body?.error === 6) return NOT_FOUND;
  const a = body?.artist;
  if (!a || typeof a.name !== 'string') throw new Error('unexpected artist.getInfo response');
  const listeners = Number.parseInt(a.stats?.listeners, 10);
  return { resolvedName: a.name, listeners: Number.isFinite(listeners) ? listeners : null, url: typeof a.url === 'string' ? a.url : null };
}

/**
 * @param {object} body artist.getSimilar response
 * @returns {Array<[string, number]>} [name, match] in Last.fm order, match rounded to 3 places, at most 250
 */
export function parseSimilar(body) {
  if (body?.error) return [];
  const seen = new Map();
  for (const a of arr(body?.similarartists?.artist)) {
    const match = Number.parseFloat(a?.match);
    if (typeof a?.name !== 'string' || !a.name || !Number.isFinite(match)) continue;
    const value = Math.round(match * 1000) / 1000;
    if (!seen.has(a.name) || seen.get(a.name) < value) seen.set(a.name, value);
  }
  return [...seen].slice(0, LASTFM_SIMILAR_LIMIT);
}

/**
 * @param {object} body artist.getTopTags response
 * @param {string[]} names artist names to drop when used as a tag
 * @returns {Array<[string, number]>} [tag, count] with count >= 10, lowercase, non-genre tags removed, best first
 */
export function parseTags(body, names = []) {
  if (body?.error) return [];
  const out = new Map();
  for (const t of arr(body?.toptags?.tag)) {
    const count = Number(t?.count);
    const tag = typeof t?.name === 'string' ? t.name.trim().toLowerCase() : '';
    if (!tag || !Number.isFinite(count) || count < LASTFM_MIN_TAG_COUNT) continue;
    if (names.some((n) => filterGenres([tag], n).length === 0)) continue;
    out.set(tag, Math.max(out.get(tag) ?? 0, count));
  }
  return [...out].sort((a, b) => b[1] - a[1]);
}

/**
 * @param {string} queried
 * @param {string} resolved what Last.fm's autocorrect returned
 * @returns {'no'|'cosmetic'|'different'} cosmetic = equal after normalisation (case, "&", punctuation)
 */
export function classifyNameChange(queried, resolved) {
  if (queried === resolved) return 'no';
  return normalizeName(queried) === normalizeName(resolved) ? 'cosmetic' : 'different';
}

/**
 * @param {string} queried
 * @param {{info: object, similar?: object, tags?: object}} bodies raw responses
 * @returns {object} the `lastfm` field of a state record
 */
export function buildLastfmRecord(queried, { info, similar, tags }) {
  const parsed = parseInfo(info);
  if (parsed === NOT_FOUND) {
    return { queriedName: queried, resolvedName: null, nameChanged: null, notFound: true, listeners: null, url: null, similar: [], tags: [] };
  }
  return {
    queriedName: queried,
    resolvedName: parsed.resolvedName,
    nameChanged: classifyNameChange(queried, parsed.resolvedName),
    listeners: parsed.listeners,
    url: parsed.url,
    similar: parseSimilar(similar),
    tags: parseTags(tags, [queried, parsed.resolvedName]),
  };
}

export function skippedLastfmRecord() {
  return { queriedName: null, resolvedName: null, nameChanged: null, skipped: true, listeners: null, url: null, similar: [], tags: [] };
}
