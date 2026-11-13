/**
 * Pure parsing of MusicBrainz responses. No network, no file I/O.
 * Only https URLs on the per-platform host allow-list (src/core/link-hosts.js) are ever kept.
 */
import { cleanPlatformUrl } from '../../src/core/link-hosts.js';

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
    for (const platform of ['appleMusic', 'tidal', 'deezer', 'bandcamp', 'youtube', 'soundcloud', 'lastfm']) {
      if (links[platform]) continue;
      const url = cleanPlatformUrl(platform, resource);
      if (!url) continue;
      const u = new URL(url);
      if (ID_PATHS[platform]) {
        const m = u.pathname.match(ID_PATHS[platform]);
        if (!m) continue;
        ids[platform] = m[1];
      } else if (platform === 'youtube' && !YOUTUBE_PATH.test(u.pathname)) {
        continue;
      }
      links[platform] = url;
    }
  }
  return { links, ids };
}
