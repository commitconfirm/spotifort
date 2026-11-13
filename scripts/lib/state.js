/**
 * Pure logic over data/<year>/state.json. No network, no file I/O.
 *
 * Record lifecycle per source (a missing field always means "not looked up yet", never "not found"):
 *   spotify     absent -> not searched or search failed (retried);  {confidence:'none'} -> searched, no result
 *               {confidence:'festival', via:'artist'|'album', albumId?} -> the festival's own link (see needsSpotify);
 *               `supersedes` holds the earlier search result when the festival link replaced a different one
 *   festival    absent -> performer feed not fetched yet (or the fetch failed; retried)
 *   mbid        undefined -> not looked up;  null -> looked up, MusicBrainz does not know the Spotify id
 *   lastfm      absent -> not fetched;  {notFound:true} -> Last.fm error 6;  {skipped:true} -> override said use none
 */
import { normalizeName } from '../../src/core/normalize.js';
import { MAX_REMOVED_FRACTION, MIN_SCRAPED_NAMES } from './constants.js';
import { festivalSpotifyTarget } from './festival.js';

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

/** The festival's own id for the artist (from the card's data-slug); a card with none leaves the record with none. */
function setSlug(record, slug) {
  if (slug) record.slug = slug;
  else delete record.slug;
}

/**
 * Merge the festival's lineup into the state. The lineup comes from the vendor API (entries carry `apiId` and a
 * ready `festival` block) or, as the fallback, from the festival's lineup page (entries carry the card's `slug`).
 *
 * An entry is matched to a record first by API id (`record.festival.id`), then by normalised name, so a performer
 * the festival renamed keeps its `n`, its resolved data and its overrides. A rename keeps the old name in
 * `formerNames` for as long as an override is still keyed by it (see overrideFor).
 * New names get the next n (never reused, removed records keep theirs). Names that vanished are marked
 * `removed` (never deleted); names that come back are restored with their old n. A cosmetic edit (same
 * normalised name) keeps the record, which then takes the festival's current spelling.
 * Refuses (throws, state untouched) under MIN_SCRAPED_NAMES names, or when more than half the lineup would go.
 *
 * @param {object} state
 * @param {(string|{name: string, slug?: string|null, apiId?: string, festival?: object})[]} scraped in source order.
 *   `slug`: when the key is present it replaces the record's slug (null deletes it); absent leaves it alone.
 *   `festival`: replaces the record's festival block.
 * @param {string} date YYYY-MM-DD
 * @param {{overrideIndex?: Map<string, object>}} [opts] from indexOverrides; prunes `formerNames` that no override uses
 * @returns {{state: object, added: string[], removed: string[], restored: string[], renamed: string[],
 *   renames: {from: string, to: string, n: number, cosmetic: boolean}[], duplicates: string[], festivalChanged: number}}
 */
export function mergeLineup(state, scraped, date, { overrideIndex = null } = {}) {
  const entries = [];
  const seenKeys = new Set();
  const duplicates = [];
  for (const raw of scraped) {
    const entry = typeof raw === 'string' ? { name: raw } : { ...raw };
    const key = normalizeName(entry.name);
    if (!key) continue;
    if (seenKeys.has(key)) {
      duplicates.push(entry.name);
      continue;
    }
    seenKeys.add(key);
    entries.push(entry);
  }

  const active = state.artists.filter((a) => !a.removed);
  if (entries.length < MIN_SCRAPED_NAMES) {
    throw new Error(`Only ${entries.length} artist names in the lineup (expected at least ${MIN_SCRAPED_NAMES}). Refusing to change the state.`);
  }

  const artists = state.artists.map((a) => ({ ...a }));
  const match = new Map(); // entry -> record
  const claimed = new Set();
  const byApiId = new Map();
  for (const a of artists) if (a.festival?.id && !byApiId.has(a.festival.id)) byApiId.set(a.festival.id, a);
  for (const e of entries) {
    const rec = e.apiId ? byApiId.get(e.apiId) : undefined;
    if (rec && !claimed.has(rec)) {
      match.set(e, rec);
      claimed.add(rec);
    }
  }
  const byName = new Map(artists.filter((a) => !claimed.has(a)).map((a) => [normalizeName(a.name), a]));
  for (const e of entries) {
    if (match.has(e)) continue;
    const rec = byName.get(normalizeName(e.name));
    if (rec && !claimed.has(rec)) {
      match.set(e, rec);
      claimed.add(rec);
    }
  }

  const stillThere = claimed.size;
  const wouldRemove = artists.filter((a) => !a.removed && !claimed.has(a)).length;
  if (active.length > 0 && wouldRemove > active.length * MAX_REMOVED_FRACTION) {
    throw new Error(
      `The new lineup would remove ${wouldRemove} of ${active.length} artists (only ${stillThere} names matched). ` +
      'The source probably changed. Refusing to change the state.'
    );
  }

  const taken = new Set(state.artists.map((a) => a.id));
  let nextN = state.artists.reduce((m, a) => Math.max(m, a.n), 0) + 1;
  const added = [];
  const restored = [];
  const renamed = [];
  const renames = [];
  let festivalChanged = 0;
  const existing = new Set(artists);
  const newFormer = new Map(); // record -> old names from real renames

  for (const e of entries) {
    const name = e.name;
    let rec = match.get(e);
    if (rec) {
      if ('slug' in e) setSlug(rec, e.slug ?? null);
      if (e.festival && JSON.stringify(rec.festival) !== JSON.stringify(e.festival)) {
        rec.festival = e.festival;
        festivalChanged++;
      }
      if (rec.name !== name) {
        const cosmetic = normalizeName(rec.name) === normalizeName(name);
        renamed.push(`${rec.name} -> ${name}`);
        renames.push({ from: rec.name, to: name, n: rec.n, cosmetic });
        if (!cosmetic) newFormer.set(rec, [...(newFormer.get(rec) ?? []), rec.name]);
        rec.name = name;
      }
      if (rec.removed) {
        delete rec.removed;
        restored.push(name);
      }
    } else {
      const n = nextN++;
      rec = { n, id: uniqueId(name, n, taken), name, firstSeen: date };
      if ('slug' in e) setSlug(rec, e.slug ?? null);
      if (e.festival) {
        rec.festival = e.festival;
        festivalChanged++;
      }
      artists.push(rec);
      claimed.add(rec);
      added.push(name);
    }
  }

  const removed = [];
  for (const rec of artists) {
    if (existing.has(rec) && !claimed.has(rec) && !rec.removed) {
      rec.removed = date;
      removed.push(rec.name);
    }
  }

  // formerNames: keep a name only while an override is keyed by it, and never one an active artist now uses.
  const currentKeys = new Set(artists.filter((a) => !a.removed).map((a) => normalizeName(a.name)));
  for (const rec of artists) {
    const all = [...(rec.formerNames ?? []), ...(newFormer.get(rec) ?? [])];
    const keep = [];
    for (const old of all) {
      const k = normalizeName(old);
      if (k === normalizeName(rec.name) || currentKeys.has(k) || keep.some((x) => normalizeName(x) === k)) continue;
      if (overrideIndex && !overrideIndex.has(k)) continue;
      keep.push(old);
    }
    if (keep.length) rec.formerNames = keep;
    else delete rec.formerNames;
  }

  const changed = added.length + removed.length + restored.length + renamed.length > 0;
  const next = { ...state, artists };
  if (changed || festivalChanged > 0) next.lastUpdated = date;
  // The report shows the last change list. Replace it when something changed, or on the first quiet later day
  // after a list that had entries; a quiet run after a quiet list leaves it alone so unchanged data changes no file.
  const prev = state.lastScrape;
  const prevQuiet = prev && (prev.added ?? []).length + (prev.removed ?? []).length + (prev.renamed ?? []).length === 0;
  if (changed || !prev || (!prevQuiet && prev.date !== date)) {
    next.lastScrape = { date, added, removed, ...(renames.length > 0 && { renamed: renames }) };
  }
  return { state: next, added, removed, restored, renamed, renames, duplicates, festivalChanged };
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

/**
 * Spotify resolution order: override, then the festival's artist link, then its album link (resolved through the
 * Spotify API to the album's artists), then search. The Spotify stage needs to act when:
 *  - there is no override, and the festival gave an artist/album link whose result is not stored yet (this
 *    includes replacing an earlier search result: the festival wins), or
 *  - a stored `festival` result no longer matches the festival's link (the link went away or changed), or
 *  - nothing is resolved (search).
 */
export function needsSpotify(record, override) {
  if (record.removed || Array.isArray(override.spotifyIds)) return false;
  const target = festivalSpotifyTarget(record);
  const sp = record.spotify;
  if (target) {
    if (!sp || sp.confidence !== 'festival') return true;
    return target.kind === 'artist' ? sp.ids?.[0] !== target.id || sp.via !== 'artist' : sp.via !== 'album' || sp.albumId !== target.id;
  }
  if (sp?.confidence === 'festival') return true; // its source link is gone: search again
  return !sp;
}

/**
 * Store the festival's Spotify result on a record. The festival wins over an earlier search result; when the
 * ids differ the earlier result is kept in `supersedes` so the review report can show the change.
 * @param {object} record
 * @param {{ids: string[], matchedName: string|null, via: 'artist'|'album', albumId?: string}} result
 */
export function applyFestivalSpotify(record, { ids, matchedName, via, albumId }) {
  const prev = record.spotify;
  const next = { ids, matchedName, confidence: 'festival', via };
  if (albumId) next.albumId = albumId;
  const earlier = prev && prev.confidence !== 'festival' ? prev : prev?.supersedes;
  if (earlier && (earlier.ids ?? []).length > 0 && earlier.ids.join() !== ids.join()) {
    next.supersedes = { ids: earlier.ids, matchedName: earlier.matchedName ?? null, confidence: earlier.confidence };
  }
  record.spotify = next;
}

/** Where the record's Spotify id came from, for the report: override | festival | festival-album | search | none | unresolved. */
export function spotifySource(record, override) {
  if (Array.isArray(override.spotifyIds)) return 'override';
  const sp = record.spotify;
  if (!sp) return 'unresolved';
  if (sp.confidence === 'festival') return sp.via === 'album' ? 'festival-album' : 'festival';
  return (sp.ids ?? []).length ? 'search' : 'none';
}

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
