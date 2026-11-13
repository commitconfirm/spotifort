// Pool x lineup -> matches. docs/ARCHITECTURE.md, "Matching the pool against the lineup".
// By lineup number for artists the visitor picked from autocomplete; by platform ID where a library source
// provided one (a pool entry matches on any Spotify ID the lineup artist has); otherwise by normalised name,
// marked unconfirmed. Pure, no DOM.

/**
 * @typedef {'pick'|'id'|'name'} MatchVia
 * @typedef {{ n: number, name: string, confirmed: boolean, unverified: boolean, entries: { key: string, name: string, via: MatchVia }[] }} Match
 */

// Platforms that are looked up by id in the lineup's `ids` (Spotify has its own list).
const OTHER_ID_PLATFORMS = ['tidal', 'appleMusic', 'deezer'];

/**
 * Which lineup artist (if any) one pool entry matches, and how.
 * @param {{ key: string, n?: number, ids?: Record<string, string> }} entry
 * @param {ReturnType<import('./lineup-index.js').prepareLineup>} lineup
 * @returns {{ artist: object, via: MatchVia }|null}
 */
export function matchEntry(entry, lineup) {
  if (entry.n !== undefined) {
    const picked = lineup.byN(entry.n);
    if (picked) return { artist: picked, via: 'pick' };
  }
  const ids = entry.ids ?? {};
  if (ids.spotify) {
    const a = lineup.bySpotifyId(ids.spotify);
    if (a) return { artist: a, via: 'id' };
  }
  for (const platform of OTHER_ID_PLATFORMS) {
    if (ids[platform]) {
      const a = lineup.byPlatformId(platform, ids[platform]);
      if (a) return { artist: a, via: 'id' };
    }
  }
  const byName = lineup.byKey(entry.key);
  return byName ? { artist: byName, via: 'name' } : null;
}

/**
 * Match every pool entry; one result per lineup artist, sorted by name.
 * `confirmed` is true when some entry matched by pick, or by id on a record that is not `unverified`; false for
 * name-only matches and for unverified lineup records matched by id. (A pick is the visitor's own choice of that
 * lineup artist, so it counts as confirmed.)
 * @param {{ entries: object[] }} pool
 * @param {ReturnType<import('./lineup-index.js').prepareLineup>} lineup
 * @returns {Match[]}
 */
export function matchPool(pool, lineup) {
  /** @type {Map<number, Match>} */
  const byN = new Map();
  for (const entry of pool.entries) {
    const m = matchEntry(entry, lineup);
    if (!m) continue;
    const unverified = m.artist.unverified === true;
    const sure = m.via === 'pick' || (m.via === 'id' && !unverified);
    let result = byN.get(m.artist.n);
    if (!result) {
      result = { n: m.artist.n, name: m.artist.name, confirmed: false, unverified, entries: [] };
      byN.set(m.artist.n, result);
    }
    result.entries.push({ key: entry.key, name: entry.name, via: m.via });
    if (sure) result.confirmed = true;
  }
  return [...byN.values()].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.n - b.n));
}
