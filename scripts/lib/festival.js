/**
 * Pure logic for the festival performer feed (stage `festival`). No network, no file I/O.
 *
 * The festival's lineup page renders each artist as a card with `data-slug`, and its own script reads
 * GET <restBase><slug> (undocumented, no authentication). The answer holds the performer's social links,
 * which for most artists include the Spotify artist page the festival itself chose. Everything is parsed
 * defensively: any field may be missing or the wrong type, and a bad answer is a failure for that performer
 * (retried next run), never a fact about the artist.
 */
import { normalizeName } from '../../src/core/normalize.js';
import { platformLink } from './musicbrainz.js';
import { FESTIVAL_HOST, FESTIVAL_MAX_SHOWTIMES, FESTIVAL_REST_BASE, FESTIVAL_STOP_MIN_REQUESTS } from './constants.js';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u;
const INTL_PREFIX = /^intl-[a-z]{2}(?:-[a-z]+)?$/i;
// Festival social type -> our platform key. Spotify is handled by parseSpotifyLink; other types are kept as given.
const PLATFORM_OF_TYPE = { applemusic: 'appleMusic', bandcamp: 'bandcamp', youtube: 'youtube', soundcloud: 'soundcloud', tidal: 'tidal', deezer: 'deezer' };

// Some sources spell a type differently; the state keeps one key per type.
const TYPE_ALIAS = { twitter: 'x' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} slug @returns {string|null} the slug when it is safe to put in a URL path */
export function cleanSlug(slug) {
  return typeof slug === 'string' && SLUG.test(slug) ? slug : null;
}

/**
 * The REST base from the lineup page's `tmfLineup = {"restBase": "..."}` config, when it is https on the
 * festival's own host; otherwise the built-in constant (page content is data, not a place to send requests).
 * @param {string} html lineup page
 * @returns {string} always ends with "/"
 */
export function discoverRestBase(html) {
  const m = /\btmfLineup\s*=\s*(\{[^;]*?\})\s*;/.exec(String(html ?? ''));
  if (m) {
    try {
      const base = JSON.parse(m[1])?.restBase;
      if (typeof base === 'string') {
        const u = new URL(base);
        if (u.protocol === 'https:' && u.hostname === FESTIVAL_HOST && !u.username && !u.password && !u.port && !u.search && !u.hash) {
          return u.href.endsWith('/') ? u.href : u.href + '/';
        }
      }
    } catch {
      // fall through to the constant
    }
  }
  return FESTIVAL_REST_BASE;
}

/** @param {string} restBase @param {string} slug */
export const performerUrl = (restBase, slug) => restBase + encodeURIComponent(slug);

/**
 * Classify a Spotify link from the feed.
 *  artist -> {kind:'artist', id}; album -> {kind:'album', id};
 *  anything else on open.spotify.com (user, playlist, track, ...) -> {kind, url} with the query removed;
 *  not an https open.spotify.com URL (or an artist/album link with a malformed id) -> null.
 * An `/intl-xx/` path prefix, query and fragment are ignored.
 * @param {unknown} url
 * @returns {{kind: 'artist'|'album', id: string}|{kind: string, url: string}|null}
 */
export function parseSpotifyLink(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com' || u.username || u.password || u.port) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length && INTL_PREFIX.test(parts[0])) parts.shift();
  if (parts.length < 2) return null;
  const kind = parts[0].toLowerCase();
  const id = parts[1];
  if (kind === 'artist' || kind === 'album') return SPOTIFY_ID.test(id) ? { kind, id } : null;
  if (!/^[a-z-]{1,20}$/.test(kind)) return null;
  return { kind, url: `https://open.spotify.com/${kind}/${id}` };
}

/**
 * Parse a list of `{<typeKey>: 'Apple Music', url}` social links, the shape shared by the performer feed
 * (`social`, key `type`) and the vendor API (`socialLinks`, key `name`).
 * Types are lowercased with everything but letters and digits removed ("Apple Music" -> "applemusic"); X is
 * kept under "x" whichever way it is spelled. Spotify links are classified (see parseSpotifyLink); supported
 * platforms must pass the shared `platformLink` checks; any other type keeps one https URL as given.
 * @param {unknown} items
 * @param {'type'|'name'} typeKey
 * @returns {{spotify: object|undefined, links: Record<string, string>}} links sorted by key, one URL per type
 */
export function parseSocialLinks(items, typeKey) {
  const spotifyLinks = [];
  const links = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!isObject(item) || typeof item[typeKey] !== 'string' || typeof item.url !== 'string') continue;
    let type = item[typeKey].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!/^[a-z0-9]{1,20}$/.test(type)) continue;
    type = TYPE_ALIAS[type] ?? type;
    if (type === 'spotify') {
      const parsed = parseSpotifyLink(item.url);
      if (parsed) spotifyLinks.push(parsed);
      continue;
    }
    const platform = PLATFORM_OF_TYPE[type];
    let kept = null;
    if (platform) kept = platformLink(platform, item.url)?.url ?? null;
    else {
      try {
        const u = new URL(item.url.trim());
        if (u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.includes('.')) {
          u.hash = '';
          kept = u.href;
        }
      } catch {
        // not a URL
      }
    }
    const key = platform ?? type;
    if (kept && !links[key]) links[key] = kept;
  }
  // A performer may list several; the artist page is the one we want, then an album, then whatever else.
  const spotify = spotifyLinks.find((l) => l.kind === 'artist') ?? spotifyLinks.find((l) => l.kind === 'album') ?? spotifyLinks[0];
  return { spotify, links: Object.fromEntries(Object.entries(links).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

/**
 * Parse one performer answer.
 * @param {unknown} body parsed JSON
 * @param {string} slug the slug that was requested
 * @param {string} date YYYY-MM-DD fetch date
 * @returns {{ok: true, festival: object}|{ok: false, reason: string}}
 *   festival: {slug, fetched, hometown?, spotify?, links, showtimes?}
 *   spotify is {kind:'artist'|'album', id} or {kind, url} (a non-artist link); links holds one https URL per
 *   social type (platform keys for the ones we support, validated like MusicBrainz links; others as given).
 *   `bio`, image URLs and `music` are not kept: the text is the festival's, and `music` is one Apple Music album link.
 */
export function parsePerformer(body, slug, date) {
  if (!isObject(body)) return { ok: false, reason: 'answer is not a JSON object' };
  if (body.found !== true) return { ok: false, reason: body.found === false ? 'feed says the performer was not found' : 'answer has no found:true' };
  const festival = { slug, fetched: date };
  if (typeof body.hometown === 'string' && body.hometown.trim()) festival.hometown = body.hometown.replace(/\s+/g, ' ').trim().slice(0, 120);

  const { spotify, links } = parseSocialLinks(body.social, 'type');
  if (spotify) festival.spotify = spotify;
  festival.links = links;

  // Showtimes: kept only when it is a short list of flat objects (shape unknown until the schedule is published).
  const st = body.showtimes;
  if (Array.isArray(st) && st.length > 0 && st.length <= FESTIVAL_MAX_SHOWTIMES) {
    const flat = st.filter((s) => isObject(s) && Object.values(s).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)));
    if (flat.length === st.length) festival.showtimes = st.map((s) => ({ ...s }));
  }
  return { ok: true, festival };
}

/** The Spotify target the feed gave for a record: an artist or album id, else null. */
export function festivalSpotifyTarget(record) {
  const s = record?.festival?.spotify;
  return s && (s.kind === 'artist' || s.kind === 'album') && SPOTIFY_ID.test(s.id ?? '') ? s : null;
}

/** True when the festival stage has something to fetch for this record. */
export function needsFestival(record, refresh = false) {
  if (record.removed) return false;
  const slug = cleanSlug(record.slug);
  if (!slug) return false;
  return refresh || record.festival?.slug !== slug;
}

/**
 * Stop the stage early when the feed looks broken: after at least FESTIVAL_STOP_MIN_REQUESTS performers,
 * more than half of the answers failed.
 */
export function feedLooksBroken({ attempted, failed }, minRequests = FESTIVAL_STOP_MIN_REQUESTS) {
  return attempted >= minRequests && failed * 2 > attempted;
}

/**
 * Festival links as the build uses them: only the platforms we support, re-validated, plus platform ids
 * (Apple Music, Tidal, Deezer) read from the URL.
 * @param {object} record
 * @returns {{links: Record<string, string>, ids: Record<string, string>}}
 */
export function festivalLinksFor(record) {
  const links = {};
  const ids = {};
  const src = isObject(record?.festival?.links) ? record.festival.links : {};
  for (const platform of Object.values(PLATFORM_OF_TYPE)) {
    const found = platformLink(platform, src[platform]);
    if (!found) continue;
    links[platform] = found.url;
    if (found.id) ids[platform] = found.id;
  }
  return { links, ids };
}

/** Same name test the rest of the pipeline uses; for log warnings about a slug that points at another act. */
export const sameName = (a, b) => normalizeName(a) === normalizeName(b);

/**
 * The artists of a Spotify album answer (GET /albums/{id}), in the album's order, valid ids only, no repeats.
 * @param {unknown} body
 * @returns {{id: string, name: string}[]}
 */
export function parseAlbumArtists(body) {
  const out = [];
  for (const a of Array.isArray(body?.artists) ? body.artists : []) {
    if (isObject(a) && typeof a.id === 'string' && SPOTIFY_ID.test(a.id) && !out.some((x) => x.id === a.id)) {
      out.push({ id: a.id, name: typeof a.name === 'string' ? a.name : '' });
    }
  }
  return out;
}
