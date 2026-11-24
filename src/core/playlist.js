// Pure logic for the Spotify playlist made from a visitor's Treefort picks. No DOM, no fetch, no clock:
// the caller does the I/O and passes data in. Decides who gets tracks (the plan), which tracks count as the
// artist's own (not another artist with the same name), how versions of one song collapse, which releases are
// the newest, and how the final list is cut into add requests. Written to survive malformed API data: junk is
// skipped, never thrown on. See docs/PLAN-2027.md, "Playlist creation".

import { normalizeName } from './normalize.js';

export const TRACKS_PER_ARTIST = 3;
export const MAX_RELEASES = 3;
export const ADD_BATCH_SIZE = 100;
export const LEFT_OUT = Object.freeze({ UNVERIFIED: 'unverified', NO_SPOTIFY: 'no-spotify', NO_TRACKS: 'no-tracks', QUOTA: 'quota', LOOKUP_FAILED: 'lookup-failed' });
export const PLAYLIST_DESCRIPTION = 'Made with spotifort.com. Not affiliated with Treefort Music Fest or Spotify.';

const MAX_TITLE = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {unknown} value
 * @returns {boolean} true for a non-empty string of ASCII letters and digits (safe in a URL path or URI)
 */
export function isSpotifyId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]+$/.test(value);
}

/**
 * Decides which picks get tracks. Order: matches, then recommendations, as given.
 * @param {{ matches?: { n: number }[], recommendations?: { n: number }[] }} results
 * @param {{ byN: (n: number) => any }} lineup
 * @returns {{ artists: { n: number, name: string, spotifyIds: string[] }[], leftOut: { n: number, name: string, reason: string }[] }}
 */
export function playlistPlan(results, lineup) {
  const artists = [];
  const leftOut = [];
  const seen = new Set();
  const rows = [
    ...(Array.isArray(results?.matches) ? results.matches : []),
    ...(Array.isArray(results?.recommendations) ? results.recommendations : []),
  ];
  for (const row of rows) {
    const n = row?.n;
    if (seen.has(n)) continue;
    const a = lineup?.byN?.(n);
    if (!a) continue;
    seen.add(n);
    const name = typeof a.name === 'string' ? a.name : '';
    if (a.unverified === true) {
      leftOut.push({ n, name, reason: LEFT_OUT.UNVERIFIED });
      continue;
    }
    const ids = [...new Set((Array.isArray(a.spotifyIds) ? a.spotifyIds : []).filter(isSpotifyId))];
    if (ids.length === 0) leftOut.push({ n, name, reason: LEFT_OUT.NO_SPOTIFY });
    else artists.push({ n, name, spotifyIds: ids });
  }
  return { artists, leftOut };
}

/**
 * @param {{ artists: unknown[] }} plan
 * @returns {{ artists: number, tracks: number }}
 */
export function planEstimate(plan) {
  const artists = Array.isArray(plan?.artists) ? plan.artists.length : 0;
  return { artists, tracks: artists * TRACKS_PER_ARTIST };
}

const VERSION_WORDS = [
  'feat', 'ft', 'featuring', 'with', 'acoustic', 'remix', 'remixed', 'mix', 'remaster', 'remastered', 'live', 'version',
  'edit', 'edited', 'sped up', 'slowed', 'reverb', 'demo', 'instrumental', 'mono', 'stereo', 'deluxe', 'bonus', 'single',
  'album', 'radio', 'extended', 'original', 're-recorded', 'rerecorded', 'stripped', 'session', 'sessions', 'unplugged',
  'explicit', 'clean', 'piano', 'spotify singles', 'recorded at',
];
// Whole words: not preceded or followed by a letter or digit. One alternation of literals, linear time.
const VERSION_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${VERSION_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const GROUP_RE = /\([^()]*\)|\[[^[\]]*\]/g;
const DASH_RE = / [-\u2013\u2014] /g;
// A bare trailing featured credit: "Song feat. Bob", "Song ft Bob & Al". No nested quantifiers: each start position
// costs O(1) until the final [\s\S]* consumes the rest once.
const FEAT_RE = /\s(?:feat\.?|ft\.?|featuring)\s[\s\S]*/i;

function stripVersions(title) {
  let s = title.slice(0, MAX_TITLE);
  let removed = false;
  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    s = s.replace(GROUP_RE, (g) => {
      if (VERSION_RE.test(g)) { changed = true; return ' '; }
      return g;
    });
    // Only the last " - " separator starts a trailing suffix.
    let last = -1;
    let len = 0;
    DASH_RE.lastIndex = 0;
    for (let m = DASH_RE.exec(s); m; m = DASH_RE.exec(s)) { last = m.index; len = m[0].length; }
    if (last >= 0 && VERSION_RE.test(s.slice(last + len))) { s = s.slice(0, last); changed = true; }
    // A featured credit with no brackets or dash, only when a title remains before it.
    const feat = FEAT_RE.exec(s);
    if (feat && s.slice(0, feat.index).trim()) { s = s.slice(0, feat.index); changed = true; }
    if (!changed) break;
    removed = true;
  }
  return { rest: s, removed };
}

/**
 * The key under which versions of one song collapse ("Song", "Song - Demo", "Song (Acoustic)" ...).
 * @param {unknown} title
 * @returns {string}
 */
export function songKey(title) {
  if (typeof title !== 'string') return '';
  const { rest } = stripVersions(title);
  return normalizeName(rest) || normalizeName(title.slice(0, MAX_TITLE));
}

/**
 * @param {unknown} title
 * @returns {boolean} true when the title carries at least one version decoration
 */
export function isVersionTitle(title) {
  return typeof title === 'string' && stripVersions(title).removed;
}

/**
 * Picks up to `limit` own tracks, one per song, listed-first tracks and plain titles preferred.
 * @param {unknown} candidates Spotify track objects
 * @param {string[]} spotifyIds the lineup artist's Spotify ids
 * @param {{ limit?: number, already?: { id: string, name: string }[], exclude?: Set<string>|null }} [options]
 *   `exclude`: track ids that must not be chosen (for example tracks another artist has already been given). When an
 *   excluded track is one of this artist's own, its other versions in `candidates` (same song key) are left out too.
 * @returns {{ id: string, name: string }[]} `already` first, then new tracks, at most `limit` in all
 */
export function chooseOwnTracks(candidates, spotifyIds, { limit = TRACKS_PER_ARTIST, already = [], exclude = null } = {}) {
  const have = Array.isArray(already) ? already.filter((t) => t && typeof t === 'object') : [];
  if (have.length >= limit) return have.slice(0, limit);
  const ids = new Set(Array.isArray(spotifyIds) ? spotifyIds.filter(isSpotifyId) : []);
  const usedIds = new Set(have.map((t) => t.id));
  const usedKeys = new Set(have.map((t) => songKey(t.name)));
  const groups = new Map();
  const list = Array.isArray(candidates) ? candidates : [];
  const seenIds = new Set();
  // A song another artist holds (its id is in `exclude`) is blocked in every version this artist lists too: otherwise
  // "Duet" under one artist and "Duet - Live" under the next would both reach the playlist. Keys are per artist, never
  // global: two different artists may each have a song called "Home".
  const blockedKeys = new Set();
  if (exclude) {
    for (const t of list) {
      if (!t || typeof t !== 'object' || !isSpotifyId(t.id) || typeof t.name !== 'string' || !Array.isArray(t.artists)) continue;
      if (!exclude.has(t.id) || !t.artists.some((a) => ids.has(a?.id))) continue;
      const key = songKey(t.name);
      if (key) blockedKeys.add(key);
    }
  }
  list.forEach((t, pos) => {
    if (!t || typeof t !== 'object' || !isSpotifyId(t.id) || typeof t.name !== 'string' || !Array.isArray(t.artists)) return;
    if (seenIds.has(t.id) || usedIds.has(t.id) || (exclude && exclude.has(t.id))) return;
    seenIds.add(t.id);
    const artistIds = t.artists.map((a) => a?.id);
    if (!artistIds.some((id) => ids.has(id))) return;
    const key = songKey(t.name);
    if (usedKeys.has(key) || blockedKeys.has(key)) return;
    const entry = { id: t.id, name: t.name, listed: ids.has(artistIds[0]), plain: !isVersionTitle(t.name), pos };
    const g = groups.get(key);
    if (!g) { groups.set(key, { best: entry, listed: entry.listed, pos }); return; }
    g.listed = g.listed || entry.listed;
    g.pos = Math.min(g.pos, pos);
    const b = g.best;
    if (entry.listed !== b.listed ? entry.listed : entry.plain !== b.plain ? entry.plain : entry.pos < b.pos) g.best = entry;
  });
  const ordered = [...groups.values()].sort((a, b) => (a.listed === b.listed ? a.pos - b.pos : a.listed ? -1 : 1));
  const out = [...have];
  for (const g of ordered) {
    if (out.length >= limit) break;
    out.push({ id: g.best.id, name: g.best.name });
  }
  return out;
}

/**
 * Shares tracks out between lineup artists, in the order given (page order), so that the result does not depend on
 * which lookup answered first. Two passes: first every artist takes up to `limit` of its own tracks from its search
 * results, each track going to the first artist that wants it; then, still in order, an artist still short takes
 * tracks from its newest-releases items that no one has taken. Finally `shared` lists own tracks the artist has but
 * an EARLIER artist (in page order) holds (a duet): they are not in `tracks`, so the artist is topped up from elsewhere first, but
 * they show that the artist does have tracks on the playlist.
 * @param {{ spotifyIds: string[], searchItems?: unknown, releaseItems?: unknown }[]} entries Spotify track objects
 * @param {{ limit?: number }} [options]
 * @returns {{ tracks: { id: string, name: string }[], fromSearch: number, shared: { id: string, name: string }[] }[]}
 *   one per entry; `tracks[fromSearch..]` came from the releases items
 */
export function allocateTracks(entries, { limit = TRACKS_PER_ARTIST } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const claimed = new Set();
  const asArray = (v) => (Array.isArray(v) ? v : []);
  const fromSearch = list.map((e) => {
    const picks = chooseOwnTracks(e?.searchItems, e?.spotifyIds, { limit, exclude: claimed });
    for (const t of picks) claimed.add(t.id);
    return picks;
  });
  const tracksOf = list.map((e, i) => {
    const tracks = chooseOwnTracks(e?.releaseItems, e?.spotifyIds, { limit, already: fromSearch[i], exclude: claimed });
    for (const t of tracks.slice(fromSearch[i].length)) claimed.add(t.id);
    return tracks;
  });
  // Who claimed what is now final. `shared` may only list a track claimed by an EARLIER entry: a track a later entry
  // holds would be placed under the earlier artist by buildTrackList and could split the later artist's block.
  const claimedBy = new Map();
  tracksOf.forEach((tracks, i) => { for (const t of tracks) if (!claimedBy.has(t.id)) claimedBy.set(t.id, i); });
  return list.map((e, i) => {
    const tracks = tracksOf[i];
    const pool = [...asArray(e?.searchItems), ...asArray(e?.releaseItems)].filter((t) => claimedBy.get(t?.id) < i);
    const padded = chooseOwnTracks(pool, e?.spotifyIds, { limit, already: tracks });
    return { tracks, fromSearch: fromSearch[i].length, shared: padded.slice(tracks.length) };
  });
}

function dateKey(value) {
  const m = typeof value === 'string' ? /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value) : null;
  return m ? `${m[1]}-${m[2] ?? '00'}-${m[3] ?? '00'}` : null;
}

/**
 * Newest releases first (Spotify groups albums by type, not by date).
 * @param {unknown} albums
 * @param {number} [max]
 * @returns {{ id: string, name: string, releaseDate: string }[]}
 */
export function newestReleases(albums, max = MAX_RELEASES) {
  const seen = new Set();
  const rows = [];
  for (const a of Array.isArray(albums) ? albums : []) {
    if (!a || typeof a !== 'object' || !isSpotifyId(a.id) || seen.has(a.id)) continue;
    seen.add(a.id);
    rows.push({ id: a.id, name: typeof a.name === 'string' ? a.name : '', releaseDate: typeof a.release_date === 'string' ? a.release_date : '', key: dateKey(a.release_date), i: rows.length });
  }
  rows.sort((a, b) => (a.key === b.key ? a.i - b.i : a.key === null ? 1 : b.key === null ? -1 : a.key < b.key ? 1 : -1));
  return rows.slice(0, max).map(({ id, name, releaseDate }) => ({ id, name, releaseDate }));
}

/**
 * @param {number|string} year festival year
 * @param {Date} date when not a valid Date, the name has no date
 * @returns {string} e.g. "Spotifort: Treefort 2027 · Nov 23, 2026"
 */
export function playlistName(year, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return `Spotifort: Treefort ${year}`;
  return `Spotifort: Treefort ${year} \u00b7 ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * @param {unknown} id
 * @returns {string|null}
 */
export function trackUri(id) {
  return isSpotifyId(id) ? `spotify:track:${id}` : null;
}

/**
 * Flattens per-artist tracks into playlist order, never repeating a track.
 * @param {{ n: number, tracks: { id: string }[] }[]} perArtist
 * @returns {{ n: number, uri: string }[]}
 */
export function buildTrackList(perArtist) {
  const out = [];
  const used = new Set();
  for (const entry of Array.isArray(perArtist) ? perArtist : []) {
    for (const t of Array.isArray(entry?.tracks) ? entry.tracks : []) {
      const uri = trackUri(t?.id);
      if (!uri || used.has(uri)) continue;
      used.add(uri);
      out.push({ n: entry.n, uri });
    }
  }
  return out;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function batches(items, size = ADD_BATCH_SIZE) {
  const out = [];
  const list = Array.isArray(items) ? items : [];
  const step = Math.max(1, Math.floor(size) || ADD_BATCH_SIZE);
  for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
  return out;
}
