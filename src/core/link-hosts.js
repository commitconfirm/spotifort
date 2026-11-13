// Hosts we accept for artist links, per platform. Used by the pipeline (what it stores) and
// check-dist (what ships); the app will use it before rendering any data-derived URL.
// Pure, no DOM, no Node APIs.

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

// Pages that are a site root say nothing about the artist (Bandcamp subdomains are the exception).
const NEEDS_PATH = new Set(['spotify', 'appleMusic', 'tidal', 'deezer', 'youtube', 'soundcloud', 'lastfm']);

/**
 * @param {string} platform
 * @param {string} host lowercase hostname
 * @returns {boolean}
 */
export function isAllowedHost(platform, host) {
  if (platform === 'bandcamp') return BANDCAMP_HOST.test(host);
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
