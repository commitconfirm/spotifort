// Playlist source: Spotify. Looks up a few tracks for each planned lineup artist and makes a playlist from them.
// The pure decisions (who gets tracks, which tracks count, how versions collapse, who gets a shared track, batching)
// live in src/core/playlist.js; this module is the I/O around them. docs/PLAN-2027.md, "Playlist creation", and
// docs/research/spotify-playlist-live-tests-2026-11.md.
//
// Two routes find an artist's tracks: Search (one request, but it has a small daily quota) and the artist's newest
// releases (albums, then the tracks of the newest few). Search is tried first for every artist. When Search runs out
// (a 429 with a quota body, a 429 that survived its retries, or a rejected fetch while the releases route still gets
// answers) the remaining artists use the releases route and the result says why. When the releases route runs out of
// quota too, the rest are left out with reason 'quota'.
//
// Order of work: (1) every artist is searched, at most `concurrency` at a time; an artist whose search did not work
// goes straight to the releases route. (2) The tracks are shared out in page order (allocateTracks), so a track on
// two artists' pages goes to the earlier artist and the later one is topped up from its other search results; the
// result does not depend on which response came first. (3) Artists still short of tracks use the releases route,
// which skips tracks already taken. (4) A final share-out in page order.
//
// Auth, permission and network failures during lookup are fatal and nothing is created. Any other failure of one
// lookup request (a 5xx, a plain 429 on the releases route, a 200 whose body is not JSON) only costs that artist
// that route; the artist is then recorded as `failed` so the report can say so.
//
// Known limits. The releases request (`include_groups=album,single&limit=10`) returns albums before singles, so for
// an artist with 10 or more albums a newer single is not seen. Two artists that both use the releases route and
// share a release track can end one track short: the second is not topped up, because that would cost more requests.
// A failure while adding tracks is not thrown: the playlist exists, so the result says how far it got.
//
// Takes an `api` from createApi in ./spotify.js (injected fetch and sleep, so it is tested without a network). It
// uses no storage, no DOM and no token of its own; the token is only ever sent to https://api.spotify.com/.

import { CONCURRENCY, SpotifyError, mapLimit } from './spotify.js';
import {
  LEFT_OUT, MAX_RELEASES, PLAYLIST_DESCRIPTION, TRACKS_PER_ARTIST,
  allocateTracks, batches, buildTrackList, chooseOwnTracks, isSpotifyId, newestReleases, playlistName, trackUri,
} from '../core/playlist.js';
import { log } from '../log.js';

const PLAYLIST_URL = 'https://open.spotify.com/playlist/';

/**
 * One lookup request. Resolves { data } on success or { failed: kind } for a failure of this one request: 'quota'
 * and 'rate' (the caller decides what they mean for the route), 'http' (including a 200 whose body is not JSON), and
 * 'network' only when `softNetwork` is set. Anything else (auth, forbidden, network without `softNetwork`, not a
 * SpotifyError) is fatal: it is recorded in `shared.fatal` and rethrown. `onAnswer` is called when Spotify answered
 * at all (any HTTP status, even an error one), which proves the connection works.
 */
async function call(api, path, shared, stats, { softNetwork = false, onAnswer = null } = {}) {
  try {
    const data = await api.get(path);
    stats.ok++;
    onAnswer?.();
    return { data };
  } catch (err) {
    if (err instanceof SyntaxError) { // a 200 whose body is not JSON
      stats.http++;
      onAnswer?.();
      return { failed: 'http' };
    }
    const kind = err instanceof SpotifyError ? err.kind : null;
    if (kind === 'quota' || kind === 'rate' || kind === 'http') {
      stats[kind]++;
      onAnswer?.();
      return { failed: kind };
    }
    if (kind === 'network' && softNetwork) {
      stats.network++;
      return { failed: 'network' };
    }
    shared.fatal = shared.fatal ?? err;
    throw err;
  }
}

/** True when `picks` plus the unclaimed own tracks in the releases seen so far already make a full set. */
function enough(artist, state, picks, exclude) {
  return chooseOwnTracks(state.releaseItems, artist.spotifyIds, { already: picks, exclude }).length >= TRACKS_PER_ARTIST;
}

/**
 * The artist's newest-releases route. Adds the tracks of the newest releases to `state.releaseItems` and stops once
 * `picks` plus the tracks in them that are not in `exclude` make a full set. Mutates `state`.
 * @param {{ picks: object[], exclude: Set<string>|null, onAnswer?: (() => void)|null }} opts
 */
async function releasesRoute(api, artist, shared, stats, state, { picks, exclude, onAnswer = null }) {
  state.ran = true;
  for (const id of artist.spotifyIds) {
    if (enough(artist, state, picks, exclude)) return;
    if (!isSpotifyId(id)) continue;
    if (shared.fatal) return;
    if (shared.releasesExhausted) { state.incomplete = true; return; }
    const albums = await call(api, `artists/${id}/albums?include_groups=album,single&limit=10`, shared, stats, { onAnswer });
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
      if (enough(artist, state, picks, exclude)) return;
      if (shared.fatal) return;
      if (shared.releasesExhausted) { state.incomplete = true; return; }
      const res = await call(api, `albums/${release.id}/tracks?limit=50`, shared, stats, { onAnswer });
      if (res.failed === 'quota') {
        shared.releasesExhausted = true;
        state.incomplete = true;
        return;
      }
      if (res.failed) { // 'rate' or 'http': abandon this id, keep what was found
        state.failed = true;
        break;
      }
      if (Array.isArray(res.data?.items)) state.releaseItems.push(...res.data.items);
    }
  }
}

/**
 * Looks up tracks for every planned artist, at most `concurrency` artists at a time.
 *
 * Search stops for everyone (`searchStopReason`) when a search fails with 'quota' (a 429 whose body says the daily
 * quota is used up), with 'rate' (a 429 that survived its retries; the body may not be readable in a browser), or
 * with 'network' (the fetch was rejected after its retries) while the releases route for that same artist then gets
 * an answer from Spotify, which shows the connection works and the search request was probably refused without CORS
 * headers. If that artist's releases requests also get no answer, that is a real offline state and the lookup
 * rejects. The artist whose search failed, and every artist after, use the releases route; Search is never retried.
 * @param {{ get: (path: string) => Promise<any> }} api from createApi
 * @param {{ artists: { n: number, name: string, spotifyIds: string[] }[] }} plan from playlistPlan
 * @param {{ onProgress?: (p: { phase: 'lookup', done: number, total: number }) => void, concurrency?: number }} [options]
 *   Progress counts an artist as done when its search worked or its releases lookup finished; artists topped up
 *   afterwards from the releases route are not counted again, so `done` reaches `total` before the last top-ups.
 * @returns {Promise<{
 *   artists: { n: number, name: string, tracks: { id: string, name: string }[], searched: boolean, newestIds: string[], failed: boolean }[],
 *   searchExhausted: boolean, searchStopReason: 'quota'|'rate'|'network'|null, releasesExhausted: boolean, incomplete: number[],
 * }>} artists in plan order, one per planned artist. `tracks` are the artist's own tracks as shared out (at most 3,
 *   none given to two artists, except that a track an earlier artist holds may be listed last as a duet, which
 *   buildTrackList drops from the later artist). `searchExhausted` is true whenever search was stopped, and
 *   `searchStopReason` says why (null when it was not). Rejects on an auth, permission or network failure.
 */
export async function lookupTracks(api, plan, { onProgress = () => {}, concurrency = CONCURRENCY } = {}) {
  const planned = Array.isArray(plan?.artists) ? plan.artists : [];
  const total = planned.length;
  const shared = { searchStopReason: null, releasesExhausted: false, fatal: null };
  const stopSearch = (reason) => { shared.searchStopReason = shared.searchStopReason ?? reason; };
  const stats = { ok: 0, quota: 0, rate: 0, http: 0, network: 0 };
  const per = planned.map(() => ({ searchItems: [], releaseItems: [], searched: false, ran: false, incomplete: false, failed: false }));
  const limit = Math.max(1, concurrency);
  let done = 0;
  const progress = () => { done++; onProgress({ phase: 'lookup', done, total }); };

  // Step 1: search every artist; an artist whose search did not work goes straight to the releases route.
  await mapLimit(planned, limit, async (artist, i) => {
    if (shared.fatal) return;
    const state = per[i];
    let searchWasNetworkFailure = false;
    if (!shared.searchStopReason) {
      const name = String(artist.name ?? '').replace(/"/g, '');
      const q = encodeURIComponent(`artist:"${name}"`);
      const res = await call(api, `search?type=track&limit=10&q=${q}`, shared, stats, { softNetwork: true });
      if (res.failed === 'quota' || res.failed === 'rate') stopSearch(res.failed);
      else if (res.failed === 'network') searchWasNetworkFailure = true;
      else if (res.failed) state.failed = true;
      else {
        state.searched = true;
        state.searchItems = Array.isArray(res.data?.tracks?.items) ? res.data.tracks.items : [];
      }
    }
    if (state.searched) {
      if (!shared.fatal) progress();
      return;
    }
    let answered = false;
    const onAnswer = () => { answered = true; if (searchWasNetworkFailure) stopSearch('network'); };
    await releasesRoute(api, artist, shared, stats, state, { picks: [], exclude: null, onAnswer });
    if (searchWasNetworkFailure && !answered && !shared.fatal) {
      // Search got no answer and the releases route got none either (or made no request): offline as far as we can
      // tell. Never treat that as "search is blocked"; it stops everything, as a network failure always did.
      shared.fatal = new SpotifyError('Could not reach Spotify. Check your connection and try again.', { kind: 'network' });
      throw shared.fatal;
    }
    // mapLimit does not cancel workers in flight: once another artist hit a fatal error, report nothing more.
    if (shared.fatal) return;
    progress();
  });

  // Step 2: who has what from search alone, in page order. Artists still short use the releases route, which skips
  // the tracks already taken. The set of taken tracks is fixed before any of those requests, so the requests made
  // do not depend on which answer arrives first.
  const entries = () => planned.map((a, i) => ({ spotifyIds: a.spotifyIds, searchItems: per[i].searchItems, releaseItems: per[i].releaseItems }));
  const fromSearchOnly = allocateTracks(planned.map((a, i) => ({ spotifyIds: a.spotifyIds, searchItems: per[i].searchItems })));
  const taken = new Set(fromSearchOnly.flatMap((r) => r.tracks.map((t) => t.id)));
  const needTopUp = planned.map((_, i) => i).filter((i) => !per[i].ran && fromSearchOnly[i].tracks.length < TRACKS_PER_ARTIST);
  await mapLimit(needTopUp, limit, async (i) => {
    if (shared.fatal) return;
    await releasesRoute(api, planned[i], shared, stats, per[i], { picks: fromSearchOnly[i].tracks, exclude: taken });
  });

  // Step 3: the final share-out, in page order.
  const final = allocateTracks(entries());
  const results = planned.map((a, i) => ({
    n: a.n, name: a.name,
    tracks: [...final[i].tracks, ...final[i].shared],
    searched: per[i].searched,
    newestIds: final[i].tracks.slice(final[i].fromSearch).map((t) => t.id), // the tracks the releases route found
    failed: per[i].failed,
  }));

  log.info('playlist lookup requests', stats);
  return {
    artists: results,
    searchExhausted: shared.searchStopReason !== null,
    searchStopReason: shared.searchStopReason,
    releasesExhausted: shared.releasesExhausted,
    incomplete: planned.map((a, i) => (per[i].incomplete ? a.n : null)).filter((n) => n !== null),
  };
}

/**
 * Looks up tracks and makes the playlist.
 * @param {{
 *   api: { get: Function, post: Function }, plan: { artists: any[], leftOut: any[] }, year: number|string,
 *   now?: Date, onProgress?: (p: { phase: string, done?: number, total?: number }) => void, concurrency?: number,
 * }} options
 * @returns {Promise<{
 *   status: 'created'|'incomplete'|'empty'|'unconfirmed', url: string|null, playlistId: string|null, name: string,
 *   trackCount: number, artistCount: number, plannedTracks: number,
 *   leftOut: { n: number, name: string, reason: string }[],
 *   newestReleases: { n: number, name: string, searched: boolean }[],
 *   searchExhausted: boolean, searchStopReason: 'quota'|'rate'|'network'|null, releasesExhausted: boolean,
 *   error: { kind: string, message: string }|null,
 * }>}
 * Statuses (resolved):
 * - 'created': the playlist exists and every planned track was added. `error` is null.
 * - 'incomplete': the playlist exists (`url`, `playlistId` set) but adding stopped part-way. `error` says why;
 *   `trackCount` is a lower bound (the failed batch is not retried and may have been applied).
 * - 'empty': no track was found for anyone, so nothing was created. `url` and `playlistId` are null, `error` is null.
 * - 'unconfirmed': the create request may or may not have been carried out, so a playlist named `name` may exist:
 *   the visitor should look for it in Spotify before making another. `url` and `playlistId` are null, `trackCount`
 *   and `artistCount` are 0, no track was added (there is no id to add to), and `plannedTracks`, `leftOut` and
 *   `searchExhausted` are filled. `error.kind` is 'network' (the request got no answer; it is not retried), 'http'
 *   (a 5xx answer, not retried) or 'response' (a 2xx answer whose body was empty, not JSON or had no valid id).
 *   The messages do not say to try again.
 * `searchStopReason` is why Search was switched off for the remaining artists (see lookupTracks), or null;
 * `searchExhausted` is true exactly when it is not null.
 *
 * Rejections (a SpotifyError with `kind`; nothing was created, so trying again is safe, except that an offline
 * failure may still have spent requests): during lookup 'auth' (401), 'forbidden' (403), 'network' (no answer to a
 * releases request or, when search also failed, to anything; see lookupTracks) and any other non-Spotify error;
 * on the create request 'auth' (401), 'forbidden' (403), 'rate' (a 429 that survived its retries), 'quota' (a 429
 * with a quota body, at once) and 'http' for a 4xx other than those (for example 400). A 5xx or no answer on the
 * create request is NOT a rejection: it resolves 'unconfirmed'. A failure while adding never rejects.
 * An artist counts as included when one of its found tracks is in the final list, even when that
 * track (a duet) was placed under an earlier artist. `newestReleases` lists artists with at least one track from the
 * releases route in the playlist as actually added under their own name (not one dropped as a duplicate, not one in a
 * batch that was not added); `searched` is false when Search could not be used for that artist (stopped or failed).
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
    searchExhausted: found.searchExhausted, searchStopReason: found.searchStopReason, releasesExhausted: found.releasesExhausted,
    error: null,
  };
  if (list.length === 0) return result;

  onProgress({ phase: 'create' });
  const unconfirmed = (kind) => {
    result.status = 'unconfirmed';
    result.error = { kind, message: `Spotify did not confirm that the playlist was made. It may exist: look for "${name}" in your Spotify library before making another.` };
    log.warn('playlist create not confirmed', kind);
    return result;
  };
  let created;
  try {
    created = await api.post('me/playlists', { name, description: PLAYLIST_DESCRIPTION, public: false });
  } catch (err) {
    // No answer, or a 5xx: the request may have reached Spotify and made the playlist. A 401, 403, 429 or other 4xx
    // is a clear refusal and stays a rejection.
    if (err instanceof SpotifyError && (err.kind === 'network' || (err.kind === 'http' && err.status >= 500))) return unconfirmed(err.kind);
    throw err;
  }
  if (!isSpotifyId(created?.id)) return unconfirmed('response'); // a 2xx answer: Spotify did make something
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
