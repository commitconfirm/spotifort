// Named tuning constants for the lineup pipeline. Keep in step with docs/ARCHITECTURE.md.

export const MIN_SCRAPED_NAMES = 50;        // fewer names than this and the scrape is assumed broken
export const MAX_REMOVED_FRACTION = 0.5;    // refuse a scrape that would drop more than this share of the lineup

export const LASTFM_SIMILAR_LIMIT = 250;    // getSimilar limit; the reverse index is built from these lists
export const LASTFM_MIN_TAG_COUNT = 10;     // tags below this count are noise
export const LASTFM_MIN_INTERVAL_MS = 260;  // <= 4 requests per second
export const MUSICBRAINZ_MIN_INTERVAL_MS = 1100; // strictly one request per second, with margin
export const MUSICBRAINZ_USER_AGENT = 'Spotifort/2.0 (https://spotifort.com)';
export const MAX_CONSECUTIVE_ERRORS = 3;    // abort a stage after this many failed records in a row

// The public reverse index keeps only matches at or above a cutoff. The build starts at the first rung and
// steps up this ladder until similarity.json fits its gzip budget; no rung fits = the build fails.
export const REVERSE_MIN_MATCH_LADDER = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3];
export const REVERSE_MIN_MATCH = REVERSE_MIN_MATCH_LADDER[0];

export const NEIGHBOURS_PER_ARTIST = 12;    // lineup-to-lineup neighbours kept per artist
export const MIN_SIMILARITY = 0.08;         // combined score below this is dropped
export const WEIGHT_NEIGHBOURS = 0.7;       // weight of the shared-similar-artists cosine
export const WEIGHT_TAGS = 0.3;             // weight of the IDF-weighted tag cosine
export const TAGS_IN_OUTPUT = 5;            // tags shipped per artist in lineup.json

export const BUDGET_LINEUP_GZIP = 60 * 1024;
export const BUDGET_SIMILARITY_GZIP = 250 * 1024;
