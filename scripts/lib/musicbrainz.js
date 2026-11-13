/**
 * Pure parsing of MusicBrainz responses. No network, no file I/O.
 * Only https URLs on the per-platform host allow-list (src/core/links.js) are ever kept.
 */
import { cleanPlatformUrl } from '../../src/core/links.js';

// Artist-page paths that carry a platform id, optionally behind a locale or "browse" segment.
const ID_PATHS = {
  appleMusic: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artist\/(?:[^/]+\/)?(\d+)\/?$/i,
  tidal: /^\/(?:browse\/)?artist\/(\d+)\/?$/i,
  deezer: /^\/(?:[a-z]{2}\/)?artist\/(\d+)\/?$/i,
};
const YOUTUBE_PATH = /^\/(?:channel\/|c\/|user\/|@)/i;

/**
 * @param {number} status
 * @param {object|null} body response of url?resource=<spotify url>&inc=artist-rels
 * @returns {{kind: 'found', mbid: string}|{kind: 'none'}}
 *   'none' is a real answer: MusicBrainz does not know that Spotify URL (404, or no artist relation)
 */
export function parseUrlLookup(status, body) {
  if (status === 404) return { kind: 'none' };
  const rel = (body?.relations ?? []).find((r) => typeof r?.artist?.id === 'string');
  return rel ? { kind: 'found', mbid: rel.artist.id } : { kind: 'none' };
}

/** Platforms whose links we keep, beyond Spotify (which has its own id handling). */
export const LINK_PLATFORMS = ['appleMusic', 'tidal', 'deezer', 'bandcamp', 'youtube', 'soundcloud', 'lastfm'];

/**
 * Accept one URL as an artist link for a platform: https, on the platform's host allow-list, and shaped like an
 * artist page (Apple Music, Tidal and Deezer need a numeric artist id; YouTube needs a channel/user/handle path;
 * SoundCloud search pages are not artist pages). Used for MusicBrainz relations and for festival feed links.
 * @param {string} platform
 * @param {unknown} resource
 * @returns {{url: string, id?: string}|null}
 */
export function platformLink(platform, resource) {
  const url = cleanPlatformUrl(platform, resource);
  if (!url) return null;
  const u = new URL(url);
  if (ID_PATHS[platform]) {
    const m = u.pathname.match(ID_PATHS[platform]);
    return m ? { url, id: m[1] } : null;
  }
  if (platform === 'youtube' && !YOUTUBE_PATH.test(u.pathname)) return null;
  if (platform === 'soundcloud' && /^\/search(?:\/|$)/i.test(u.pathname)) return null;
  return { url };
}

/**
 * @param {Array} relations url-rels from an artist lookup
 * @returns {{links: Record<string, string>, ids: Record<string, string>}}
 *   links: appleMusic, tidal, deezer, bandcamp, youtube, soundcloud, lastfm (first valid per platform, response order)
 *   ids: tidal, appleMusic, deezer where the URL carries one. Platform pages without an id are not kept
 *   for those three (they are not artist pages).
 */
export function extractLinks(relations) {
  const links = {};
  const ids = {};
  for (const rel of relations ?? []) {
    const resource = rel?.url?.resource;
    if (typeof resource !== 'string') continue;
    for (const platform of LINK_PLATFORMS) {
      if (links[platform]) continue;
      const found = platformLink(platform, resource);
      if (!found) continue;
      if (found.id) ids[platform] = found.id;
      links[platform] = found.url;
    }
  }
  return { links, ids };
}
