// Links: the one source of truth for which hosts we accept for artist links (used by the pipeline for what
// it stores, by check-dist for what ships, and by the app before rendering any data-derived URL), plus the
// listen links the app shows for a lineup artist. Pure, no DOM, no Node APIs.

export const PLATFORMS = ['spotify', 'appleMusic', 'tidal', 'deezer', 'bandcamp', 'youtube', 'soundcloud', 'lastfm'];

const EXACT_HOSTS = {
  spotify: ['open.spotify.com'],
  appleMusic: ['music.apple.com'],
  tidal: ['tidal.com', 'listen.tidal.com'],
  deezer: ['www.deezer.com', 'deezer.com'],
  youtube: ['www.youtube.com', 'youtube.com'],
  soundcloud: ['soundcloud.com', 'www.soundcloud.com'],
  lastfm: ['www.last.fm', 'last.fm'],
};

// Bandcamp pages live on one subdomain per artist.
const BANDCAMP_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.bandcamp\.com$/;

// bandcamp.com itself is accepted only for its search page (generated search links).
const BANDCAMP_SEARCH_HOST = 'bandcamp.com';

// Pages that are a site root say nothing about the artist (Bandcamp subdomains are the exception).
const NEEDS_PATH = new Set(['spotify', 'appleMusic', 'tidal', 'deezer', 'youtube', 'soundcloud', 'lastfm']);

/**
 * @param {string} platform
 * @param {string} host lowercase hostname
 * @returns {boolean}
 */
export function isAllowedHost(platform, host) {
  if (platform === 'bandcamp') return BANDCAMP_HOST.test(host) || host === BANDCAMP_SEARCH_HOST;
  return (EXACT_HOSTS[platform] ?? []).includes(host);
}

/**
 * Validate a URL for a platform and return it in canonical form (no fragment).
 * @param {string} platform one of PLATFORMS
 * @param {unknown} url
 * @returns {string|null} the cleaned https URL, or null if it must not be stored or rendered
 */
export function cleanPlatformUrl(platform, url) {
  if (typeof url !== 'string' || !PLATFORMS.includes(platform)) return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port) return null;
  if (!isAllowedHost(platform, u.hostname)) return null;
  if (platform === 'bandcamp' && u.hostname === BANDCAMP_SEARCH_HOST && u.pathname !== '/search') return null;
  if (NEEDS_PATH.has(platform) && (u.pathname === '/' || u.pathname === '')) return null;
  u.hash = '';
  return u.href;
}

/**
 * True when the URL is https on any allow-listed host for any platform.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isAllowedUrlForAnyPlatform(url) {
  return PLATFORMS.some((p) => cleanPlatformUrl(p, url) !== null);
}

// ---------------------------------------------------------------------------------------------
// Listen links

/** Fixed display order of listen platforms. */
export const LISTEN_PLATFORMS = ['spotify', 'appleMusic', 'tidal', 'bandcamp'];

export const PLATFORM_LABELS = { spotify: 'Spotify', appleMusic: 'Apple Music', tidal: 'Tidal', bandcamp: 'Bandcamp' };

const SEARCH_URLS = {
  spotify: (q) => `https://open.spotify.com/search/${q}`,
  appleMusic: (q) => `https://music.apple.com/us/search?term=${q}`,
  tidal: (q) => `https://tidal.com/search?q=${q}`,
  bandcamp: (q) => `https://bandcamp.com/search?q=${q}&item_type=b`,
};

/**
 * Generated search URL on a platform for an artist name; null if the name is empty or (impossibly) fails the allow-list.
 * @param {string} platform one of LISTEN_PLATFORMS
 * @param {unknown} name
 * @returns {string|null}
 */
export function searchUrl(platform, name) {
  const build = SEARCH_URLS[platform];
  const text = String(name ?? '').trim();
  if (!build || !text) return null;
  return cleanPlatformUrl(platform, build(encodeURIComponent(text)));
}

/**
 * Listen links for a lineup artist, in the fixed order Spotify, Apple Music, Tidal, Bandcamp.
 * A verified link from `artist.links` is used when it passes the allow-list (`kind: 'verified'`); otherwise a
 * generated search URL (`kind: 'search'`). Every returned URL is https and on the allow-list.
 * @param {{ name?: string, links?: Record<string, unknown> }} artist
 * @returns {{ platform: string, label: string, url: string, kind: 'verified'|'search' }[]}
 */
export function listenLinks(artist) {
  const out = [];
  const links = artist && typeof artist.links === 'object' && artist.links ? artist.links : {};
  for (const platform of LISTEN_PLATFORMS) {
    const verified = cleanPlatformUrl(platform, links[platform]);
    if (verified) {
      out.push({ platform, label: PLATFORM_LABELS[platform], url: verified, kind: 'verified' });
      continue;
    }
    const url = searchUrl(platform, artist?.name);
    if (url) out.push({ platform, label: PLATFORM_LABELS[platform], url, kind: 'search' });
  }
  return out;
}

/**
 * The artist's Last.fm page (needed for attribution), or null.
 * @param {{ links?: Record<string, unknown> }} artist
 * @returns {string|null}
 */
export function lastfmUrl(artist) {
  return cleanPlatformUrl('lastfm', artist?.links?.lastfm);
}
