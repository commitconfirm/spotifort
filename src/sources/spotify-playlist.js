// Playlist source: Spotify. Looks up a few tracks for each planned lineup artist and makes a playlist from them.
// The pure decisions (who gets tracks, which tracks count, how versions collapse, batching) live in
// src/core/playlist.js; this module is the I/O around them. docs/PLAN-2027.md, "Playlist creation", and
// docs/research/spotify-playlist-live-tests-2026-11.md.
//
// Two routes find an artist's tracks: Search (one request, but it has a small daily quota) and the artist's newest
// releases (albums, then the tracks of the newest few). When Search runs out of quota the remaining artists use the
// releases route and the result says so; when that route runs out too, the rest are left out with reason 'quota'.
// Auth, permission and network failures during lookup are fatal and nothing is created. Any other failure of one
// lookup request (a 5xx, a plain 429, a 200 whose body is not JSON) only costs that artist that route; the artist is
// then recorded as `failed` so the report can say so. Only a daily-quota answer switches a route off for everyone.
// A failure while adding tracks is not thrown: the playlist exists, so the result says how far it got.
//
// Known limit: the releases request (`include_groups=album,single&limit=10`) returns albums before singles, so for an
// artist with 10 or more albums a newer single is not seen.
//
// Takes an `api` from createApi in ./spotify.js (injected fetch and sleep, so it is tested without a network). It
// uses no storage, no DOM and no token of its own; the token is only ever sent to https://api.spotify.com/.

import { CONCURRENCY, SpotifyError, mapLimit } from './spotify.js';
import {
  LEFT_OUT, MAX_RELEASES, PLAYLIST_DESCRIPTION, TRACKS_PER_ARTIST,
  batches, buildTrackList, chooseOwnTracks, isSpotifyId, newestReleases, playlistName, trackUri,
} from '../core/playlist.js';
import { log } from '../log.js';

const PLAYLIST_URL = 'https://open.spotify.com/playlist/';

/**
 * One lookup request. Resolves { data } on success or { failed: kind } for a failure of this one request: 'quota'
 * (the caller switches that route off for everyone), 'rate' or 'http' (including a 200 whose body is not JSON; the
 * caller only gives up on this artist's use of the route). Anything else (auth, forbidden, network, not a
 * SpotifyError) is fatal: it is recorded in `shared.fatal` and rethrown.
 */
async function call(api, path, shared, stats) {
  try {
    const data = await api.get(path);
    stats.ok++;
    return { data };
  } catch (err) {
    if (err instanceof SyntaxError) { // a 200 whose body is not JSON
      stats.http++;
      return { failed: 'http' };
    }
    const kind = err instanceof SpotifyError ? err.kind : null;
    if (kind === 'quota' || kind === 'rate' || kind === 'http') {
      stats[kind]++;
      return { failed: kind };
    }
    shared.fatal = shared.fatal ?? err;
    throw err;
  }
}

/** The artist's newest-releases route. Mutates `state` ({ tracks, incomplete, failed }). */
async function releasesRoute(api, artist, shared, stats, state) {
  for (const id of artist.spotifyIds) {
    if (state.tracks.length >= TRACKS_PER_ARTIST) return;
    if (!isSpotifyId(id)) continue;
    if (shared.fatal) return;
    if (shared.releasesExhausted) { state.incomplete = true; return; }
    const albums = await call(api, `artists/${id}/albums?include_groups=album,single&limit=10`, shared, stats);
    if (albums.failed === 'quota') {
      shared.releasesExhausted = true;
      state.incomplete = true;
      return;
    }
    if (albums.failed) { // 'rate' or 'http': abandon this id, try the artist's next one
      state.failed = true;
      continue;
    }
    for (const release of newestReleases(albums.data?.items, MAX_RELEASES)) {
      if (state.tracks.length >= TRACKS_PER_ARTIST) return;
      if (shared.fatal) return;
      if (shared.releasesExhausted) { state.incomplete = true; return; }
      const res = await call(api, `albums/${release.id}/tracks?limit=50`, shared, stats);
      if (res.failed === 'quota') {
        shared.releasesExhausted = true;
        state.incomplete = true;
        return;
      }
      if (res.failed) { // 'rate' or 'http': abandon this id, keep what was found
        state.failed = true;
        break;
      }
      state.tracks = chooseOwnTracks(res.data?.items, artist.spotifyIds, { already: state.tracks });
    }
  }
}

/**
 * Looks up tracks for every planned artist, at most `concurrency` artists at a time.
 * @param {{ get: (path: string) => Promise<any> }} api from createApi
 * @param {{ artists: { n: number, name: string, spotifyIds: string[] }[] }} plan from playlistPlan
 * @param {{ onProgress?: (p: { phase: 'lookup', done: number, total: number }) => void, concurrency?: number }} [options]
 * @returns {Promise<{
 *   artists: { n: number, name: string, tracks: { id: string, name: string }[], searched: boolean, newestIds: string[], failed: boolean }[],
 *   searchExhausted: boolean, releasesExhausted: boolean, incomplete: number[],
 * }>} artists in plan order, one per planned artist. Rejects on an auth, permission or network failure.
 */
export async function lookupTracks(api, plan, { onProgress = () => {}, concurrency = CONCURRENCY } = {}) {
  const planned = Array.isArray(plan?.artists) ? plan.artists : [];
  const total = planned.length;
  const shared = { searchExhausted: false, releasesExhausted: false, fatal: null };
  const stats = { ok: 0, quota: 0, rate: 0, http: 0 };
  const results = planned.map((a) => ({ n: a.n, name: a.name, tracks: [], searched: false, newestIds: [], failed: false }));
  const incompleteSet = new Set();
  let done = 0;

  await mapLimit(planned, Math.max(1, concurrency), async (artist, i) => {
    if (shared.fatal) return;
    const out = results[i];
    const state = { tracks: [], incomplete: false, failed: false };
    if (!shared.searchExhausted) {
      const name = String(artist.name ?? '').replace(/"/g, '');
      const q = encodeURIComponent(`artist:"${name}"`);
      const res = await call(api, `search?type=track&limit=10&q=${q}`, shared, stats);
      if (res.failed === 'quota') shared.searchExhausted = true;
      else if (res.failed) state.failed = true;
      else {
        out.searched = true;
        state.tracks = chooseOwnTracks(res.data?.tracks?.items, artist.spotifyIds);
      }
    }
    const fromSearch = state.tracks.length;
    if (state.tracks.length < TRACKS_PER_ARTIST) {
      if (shared.releasesExhausted) state.incomplete = true;
      else await releasesRoute(api, artist, shared, stats, state);
    }
    // mapLimit does not cancel workers in flight: once another artist hit a fatal error, report nothing more.
    if (shared.fatal) return;
    out.tracks = state.tracks;
    out.newestIds = state.tracks.slice(fromSearch).map((t) => t.id); // the tracks the releases route found
    out.failed = state.failed;
    if (state.incomplete) incompleteSet.add(artist.n);
    done++;
    onProgress({ phase: 'lookup', done, total });
  });

  log.info('playlist lookup requests', stats);
  return {
    artists: results,
    searchExhausted: shared.searchExhausted,
    releasesExhausted: shared.releasesExhausted,
    incomplete: planned.map((a) => a.n).filter((n) => incompleteSet.has(n)),
  };
}

/**
 * Looks up tracks and makes the playlist.
 * @param {{
 *   api: { get: Function, post: Function }, plan: { artists: any[], leftOut: any[] }, year: number|string,
 *   now?: Date, onProgress?: (p: { phase: string, done?: number, total?: number }) => void, concurrency?: number,
 * }} options
 * @returns {Promise<{
 *   status: 'created'|'incomplete'|'empty', url: string|null, playlistId: string|null, name: string,
 *   trackCount: number, artistCount: number, plannedTracks: number,
 *   leftOut: { n: number, name: string, reason: string }[],
 *   newestReleases: { n: number, name: string, searched: boolean }[],
 *   searchExhausted: boolean, releasesExhausted: boolean, error: { kind: string, message: string }|null,
 * }>} Rejects when the lookup fails or the playlist cannot be created (normally nothing exists then; a create request
 *   that got no answer, or a 5xx, may have been carried out). A failure while adding tracks resolves with status
 *   'incomplete'. An artist counts as included when one of its found tracks is in the final list, even when that
 *   track (a duet) was placed under an earlier artist. `newestReleases` lists artists with at least one track from the
 *   releases route in the playlist as actually added under their own name (not one dropped as a duplicate, not one in a batch that was not added); `searched` is false when Search could not be used for that artist (quota or a failed request).
 */
export async function createPlaylist({ api, plan, year, now = new Date(), onProgress = () => {}, concurrency = CONCURRENCY }) {
  const found = await lookupTracks(api, plan, { onProgress, concurrency });
  const list = buildTrackList(found.artists);
  const listed = new Set(list.map((t) => t.uri));
  const has = (a, uris) => a.tracks.some((t) => uris.has(trackUri(t.id)));
  const incomplete = new Set(found.incomplete);
  const leftOut = [
    ...(Array.isArray(plan?.leftOut) ? plan.leftOut : []),
    ...found.artists
      .filter((a) => !has(a, listed))
      .map((a) => ({
        n: a.n, name: a.name,
        reason: incomplete.has(a.n) ? LEFT_OUT.QUOTA : a.failed ? LEFT_OUT.LOOKUP_FAILED : LEFT_OUT.NO_TRACKS,
      })),
  ];
  const name = playlistName(year, now);
  const result = {
    status: 'empty', url: null, playlistId: null, name,
    trackCount: 0, artistCount: 0, plannedTracks: list.length,
    leftOut,
    newestReleases: [],
    searchExhausted: found.searchExhausted, releasesExhausted: found.releasesExhausted,
    error: null,
  };
  if (list.length === 0) return result;

  onProgress({ phase: 'create' });
  const created = await api.post('me/playlists', { name, description: PLAYLIST_DESCRIPTION, public: false });
  if (!isSpotifyId(created?.id)) throw new SpotifyError('Spotify returned an error (unexpected response). Please try again.', { kind: 'http' });
  result.playlistId = created.id;
  result.url = `${PLAYLIST_URL}${created.id}`;

  const uris = list.map((t) => t.uri);
  let added = 0;
  try {
    for (const batch of batches(uris)) {
      await api.post(`playlists/${created.id}/items`, { uris: batch });
      added += batch.length;
      onProgress({ phase: 'add', done: added, total: uris.length });
    }
    result.status = 'created';
  } catch (err) {
    result.status = 'incomplete';
    result.error = err instanceof SpotifyError
      ? { kind: err.kind ?? 'http', message: err.message }
      : { kind: 'network', message: 'Could not reach Spotify. Check your connection and try again.' };
    log.warn('playlist add stopped', result.error.kind, `${added}/${uris.length}`);
  }
  result.trackCount = added;
  const addedUris = new Set(list.slice(0, added).map((t) => t.uri));
  const addedOwned = new Set(list.slice(0, added).map((t) => `${t.n}|${t.uri}`)); // a track counts for the artist it was placed under
  result.artistCount = found.artists.filter((a) => has(a, addedUris)).length;
  result.newestReleases = found.artists.filter((a) => a.newestIds.some((id) => addedOwned.has(`${a.n}|${trackUri(id)}`))).map((a) => ({ n: a.n, name: a.name, searched: a.searched }));
  return result;
}
