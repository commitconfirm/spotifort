// Named tuning constants for the lineup pipeline. Keep in step with docs/ARCHITECTURE.md.

export const MIN_SCRAPED_NAMES = 50;        // fewer names than this and the source (API or page scrape) is assumed broken
export const MAX_REMOVED_FRACTION = 0.5;    // refuse a lineup update that would drop more than this share of the lineup

export const LASTFM_SIMILAR_LIMIT = 250;    // getSimilar limit; the reverse index is built from these lists
export const LASTFM_MIN_TAG_COUNT = 10;     // tags below this count are noise
export const LASTFM_MIN_INTERVAL_MS = 260;  // <= 4 requests per second
export const MUSICBRAINZ_MIN_INTERVAL_MS = 1100; // strictly one request per second, with margin
export const MUSICBRAINZ_USER_AGENT = 'Spotifort/2.0 (https://spotifort.com)';
export const FESTIVAL_CLIENT_NAME = 'Spotifort lineup script (https://spotifort.com)'; // generic client name for the vendor API, the lineup page and the performer feed
export const FESTIVAL_REST_BASE = 'https://treefortmusicfest.com/wp-json/tmf/v1/performer/'; // fallback; the lineup page's tmfLineup config wins
export const FESTIVAL_HOST = 'treefortmusicfest.com';
export const FESTIVAL_MIN_INTERVAL_MS = 400; // one performer request at most every 400 ms
export const FESTIVAL_MAX_ATTEMPTS = 3;     // one try plus two retries with backoff
export const FESTIVAL_STOP_MIN_REQUESTS = 10; // judge the failure rate only after this many performers
export const FESTIVAL_MAX_SHOWTIMES = 40;   // keep showtimes only when the list is this small
export const API_MIN_INTERVAL_MS = 1000;    // the vendor API: one request per endpoint per run, at least a second apart
export const API_MAX_ATTEMPTS = 3;          // one try plus two retries with backoff
export const API_TIMEOUT_MS = 30000;        // per request, body included
export const MAX_SCHEDULE_EVENTS = 5000;    // a schedule larger than this is not stored (something is wrong)
export const MAX_CONSECUTIVE_ERRORS = 3;    // abort a stage after this many failed records in a row

// The public reverse index keeps only matches at or above a cutoff. The build starts at the first rung and
// steps up this ladder until similarity.json fits its RAW byte budget (BUDGET_SIMILARITY_RAW); no rung fits =
// the build fails. The decision uses raw bytes on purpose: gzip output differs between zlib versions, and
// everything the build commits must come out the same on every machine.
export const REVERSE_MIN_MATCH_LADDER = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3];
export const REVERSE_MIN_MATCH = REVERSE_MIN_MATCH_LADDER[0];

export const NEIGHBOURS_PER_ARTIST = 12;    // lineup-to-lineup neighbours kept per artist
export const MIN_SIMILARITY = 0.08;         // combined score below this is dropped
export const WEIGHT_NEIGHBOURS = 0.7;       // weight of the shared-similar-artists cosine
export const WEIGHT_TAGS = 0.3;             // weight of the IDF-weighted tag cosine
export const TAGS_IN_OUTPUT = 5;            // tags shipped per artist in lineup.json

// Size budgets. The build enforces the RAW budgets (deterministic, so safe to commit decisions made from them).
// The gzip budgets are what visitors download; scripts/check-dist.js guards the built site against them with
// GZIP_GUARD_HEADROOM on top, so a zlib difference of a percent or two cannot flip the check.
//
// BUDGET_SIMILARITY_RAW = 1000 KB: 2027 is 340 KB raw (122 KB gzip) at cutoff 0.1, about 3x headroom; the
// pessimistic tripled lineup (docs/ARCHITECTURE.md) was 913 KB raw (211 KB gzip) at cutoff 0.15 and still fits.
// The raw-to-gzip ratio of this file is 2.8 to 4.3, so 1000 KB raw is roughly 230 to 350 KB gzip: about the
// 250 KB gzip target, with the ladder stepping up before a visitor-facing download gets bigger than that.
// BUDGET_LINEUP_RAW = 256 KB: lineup.json is 129 KB raw (28 KB gzip, ratio about 4.7), 256 KB is about 55 KB gzip.
export const BUDGET_LINEUP_RAW = 256 * 1024;
export const BUDGET_SIMILARITY_RAW = 1000 * 1024;
export const BUDGET_LINEUP_GZIP = 60 * 1024;
export const BUDGET_SIMILARITY_GZIP = 250 * 1024;
export const GZIP_GUARD_HEADROOM = 1.1;     // check-dist fails a gzip size only above budget x this
