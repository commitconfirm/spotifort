/**
 * Pure logic over data/<year>/state.json. No network, no file I/O.
 *
 * Record lifecycle per source (a missing field always means "not looked up yet", never "not found"):
 *   spotify     absent -> not searched or search failed (retried);  {confidence:'none'} -> searched, no result
 *   mbid        undefined -> not looked up;  null -> looked up, MusicBrainz does not know the Spotify id
 *   lastfm      absent -> not fetched;  {notFound:true} -> Last.fm error 6;  {skipped:true} -> override said use none
 */
import { normalizeName } from '../../src/core/normalize.js';
import { MAX_REMOVED_FRACTION, MIN_SCRAPED_NAMES } from './constants.js';

export function emptyState(year) {
  return { year, lastUpdated: null, lastScrape: null, artists: [] };
}

/**
 * Lowercase, accent-free, hyphen-separated id. Keeps non-Latin letters.
 * @param {string} name
 * @returns {string} may be '' for names with no letters or digits
 */
export function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {string} name
 * @param {number} n
 * @param {Set<string>} taken ids already in use; the returned id is added to it
 * @returns {string}
 */
export function uniqueId(name, n, taken) {
  const base = slugify(name) || `artist-${n}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

/**
 * Merge the festival site's names into the state.
 * New names get the next n (never reused, removed records keep theirs). Names that vanished are marked
 * `removed` (never deleted); names that come back are restored with their old n.
 * Matching is exact first, then by normalised name, so a cosmetic site edit keeps the artist's n
 * (the record then takes the site's current spelling).
 * @param {object} state
 * @param {string[]} names scraped names, page order
 * @param {string} date YYYY-MM-DD
 * @returns {{state: object, added: string[], removed: string[], restored: string[], renamed: string[]}}
 */
export function mergeScrape(state, names, date) {
  const unique = [];
  const seenKeys = new Set();
  for (const name of names) {
    const key = normalizeName(name);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(name);
  }

  const active = state.artists.filter((a) => !a.removed);
  if (unique.length < MIN_SCRAPED_NAMES) {
    throw new Error(`Only ${unique.length} artist names scraped (expected at least ${MIN_SCRAPED_NAMES}). Refusing to change the state.`);
  }
  const stillThere = state.artists.filter((a) => seenKeys.has(normalizeName(a.name))).length;
  const wouldRemove = active.filter((a) => !seenKeys.has(normalizeName(a.name))).length;
  if (active.length > 0 && wouldRemove > active.length * MAX_REMOVED_FRACTION) {
    throw new Error(
      `The scrape would remove ${wouldRemove} of ${active.length} artists (only ${stillThere} names matched). ` +
      'The page probably changed. Refusing to change the state.'
    );
  }

  const taken = new Set(state.artists.map((a) => a.id));
  let nextN = state.artists.reduce((m, a) => Math.max(m, a.n), 0) + 1;

  const added = [];
  const restored = [];
  const renamed = [];
  const touched = new Set();
  const artists = state.artists.map((a) => ({ ...a }));
  const index = new Map(artists.map((a) => [normalizeName(a.name), a]));
  const existing = new Set(artists);

  for (const name of unique) {
    const key = normalizeName(name);
    const rec = index.get(key);
    if (rec) {
      touched.add(rec);
      if (rec.name !== name) {
        renamed.push(`${rec.name} -> ${name}`);
        rec.name = name;
      }
      if (rec.removed) {
        delete rec.removed;
        restored.push(name);
      }
    } else {
      const n = nextN++;
      const fresh = { n, id: uniqueId(name, n, taken), name, firstSeen: date };
      artists.push(fresh);
      touched.add(fresh);
      added.push(name);
    }
  }

  const removed = [];
  for (const rec of artists) {
    if (existing.has(rec) && !touched.has(rec) && !rec.removed) {
      rec.removed = date;
      removed.push(rec.name);
    }
  }

  const changed = added.length + removed.length + restored.length + renamed.length > 0;
  const next = { ...state, artists };
  if (changed) next.lastUpdated = date;
  // Keep the last non-empty change list for the review report until a later day's scrape replaces it.
  if (changed || !state.lastScrape || state.lastScrape.date !== date) {
    next.lastScrape = { date, added, removed };
  }
  return { state: next, added, removed, restored, renamed };
}

/**
 * Choose the Spotify result for a festival name.
 * "Exact" means equal after normalisation (so "&" vs "and" and case do not count as a difference).
 * One exact hit: exact. Several: ambiguous (the first, Spotify's own relevance order, is used). None: inexact top hit.
 * @param {string} name
 * @param {Array|undefined} results data.artists.items from Spotify search
 * @returns {{ids: string[], matchedName: string, confidence: 'exact'|'inexact'|'ambiguous'}|null} null when no results
 */
export function pickSpotifyMatch(name, results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const wanted = normalizeName(name);
  const exact = results.filter((a) => a?.id && normalizeName(a.name) === wanted);
  const artist = exact[0] ?? results.find((a) => a?.id);
  if (!artist) return null;
  const confidence = exact.length === 0 ? 'inexact' : exact.length === 1 ? 'exact' : 'ambiguous';
  return { ids: [artist.id], matchedName: artist.name ?? name, confidence };
}

/**
 * The record as the rest of the pipeline sees it once overrides are applied.
 * Stages use this to decide what to look up; build uses it to produce outputs.
 * @param {object} record state record
 * @param {object} override from overrideFor (may be {})
 */
export function effectiveSpotify(record, override) {
  if (Array.isArray(override.spotifyIds)) {
    return { ids: override.spotifyIds, confidence: 'manual', matchedName: record.spotify?.matchedName ?? null, resolved: true };
  }
  if (!record.spotify) return { ids: [], confidence: null, matchedName: null, resolved: false };
  return { ids: record.spotify.ids ?? [], confidence: record.spotify.confidence, matchedName: record.spotify.matchedName ?? null, resolved: true };
}

export const primarySpotifyId = (record, override) => effectiveSpotify(record, override).ids[0] ?? null;

export const needsSpotify = (record, override) => !record.removed && !effectiveSpotify(record, override).resolved;

/** MusicBrainz id lookup is needed when there is a Spotify id and no answer for that id yet. */
export function needsMbid(record, override) {
  if (record.removed || 'mbid' in override) return false;
  const id = primarySpotifyId(record, override);
  return Boolean(id) && (record.mbid === undefined || record.mbFor !== id);
}

/** The MusicBrainz id to read links from: an override wins. */
export function effectiveMbid(record, override) {
  return 'mbid' in override ? override.mbid : (record.mbid ?? null);
}

export function needsMbLinks(record, override) {
  if (record.removed) return false;
  const mbid = effectiveMbid(record, override);
  // mbName was added later: records fetched before it get one more (cached) read
  return Boolean(mbid) && (record.mbFetched !== mbid || typeof record.mbName !== 'string');
}

/** The name to ask Last.fm for, or null for "use no Last.fm data". */
export function lastfmQueryName(record, override) {
  return 'lastfmName' in override ? override.lastfmName : record.name;
}

export function needsLastfm(record, override) {
  if (record.removed) return false;
  const q = lastfmQueryName(record, override);
  if (q === null) return !record.lastfm?.skipped;
  return !record.lastfm || record.lastfm.queriedName !== q;
}
