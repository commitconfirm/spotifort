/**
 * Pure logic for the lineup pipeline (no network, no file I/O).
 * Imported by scripts/fetch-lineup.js and by the tests.
 *
 * Record states (per artist):
 *   resolved       spotifyId set                     -> kept as is
 *   not on Spotify spotifyId null, notOnSpotify true -> searched successfully, no result; kept
 *   unresolved     spotifyId null, notOnSpotify false -> not looked up yet or lookup failed; retried
 */

/**
 * Decode HTML entities (common named ones plus numeric) without a dependency
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1].toLowerCase() === 'x';
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      try {
        return String.fromCodePoint(num);
      } catch {
        return match;
      }
    }
    return named[code.toLowerCase()] ?? match;
  });
}

/**
 * Extract artist names from the lineup page HTML.
 * Each artist card contains <h3 class="lineup-artist-name">Name</h3>.
 * @param {string} html
 * @returns {string[]} Unique names (case-insensitive) in page order
 */
export function parseLineupHtml(html) {
  const re = /<h3\b[^>]*\bclass="[^"]*\blineup-artist-name\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
  const seen = new Set();
  const names = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const name = decodeEntities(match[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/**
 * True when a record has not been resolved and has not been searched successfully
 * @param {Object} record
 * @returns {boolean}
 */
export function isUnresolved(record) {
  return !record.spotifyId && !record.notOnSpotify;
}

/**
 * Pick the best artist from Spotify search results.
 * Prefers an exact (case-insensitive) name match, else the top hit (low confidence).
 * @param {string} lineupName - Name as listed on the festival site
 * @param {Array|undefined} results - data.artists.items from Spotify search
 * @returns {{spotifyId:string, spotifyUrl:string, genres:string[], exactCount:number, spotifyName?:string}|null}
 *   null when there are no results. `spotifyName` is set only when it differs from lineupName.
 *   `exactCount` is how many results match the name exactly (case-insensitive); more than 1 means
 *   the first was taken but is ambiguous. It is for reporting only and must not be stored.
 */
export function pickMatch(lineupName, results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const wanted = lineupName.toLowerCase();
  const exact = results.filter((a) => a.name?.toLowerCase() === wanted);
  const artist = exact[0] || results[0];

  const match = {
    spotifyId: artist.id,
    spotifyUrl: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    exactCount: exact.length,
  };
  // Only a real difference counts; a case-only difference is still an exact match.
  if (artist.name && artist.name.toLowerCase() !== wanted) {
    match.spotifyName = artist.name;
  }
  return match;
}

/**
 * Merge the website names with the existing file's records.
 * @param {Array|undefined} existingArtists - Records from the previous file
 * @param {string[]} websiteNames - Names from the website
 * @returns {{kept: Object[], toLookup: string[], removed: Object[]}}
 *   kept: resolved or not-on-Spotify records still on the website
 *   toLookup: names that are new or whose record is unresolved
 *   removed: existing records no longer on the website
 */
export function mergeLineup(existingArtists, websiteNames) {
  const existing = existingArtists ?? [];
  const byName = new Map();
  for (const a of existing) byName.set(a.name.toLowerCase(), a);

  const kept = [];
  const toLookup = [];
  for (const name of websiteNames) {
    const prev = byName.get(name.toLowerCase());
    // `manual` records were hand-corrected: always kept untouched, never looked up again.
    if (prev && (prev.manual === true || !isUnresolved(prev))) {
      kept.push(prev);
    } else {
      toLookup.push(name);
    }
  }

  const websiteKeys = new Set(websiteNames.map((n) => n.toLowerCase()));
  const removed = existing.filter((a) => !websiteKeys.has(a.name.toLowerCase()));

  return { kept, toLookup, removed };
}

/**
 * Whether every record in the list is resolved or definitively not on Spotify
 * @param {Object[]} artists
 * @returns {boolean}
 */
export function isEnriched(artists) {
  return artists.length > 0 && artists.every((a) => !isUnresolved(a));
}

/**
 * Parse a Retry-After header value (seconds or HTTP date) into seconds
 * @param {string|null|undefined} value
 * @param {number} [now] - epoch ms, for tests
 * @returns {number|null} Seconds to wait, or null if absent/invalid
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - now) / 1000);
  return null;
}
