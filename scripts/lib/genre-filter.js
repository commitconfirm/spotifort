/**
 * Pure genre-tag filtering (no network, no file I/O).
 * Last.fm / MusicBrainz tags include places, nationalities and meta tags that are not genres.
 * Whole-tag, case-insensitive matching only; when unsure a tag is kept
 * (so "britpop", "k-pop", "euskal rock", "americana", "latin", "afrobeat" survive).
 */

export const NON_GENRE_TAGS = new Set([
  // countries / nationalities / demonyms
  'usa', 'us', 'u.s.', 'u.s.a.', 'american', 'united states', 'united states of america',
  'uk', 'united kingdom', 'british', 'england', 'english', 'scotland', 'scottish', 'wales', 'welsh', 'irish', 'ireland',
  'canada', 'canadian', 'australia', 'australian', 'new zealand',
  'french', 'france', 'german', 'germany', 'italian', 'italy', 'japanese', 'japan',
  'mexican', 'mexico', 'peru', 'peruvian', 'portugal', 'portuguese', 'cape verde',
  'spanish', 'spain', 'swedish', 'sweden', 'brazilian', 'brazil',
  // regions / cities / places seen or likely
  'idaho', 'boise', 'pdx', 'portland', 'seattle', 'philadelphia', 'los angeles', 'new york', 'nyc',
  'melbourne', 'brisbane', 'sydney', 'lima', 'stuttgart', 'goa', 'basque', 'mediterranean',
  // meta tags
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'under 2000 listeners',
  'all', 'spotify', 'bandcamp', 'music', 'my top songs',
]);

/**
 * @param {string} tag
 * @param {string} [artistName]
 * @returns {boolean} true if the tag should be dropped
 */
export function isNonGenreTag(tag, artistName = '') {
  const t = String(tag).trim().toLowerCase();
  if (!t) return true;
  if (NON_GENRE_TAGS.has(t)) return true;
  return t === String(artistName).trim().toLowerCase();
}

/**
 * @param {string[]} genres
 * @param {string} [artistName]
 * @returns {string[]} new array with non-genre tags removed (order preserved)
 */
export function filterGenres(genres, artistName = '') {
  if (!Array.isArray(genres)) return genres;
  return genres.filter(g => !isNonGenreTag(g, artistName));
}

/**
 * Apply filterGenres to every artist; only `genres` arrays change.
 * @param {object} lineup
 * @returns {{lineup: object, removed: Record<string, number>, emptied: string[]}}
 */
export function cleanLineupGenres(lineup) {
  const removed = {};
  const emptied = [];
  const artists = lineup.artists.map(a => {
    if (!Array.isArray(a.genres)) return a;
    const kept = filterGenres(a.genres, a.name);
    for (const g of a.genres) if (!kept.includes(g)) removed[g] = (removed[g] || 0) + 1;
    if (a.genres.length > 0 && kept.length === 0) emptied.push(a.name);
    return { ...a, genres: kept };
  });
  return { lineup: { ...lineup, artists }, removed, emptied };
}
