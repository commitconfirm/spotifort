// Prepares public/data/<year>/lineup.json for lookups by n, Spotify ID, other platform ID and normalised
// name, plus autocomplete, neighbours and the tag counts. Pure, no DOM, no fetch.

import { normalizeName } from './normalize.js';
import { createSearcher } from './search.js';

/**
 * @typedef {{ n: number, id?: string, name: string, spotifyIds?: string[], ids?: Record<string, string>,
 *   links?: Record<string, string>, tags?: string[], similar?: [number, number, string][], unverified?: boolean }} LineupArtist
 * @typedef {{ n: number, score: number, signal: string }} Neighbour score is 0..1
 */

/**
 * @param {{ year?: number, lastUpdated?: string, artists: LineupArtist[] }} json
 * @returns {{
 *   year: number|undefined, lastUpdated: string|undefined, artists: LineupArtist[],
 *   byN: (n: number) => LineupArtist|undefined,
 *   bySpotifyId: (id: string) => LineupArtist|undefined,
 *   byPlatformId: (platform: string, id: string) => LineupArtist|undefined,
 *   byKey: (key: string) => LineupArtist|undefined,
 *   keyOf: (n: number) => string|undefined,
 *   neighbours: (n: number) => Neighbour[],
 *   search: (query: unknown, options?: { limit?: number }) => { n: number, name: string, artist: LineupArtist }[],
 *   tags: { tag: string, count: number }[],
 *   tagsOf: (n: number) => string[],
 * }}
 * @throws {TypeError} when `artists` is missing
 */
export function prepareLineup(json) {
  if (!json || !Array.isArray(json.artists)) throw new TypeError('lineup data: artists must be an array');
  const artists = json.artists.filter((a) => a && Number.isInteger(a.n) && typeof a.name === 'string');
  const byN = new Map();
  const bySpotify = new Map();
  const byKey = new Map();
  const keyByN = new Map();
  /** @type {Map<string, Map<string, LineupArtist>>} */
  const byPlatform = new Map();
  const tagCounts = new Map();

  for (const a of artists) {
    byN.set(a.n, a);
    const key = normalizeName(a.name);
    keyByN.set(a.n, key);
    if (!byKey.has(key)) byKey.set(key, a);
    for (const id of Array.isArray(a.spotifyIds) ? a.spotifyIds : []) {
      if (typeof id === 'string' && !bySpotify.has(id)) bySpotify.set(id, a);
    }
    for (const [platform, id] of Object.entries(a.ids && typeof a.ids === 'object' ? a.ids : {})) {
      if (typeof id !== 'string') continue;
      if (!byPlatform.has(platform)) byPlatform.set(platform, new Map());
      const m = byPlatform.get(platform);
      if (!m.has(id)) m.set(id, a);
    }
    for (const t of new Set(Array.isArray(a.tags) ? a.tags : [])) {
      if (typeof t === 'string' && t) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }

  const keys = artists.map((a) => keyByN.get(a.n));
  const searcher = createSearcher(keys, normalizeName);
  const tags = [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));

  return {
    year: json.year,
    lastUpdated: json.lastUpdated,
    artists,
    byN: (n) => byN.get(n),
    bySpotifyId: (id) => bySpotify.get(id),
    byPlatformId: (platform, id) => byPlatform.get(platform)?.get(id),
    byKey: (key) => byKey.get(key),
    keyOf: (n) => keyByN.get(n),
    neighbours(n) {
      const a = byN.get(n);
      const out = [];
      for (const row of Array.isArray(a?.similar) ? a.similar : []) {
        if (Array.isArray(row) && byN.has(row[0]) && typeof row[1] === 'number') out.push({ n: row[0], score: row[1], signal: String(row[2] ?? '') });
      }
      return out;
    },
    search(query, options) {
      return searcher(query, options).map((i) => ({ n: artists[i].n, name: artists[i].name, artist: artists[i] }));
    },
    tags,
    tagsOf: (n) => (Array.isArray(byN.get(n)?.tags) ? byN.get(n).tags : []),
  };
}
