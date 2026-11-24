import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../src/sources/spotify.js';
import { SEARCH_ERROR_LIMIT, createPlaylist, lookupTracks } from '../src/sources/spotify-playlist.js';
import {
  ADD_BATCH_SIZE, LEFT_OUT, MAX_RELEASES, PLAYLIST_DESCRIPTION, playlistName,
} from '../src/core/playlist.js';

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});
const QUOTA = () => json({ error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } }, 429, { 'Retry-After': '82000' });

/** A Spotify track by one or more artist ids. */
const trk = (id, name, ...artistIds) => ({ id, name, artists: artistIds.map((a) => ({ id: a })) });
/** `count` distinct songs by one artist id. */
const own = (artistId, count = 3, prefix = 't') => Array.from({ length: count }, (_, k) => trk(`${artistId}${prefix}${k}`, `Song ${artistId} ${prefix} ${k}`, artistId));

/** A plan of `count` artists; artist i (0-based) has n = i + 1, name `Artist i` and Spotify id `ART<i>`. */
const mkPlan = (count, leftOut = []) => ({
  artists: Array.from({ length: count }, (_, i) => ({ n: i + 1, name: `Artist ${i}`, spotifyIds: [`ART${i}`] })),
  leftOut,
});

/**
 * A configurable fake Spotify.
 *   search(name)   -> track items (array) | Response-like object, default: 3 own tracks of the artist named `Artist <i>`
 *   albums(id)     -> album items | Response-like, default []
 *   albumTracks(id)-> track items | Response-like, default []
 *   override(req)  -> Response-like to short-circuit (or throw to simulate a network failure); req = { method, path, url, body }
 */
function fakeSpotify({ search, albums, albumTracks, override } = {}) {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  let postInFlight = 0;
  let postPeak = 0;
  const fetch = vi.fn(async (url, init = {}) => {
    expect(init.headers.Authorization).toBe('Bearer tok');
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const req = { method, path: u.pathname, url, body, params: u.searchParams };
    calls.push(req);
    inFlight++;
    peak = Math.max(peak, inFlight);
    if (method === 'POST') { postInFlight++; postPeak = Math.max(postPeak, postInFlight); }
    try {
      await new Promise((r) => setTimeout(r, 1));
      const forced = override?.(req);
      if (forced) return forced;
      const wrap = (v, shape) => (v && typeof v.ok === 'boolean' ? v : json(shape(v)));
      if (method === 'POST' && u.pathname === '/v1/me/playlists') return json({ id: 'PL1', external_urls: { spotify: 'https://evil.example/x' } }, 201);
      if (method === 'POST' && /^\/v1\/playlists\/[A-Za-z0-9]+\/items$/.test(u.pathname)) return json({ snapshot_id: 'x' }, 201);
      if (u.pathname === '/v1/search') {
        const name = /artist:"(.*)"/.exec(u.searchParams.get('q'))?.[1] ?? '';
        const v = search ? search(name) : (() => { const m = /^Artist (\d+)$/.exec(name); return m ? own(`ART${m[1]}`) : []; })();
        return wrap(v, (items) => ({ tracks: { items } }));
      }
      let m = /^\/v1\/artists\/([A-Za-z0-9]+)\/albums$/.exec(u.pathname);
      if (m) return wrap(albums ? albums(m[1]) : [], (items) => ({ items }));
      m = /^\/v1\/albums\/([A-Za-z0-9]+)\/tracks$/.exec(u.pathname);
      if (m) return wrap(albumTracks ? albumTracks(m[1]) : [], (items) => ({ items }));
      return json({}, 404);
    } finally {
      inFlight--;
      if (method === 'POST') postInFlight--;
    }
  });
  const sleep = vi.fn(async () => {});
  const api = createApi({ token: 'tok', fetch, sleep });
  const where = (pred) => calls.filter(pred);
  return {
    api, fetch, sleep, calls,
    searches: () => where((c) => c.path === '/v1/search'),
    albumReqs: () => where((c) => /\/albums$/.test(c.path)),
    trackReqs: () => where((c) => /^\/v1\/albums\/[^/]+\/tracks$/.test(c.path)),
    posts: () => where((c) => c.method === 'POST'),
    adds: () => where((c) => c.method === 'POST' && c.path.endsWith('/items')),
    get peak() { return peak; },
    get postPeak() { return postPeak; },
  };
}

const NOW = new Date(2026, 10, 23);
const run = (f, plan, extra = {}) => createPlaylist({ api: f.api, plan, year: 2027, now: NOW, ...extra });
const addedUris = (f) => f.adds().flatMap((c) => c.body.uris);

describe('createPlaylist: happy path', () => {
  it('adds each artist\'s tracks together in plan order and creates the playlist after every lookup', async () => {
    const f = fakeSpotify();
    const out = await run(f, mkPlan(3), { concurrency: 3 });
    expect(addedUris(f)).toEqual(['ART0', 'ART1', 'ART2'].flatMap((a) => [0, 1, 2].map((k) => `spotify:track:${a}t${k}`)));
    const firstPost = f.calls.findIndex((c) => c.method === 'POST');
    expect(f.calls.slice(0, firstPost).every((c) => c.method === 'GET')).toBe(true);
    expect(f.calls.slice(firstPost).every((c) => c.method === 'POST')).toBe(true);
    const search = f.searches()[0];
    expect(search.params.get('type')).toBe('track');
    expect(search.params.get('limit')).toBe('10');
    expect(search.params.get('q')).toMatch(/^artist:"Artist \d"$/);
    expect(search.params.has('market')).toBe(false);
    const create = f.posts()[0];
    expect(create.path).toBe('/v1/me/playlists');
    expect(create.body).toEqual({ name: playlistName(2027, NOW), description: PLAYLIST_DESCRIPTION, public: false });
    expect(out).toEqual({
      status: 'created', url: 'https://open.spotify.com/playlist/PL1', playlistId: 'PL1', name: playlistName(2027, NOW),
      trackCount: 9, artistCount: 3, plannedTracks: 9, leftOut: [], newestReleases: [],
      searchExhausted: false, searchStopReason: null, releasesExhausted: false, releasesStopReason: null, error: null,
    });
    expect(f.albumReqs()).toHaveLength(0);
  });

  it('keeps the plan\'s own left-out list first and unchanged', async () => {
    const f = fakeSpotify();
    const left = [{ n: 99, name: 'Nope', reason: LEFT_OUT.UNVERIFIED }];
    const out = await run(f, mkPlan(1, left));
    expect(out.leftOut).toEqual(left);
  });

  it('encodes an artist name with a double quote and an ampersand safely', async () => {
    const f = fakeSpotify({ search: () => [] });
    const plan = { artists: [{ n: 1, name: 'Tom "T" & Jerry?#', spotifyIds: ['X1'] }], leftOut: [] };
    await lookupTracks(f.api, plan);
    const url = f.searches()[0].url;
    expect(url).toContain('q=' + encodeURIComponent('artist:"Tom T & Jerry?#"'));
    expect(f.searches()[0].params.get('q')).toBe('artist:"Tom T & Jerry?#"');
    expect(f.searches()[0].params.get('type')).toBe('track');
  });

  it('only ever sends the token to api.spotify.com', async () => {
    const f = fakeSpotify();
    await run(f, mkPlan(3));
    expect(f.calls.length).toBeGreaterThan(3);
    expect(f.calls.every((c) => c.url.startsWith('https://api.spotify.com/'))).toBe(true);
  });

  it('never takes the link from the response\'s URL fields', async () => {
    const f = fakeSpotify();
    const out = await run(f, mkPlan(1));
    expect(out.url).toBe('https://open.spotify.com/playlist/PL1');
  });
});

describe('createPlaylist: choosing tracks', () => {
  it('never adds another artist\'s tracks that share the name, and fills from newest releases', async () => {
    const f = fakeSpotify({
      search: () => own('OTHER9'),
      albums: (id) => (id === 'ART0' ? [{ id: 'AL0', name: 'Alb', release_date: '2024-01-01' }] : []),
      albumTracks: () => own('ART0', 3, 'r'),
    });
    const out = await run(f, mkPlan(1));
    expect(addedUris(f)).toEqual([0, 1, 2].map((k) => `spotify:track:ART0r${k}`));
    expect(out.newestReleases).toEqual([{ n: 1, name: 'Artist 0', searched: true }]);
    expect(out.leftOut).toEqual([]);
  });

  it('marks searched true for an artist topped up from releases after a successful search', async () => {
    const f = fakeSpotify({
      search: () => [trk('s1', 'Only', 'ART0')],
      albums: () => [{ id: 'AL0', name: 'Alb', release_date: '2024-01-01' }],
      albumTracks: () => [trk('r1', 'Second', 'ART0'), trk('r2', 'Third', 'ART0')],
    });
    const out = await run(f, mkPlan(1));
    expect(out.trackCount).toBe(3);
    expect(out.newestReleases).toEqual([{ n: 1, name: 'Artist 0', searched: true }]);
  });

  it('leaves an artist out as no-tracks when nothing is found anywhere', async () => {
    const f = fakeSpotify({ search: (name) => (name === 'Artist 0' ? own('OTHER9') : own('ART1')) });
    const out = await run(f, mkPlan(2));
    expect(out.status).toBe('created');
    expect(out.leftOut).toEqual([{ n: 1, name: 'Artist 0', reason: LEFT_OUT.NO_TRACKS }]);
    expect(out.trackCount).toBe(3);
    expect(out.artistCount).toBe(1);
  });

  it('collapses versions of one song, and a track shared by two lineup artists appears once', async () => {
    const shared = trk('SHARED', 'Duet', 'ART0', 'ART1');
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0'
        ? [trk('a1', 'Song', 'ART0'), trk('a2', 'Song - Remastered 2011', 'ART0'), trk('a3', 'Song (Acoustic)', 'ART0'), shared, trk('a4', 'Other', 'ART0'), trk('a5', 'Third', 'ART0')]
        : [shared, ...own('ART1', 2)]),
    });
    const out = await run(f, mkPlan(2));
    const uris = addedUris(f);
    expect(uris).toEqual(['spotify:track:a1', 'spotify:track:SHARED', 'spotify:track:a4', 'spotify:track:ART1t0', 'spotify:track:ART1t1']);
    expect(new Set(uris).size).toBe(uris.length);
    expect(out.trackCount).toBe(5);
  });

  it('an artist with only 2 songs on Spotify keeps 2 and is not left out', async () => {
    const f = fakeSpotify({ search: () => own('ART0', 2) });
    const out = await run(f, mkPlan(1));
    expect(out.trackCount).toBe(2);
    expect(out.leftOut).toEqual([]);
    expect(f.albumReqs()).toHaveLength(1);
  });

  it('a realistic artist with only 2 songs: search finds them as singles, the album holds the same 2 as other versions', async () => {
    const f = fakeSpotify({
      search: () => [trk('s1', 'Alpha', 'ART0'), trk('s2', 'Beta', 'ART0')],
      albums: () => [{ id: 'AL0', name: 'The Album', release_date: '2024-01-01' }],
      albumTracks: () => [trk('r1', 'Alpha', 'ART0'), trk('r2', 'Beta - Remastered', 'ART0')],
    });
    const out = await run(f, mkPlan(1));
    expect(addedUris(f)).toEqual(['spotify:track:s1', 'spotify:track:s2']);
    expect(out.trackCount).toBe(2);
    expect(out.leftOut).toEqual([]);
    expect(out.newestReleases).toEqual([]);
  });

  it('an artist whose only own track is a duet already placed under an earlier artist is not left out', async () => {
    const duet = trk('DUET', 'Duet', 'ART0', 'ART1');
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [duet, trk('a1', 'One', 'ART0'), trk('a2', 'Two', 'ART0')] : [duet]),
    });
    const out = await run(f, mkPlan(2), { concurrency: 1 });
    expect(addedUris(f)).toEqual(['spotify:track:DUET', 'spotify:track:a1', 'spotify:track:a2']);
    expect(out.leftOut).toEqual([]);
    expect(out.artistCount).toBe(2);
    expect(out.trackCount).toBe(3);
  });

  it('an artist with 3 tracks from search causes no albums requests', async () => {
    const f = fakeSpotify();
    await run(f, mkPlan(2));
    expect(f.albumReqs()).toHaveLength(0);
    expect(f.trackReqs()).toHaveLength(0);
  });
});

describe('createPlaylist: newest releases route', () => {
  const noSearch = { search: () => [] };

  it('reads albums returned grouped by type newest first', async () => {
    const f = fakeSpotify({
      ...noSearch,
      albums: () => [
        { id: 'ALOLD', name: 'Old album', release_date: '2019-01-01' },
        { id: 'SNEW', name: 'New single', release_date: '2024-05-05' },
      ],
      albumTracks: () => [],
    });
    await lookupTracks(f.api, mkPlan(1));
    expect(f.albumReqs()[0].params.get('include_groups')).toBe('album,single');
    expect(f.albumReqs()[0].params.get('limit')).toBe('10');
    expect(f.trackReqs().map((c) => c.path)).toEqual(['/v1/albums/SNEW/tracks', '/v1/albums/ALOLD/tracks']);
    expect(f.trackReqs()[0].params.get('limit')).toBe('50');
  });

  it('reads at most MAX_RELEASES releases per id', async () => {
    const f = fakeSpotify({
      ...noSearch,
      albums: () => Array.from({ length: 8 }, (_, i) => ({ id: `AL${i}`, name: `A${i}`, release_date: `202${i}-01-01` })),
    });
    await lookupTracks(f.api, mkPlan(1));
    expect(f.trackReqs()).toHaveLength(MAX_RELEASES);
  });

  it('uses the second Spotify id when the first gives too few', async () => {
    const f = fakeSpotify({
      ...noSearch,
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: (id) => (id === 'ALA1' ? [trk('x1', 'One', 'A1')] : [trk('x2', 'Two', 'A2'), trk('x3', 'Three', 'A2'), trk('x4', 'Four', 'A2')]),
    });
    const plan = { artists: [{ n: 1, name: 'Dual', spotifyIds: ['A1', 'A2'] }], leftOut: [] };
    const out = await createPlaylist({ api: f.api, plan, year: 2027, now: NOW });
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/A1/albums', '/v1/artists/A2/albums']);
    expect(addedUris(f)).toEqual(['spotify:track:x1', 'spotify:track:x2', 'spotify:track:x3']);
    expect(out.trackCount).toBe(3);
  });

  it('a 404 on one artist\'s albums does not stop the others', async () => {
    const f = fakeSpotify({
      search: () => [],
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: (id) => own(id.slice(2), 2, 'r'),
      override: (r) => (r.path === '/v1/artists/ART1/albums' ? json({}, 404) : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.status).toBe('created');
    expect(out.leftOut.map((l) => l.n)).toEqual([2]);
    expect(out.leftOut[0].reason).toBe(LEFT_OUT.LOOKUP_FAILED);
  });

  it('search and releases both fine but nothing own is no-tracks, not lookup-failed', async () => {
    const f = fakeSpotify({
      search: () => own('OTHER9'),
      albums: () => [{ id: 'AL0', name: 'A', release_date: '2024-01-01' }],
      albumTracks: () => own('OTHER9', 3, 'r'),
    });
    const out = await run(f, mkPlan(3));
    expect(out.leftOut.map((l) => l.reason)).toEqual([LEFT_OUT.NO_TRACKS, LEFT_OUT.NO_TRACKS, LEFT_OUT.NO_TRACKS]);
    expect(out.status).toBe('empty');
  });

  it('a 200 whose body is not JSON fails only that artist\'s search; the artist is filled from releases', async () => {
    const f = fakeSpotify({
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: (id) => own(id.slice(2), 3, 'r'),
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === 'artist:"Artist 1"'
        ? { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected token <'); } }
        : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.status).toBe('created');
    expect(out.trackCount).toBe(9);
    expect(out.leftOut).toEqual([]);
    expect(out.searchExhausted).toBe(false);
    expect(out.newestReleases).toEqual([{ n: 2, name: 'Artist 1', searched: false }]);
  });
});

describe('createPlaylist: newestReleases reflects the playlist', () => {
  it('does not list an artist whose releases-route track was dropped as a duplicate of an earlier artist\'s', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [trk('DUET', 'Duet', 'ART0', 'ART1'), ...own('ART0', 2)] : [trk('X', 'Own song', 'ART1')]),
      albums: (id) => (id === 'ART1' ? [{ id: 'ALB1', name: 'A', release_date: '2024-01-01' }] : []),
      albumTracks: () => [trk('DUET', 'Duet', 'ART0', 'ART1')],
    });
    const out = await run(f, mkPlan(2), { concurrency: 1 });
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/ART1/albums']);
    expect(addedUris(f)).toContain('spotify:track:X');
    expect(out.leftOut).toEqual([]);
    expect(out.artistCount).toBe(2);
    expect(out.newestReleases).toEqual([]);
  });

  it('after a failed second batch lists only artists whose releases-route tracks were actually added', async () => {
    let n = 0;
    const f = fakeSpotify({
      search: (name) => (/^Artist (\d+)$/.test(name) ? [] : []),
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: (id) => own(id.slice(2), 3, 'r'),
      override: (r) => (r.path.endsWith('/items') && ++n === 2 ? json({}, 502) : undefined),
    });
    const out = await run(f, mkPlan(40), { concurrency: 1 }); // 120 tracks: batch 1 holds artists 1-33 and one track of 34
    expect(out.status).toBe('incomplete');
    expect(out.trackCount).toBe(100);
    const listedNs = out.newestReleases.map((r) => r.n);
    expect(listedNs).toContain(1);
    expect(listedNs).toContain(34);
    expect(listedNs).not.toContain(35);
    expect(listedNs).not.toContain(40);
    expect(listedNs).toHaveLength(34);
  });
});

describe('createPlaylist: quota', () => {
  const quotaFrom = (k) => {
    let n = 0;
    return (r) => (r.path === '/v1/search' && ++n > k ? QUOTA() : undefined);
  };
  const releasesFor = {
    albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
    albumTracks: (id) => own(id.slice(2), 3, 'r'),
  };

  it('switches to newest releases once search is out of quota (concurrency 1)', async () => {
    const f = fakeSpotify({ ...releasesFor, override: quotaFrom(3) });
    const out = await run(f, mkPlan(6), { concurrency: 1 });
    expect(f.searches()).toHaveLength(4); // 3 answered, 1 quota, none started afterwards
    expect(f.sleep).not.toHaveBeenCalled();
    expect(out.searchExhausted).toBe(true);
    expect(out.releasesExhausted).toBe(false);
    expect(out.newestReleases).toEqual([4, 5, 6].map((n) => ({ n, name: `Artist ${n - 1}`, searched: false })));
    expect(out.status).toBe('created');
    expect(out.trackCount).toBe(18);
    expect(out.leftOut).toEqual([]);
  });

  it('with concurrency 4 at most answered-before-quota plus concurrency searches are started', async () => {
    const f = fakeSpotify({ ...releasesFor, override: quotaFrom(2) });
    const out = await run(f, mkPlan(20), { concurrency: 4 });
    // 2 searches are answered; every worker has at most one search in flight and stops searching once its own
    // answer is quota (or it sees the switch), so at most 4 more are started: 2 + 4.
    expect(f.searches().length).toBeLessThanOrEqual(2 + 4);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(out.status).toBe('created');
    expect(out.searchExhausted).toBe(true);
    expect(out.trackCount).toBe(60);
    expect(out.leftOut).toEqual([]);
  });

  it('a QUOTA_EXCEEDED answer to a search records searchStopReason quota', async () => {
    const f = fakeSpotify({ ...releasesFor, override: quotaFrom(1) });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.searchExhausted).toBe(true);
    expect(out.searchStopReason).toBe('quota');
    expect(f.searches()).toHaveLength(2);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(out.trackCount).toBe(9);
  });

  it('a 429 on a search that survives its retries switches every remaining artist to newest releases', async () => {
    const f = fakeSpotify({
      ...releasesFor,
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === 'artist:"Artist 1"' ? json({}, 429) : undefined),
    });
    const found = await lookupTracks(f.api, mkPlan(4), { concurrency: 1 });
    // artist 0 searched once; artist 1 searched 5 times (4 waits) and is then served from releases; 2 and 3 never search
    expect(f.searches()).toHaveLength(1 + 5);
    expect(f.sleep).toHaveBeenCalledTimes(4);
    expect(found.searchExhausted).toBe(true);
    expect(found.searchStopReason).toBe('rate');
    expect(found.releasesExhausted).toBe(false);
    expect(found.artists.map((a) => a.searched)).toEqual([true, false, false, false]);
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/ART1/albums', '/v1/artists/ART2/albums', '/v1/artists/ART3/albums']);
    expect(found.artists.every((a) => a.tracks.length === 3)).toBe(true);
    expect(found.artists.map((a) => a.failed)).toEqual([false, false, false, false]);
  });

  it('a rate-limited search makes the playlist from newest releases and reports why', async () => {
    const f = fakeSpotify({ ...releasesFor, override: (r) => (r.path === '/v1/search' ? json({}, 429) : undefined) });
    const out = await run(f, mkPlan(5), { concurrency: 1 });
    expect(f.searches()).toHaveLength(5); // one artist's five attempts, nothing afterwards
    expect(out).toMatchObject({ status: 'created', trackCount: 15, searchExhausted: true, searchStopReason: 'rate', leftOut: [] });
    expect(out.newestReleases.map((r) => r.searched)).toEqual([false, false, false, false, false]);
  });

  it('searchStopReason is null when search is never stopped', async () => {
    const f = fakeSpotify();
    const out = await run(f, mkPlan(2));
    expect(out.searchStopReason).toBeNull();
    expect(out.searchExhausted).toBe(false);
  });

  it('a 429 that survives its retries on the releases route stops the route for everyone, as a quota does', async () => {
    const f = fakeSpotify({
      ...releasesFor,
      search: () => [],
      override: (r) => (r.path === '/v1/artists/ART0/albums' ? json({}, 429) : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(f.albumReqs().map((c) => c.path)).toEqual(Array(5).fill('/v1/artists/ART0/albums')); // nothing after the first artist
    expect(out.releasesExhausted).toBe(true);
    expect(out.releasesStopReason).toBe('rate');
    expect(out.searchExhausted).toBe(false);
    expect(out.status).toBe('empty');
    expect(out.leftOut).toEqual([1, 2, 3].map((n) => ({ n, name: `Artist ${n - 1}`, reason: LEFT_OUT.QUOTA })));
  });

  it('leaves the rest out as quota when the releases route runs dry too (concurrency 1)', async () => {
    let n = 0;
    const f = fakeSpotify({
      ...releasesFor,
      override: (r) => {
        if (r.path === '/v1/search') return QUOTA();
        if (/\/albums$/.test(r.path) && ++n > 2) return QUOTA();
        return undefined;
      },
    });
    const out = await run(f, mkPlan(6), { concurrency: 1 });
    expect(f.albumReqs()).toHaveLength(3); // the third answered quota; none started after
    expect(f.searches()).toHaveLength(1);
    expect(out.status).toBe('created');
    expect(out.trackCount).toBe(6);
    expect(out.releasesExhausted).toBe(true);
    expect(out.leftOut).toEqual([3, 4, 5, 6].map((n) => ({ n, name: `Artist ${n - 1}`, reason: LEFT_OUT.QUOTA })));
    expect(out.newestReleases.map((r) => r.n)).toEqual([1, 2]);
  });

  it('is empty, with no POST at all, when everything is exhausted from the first request', async () => {
    const f = fakeSpotify({ override: (r) => (r.method === 'GET' ? QUOTA() : undefined) });
    const plan = mkPlan(3, [{ n: 50, name: 'Pre', reason: LEFT_OUT.NO_SPOTIFY }]);
    const out = await run(f, plan, { concurrency: 1 });
    expect(out.status).toBe('empty');
    expect(out.url).toBeNull();
    expect(out.playlistId).toBeNull();
    expect(f.posts()).toHaveLength(0);
    expect(out.leftOut).toEqual([
      { n: 50, name: 'Pre', reason: LEFT_OUT.NO_SPOTIFY },
      ...[1, 2, 3].map((n) => ({ n, name: `Artist ${n - 1}`, reason: LEFT_OUT.QUOTA })),
    ]);
    expect(out.searchExhausted).toBe(true);
    expect(out.releasesExhausted).toBe(true);
  });
});

describe('createPlaylist: fatal lookup failures', () => {
  it('401 rejects with kind auth, creates nothing and starts nothing further (concurrency 1)', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/search' ? json({}, 401) : undefined) });
    await expect(run(f, mkPlan(5), { concurrency: 1 })).rejects.toMatchObject({ kind: 'auth' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.posts()).toHaveLength(0);
  });

  it('reports no progress after the promise has rejected, although other artists were still in flight', async () => {
    const slow = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
    const f = fakeSpotify({
      override: (r) => {
        if (r.path !== '/v1/search') return undefined;
        const m = /Artist (\d+)/.exec(r.params.get('q'));
        return m[1] === '0' ? json({}, 401) : slow(40, json({ tracks: { items: own(`ART${m[1]}`) } }));
      },
    });
    const events = [];
    let atReject = -1;
    const p = lookupTracks(f.api, mkPlan(8), { concurrency: 4, onProgress: (e) => events.push(e) })
      .catch((err) => { atReject = events.length; throw err; });
    await expect(p).rejects.toMatchObject({ kind: 'auth' });
    await new Promise((r) => setTimeout(r, 150)); // the slow searches finish meanwhile
    expect(atReject).toBe(0);
    expect(events).toHaveLength(atReject);
    expect(f.searches()).toHaveLength(4); // nothing new was started after the failure
  });

  it('403 rejects with kind forbidden and creates nothing', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/search' ? json({}, 403) : undefined) });
    await expect(run(f, mkPlan(5), { concurrency: 2 })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(f.posts()).toHaveLength(0);
  });

  it('a network failure rejects with kind network and creates nothing', async () => {
    const f = fakeSpotify({ override: () => { throw new TypeError('offline'); } });
    await expect(run(f, mkPlan(3), { concurrency: 1 })).rejects.toMatchObject({ kind: 'network' });
    expect(f.posts()).toHaveLength(0);
  });

  it('a 401 on the releases route is fatal too', async () => {
    const f = fakeSpotify({ search: () => [], override: (r) => (/\/albums$/.test(r.path) ? json({}, 401) : undefined) });
    await expect(run(f, mkPlan(3), { concurrency: 1 })).rejects.toMatchObject({ kind: 'auth' });
    expect(f.posts()).toHaveLength(0);
  });
});

describe('createPlaylist: creating', () => {
  it.each([
    ['401', () => json({}, 401), 'auth'],
    ['403', () => json({}, 403), 'forbidden'],
  ])('%s on POST me/playlists rejects and adds nothing', async (_n, res, kind) => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? res() : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind });
    expect(f.adds()).toHaveLength(0);
  });

  const createNames = (f) => f.posts().map((c) => c.path);
  const expectUnconfirmed = (f, out, kind) => {
    expect(out).toMatchObject({
      status: 'unconfirmed', url: null, playlistId: null, name: playlistName(2027, NOW),
      trackCount: 0, artistCount: 0, plannedTracks: 6, leftOut: [], newestReleases: [],
    });
    expect(out.error.kind).toBe('unconfirmed');
    expect(out.error.cause).toBe(kind);
    expect(out.error.message).toContain(playlistName(2027, NOW));
    expect(out.error.message.toLowerCase()).not.toContain('try again');
    expect(createNames(f)).toEqual(['/v1/me/playlists']); // one create request, nothing added
    expect(f.adds()).toHaveLength(0);
  };

  it('a network failure on POST me/playlists is unconfirmed, not retried, and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => { if (r.path === '/v1/me/playlists') throw new TypeError('offline'); } });
    expectUnconfirmed(f, await run(f, mkPlan(2)), 'network');
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('a 502 on POST me/playlists is unconfirmed after one create request and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json({}, 502) : undefined) });
    expectUnconfirmed(f, await run(f, mkPlan(2)), 'http');
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['400', 400],
    ['404', 404],
  ])('a %s on POST me/playlists is a clear refusal and still rejects', async (_n, status) => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json({}, status) : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'http', status });
    expect(f.posts()).toHaveLength(1);
    expect(f.adds()).toHaveLength(0);
  });

  it('a 429 that survives its retries on POST me/playlists still rejects with kind rate', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json({}, 429) : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'rate' });
    expect(f.adds()).toHaveLength(0);
  });

  it('a QUOTA_EXCEEDED 429 on POST me/playlists rejects with kind quota at once and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? QUOTA() : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'quota' });
    expect(f.posts()).toHaveLength(1);
    expect(f.adds()).toHaveLength(0);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['no id', () => json({}, 201)],
    ['an id with odd characters', () => json({ id: '../evil' }, 201)],
    ['a non-string id', () => json({ id: 5 }, 201)],
    ['an empty body', () => ({ ok: true, status: 201, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } })],
    ['a body that is not JSON', () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
    ['a JSON body that is null', () => json(null, 201)],
  ])('a 2xx create answer with %s is unconfirmed, never a rejection, and adds nothing', async (_n, res) => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? res() : undefined) });
    expectUnconfirmed(f, await run(f, mkPlan(2)), 'response');
  });

  it('an unconfirmed result still reports the left-out list and the search stop', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? own('OTHER9') : own('ART1')),
      override: (r) => (r.path === '/v1/me/playlists' ? json({}, 500) : undefined),
    });
    const out = await run(f, mkPlan(2, [{ n: 9, name: 'Pre', reason: LEFT_OUT.NO_SPOTIFY }]));
    expect(out.status).toBe('unconfirmed');
    expect(out.plannedTracks).toBe(3);
    expect(out.leftOut).toEqual([{ n: 9, name: 'Pre', reason: LEFT_OUT.NO_SPOTIFY }, { n: 1, name: 'Artist 0', reason: LEFT_OUT.NO_TRACKS }]);
    expect(out.searchStopReason).toBeNull();
  });
});

const expectIncompleteMessage = (out) => {
  expect(out.error.message.toLowerCase()).not.toContain('try again');
  expect(out.error.message).toContain('not every track was added');
  expect(out.error.message).toContain(out.name);
};

describe('createPlaylist: adding', () => {
  it('adds more than 100 tracks in sequential requests of 100 and 20, with progress', async () => {
    const f = fakeSpotify();
    const events = [];
    const out = await run(f, mkPlan(40), { onProgress: (p) => events.push(p) });
    expect(f.adds().map((c) => c.body.uris.length)).toEqual([ADD_BATCH_SIZE, 20]);
    expect(f.adds().every((c) => c.path === '/v1/playlists/PL1/items')).toBe(true);
    expect(f.postPeak).toBe(1);
    expect(events.filter((e) => e.phase === 'add')).toEqual([{ phase: 'add', done: 100, total: 120 }, { phase: 'add', done: 120, total: 120 }]);
    expect(out).toMatchObject({ status: 'created', trackCount: 120, artistCount: 40, plannedTracks: 120 });
  });

  it.each([
    ['403', (r, n) => (n === 2 ? json({}, 403) : undefined), 'forbidden', 2],
    ['401', (r, n) => (n === 2 ? json({}, 401) : undefined), 'auth', 2],
    ['a rejected fetch', (r, n) => { if (n === 2) throw new TypeError('offline'); }, 'network', 2],
  ])('a failure on the second add batch (%s) resolves incomplete with the link', async (_n, fail, kind, expectedItemCalls) => {
    let n = 0;
    const f = fakeSpotify({ override: (r) => (r.path.endsWith('/items') ? fail(r, ++n) : undefined) });
    const out = await run(f, mkPlan(40));
    expect(out).toMatchObject({
      status: 'incomplete', url: 'https://open.spotify.com/playlist/PL1', playlistId: 'PL1',
      trackCount: 100, artistCount: 34, plannedTracks: 120,
    });
    expect(out.error.kind).toBe('incomplete');
    expect(out.error.cause).toBe(kind);
    expectIncompleteMessage(out);
    expect(f.adds()).toHaveLength(expectedItemCalls); // a rejected fetch is not retried
  });

  it('a 502 on an add batch resolves incomplete and that batch is requested exactly once', async () => {
    let n = 0;
    const f = fakeSpotify({ override: (r) => (r.path.endsWith('/items') && ++n === 2 ? json({}, 502) : undefined) });
    const out = await run(f, mkPlan(40));
    expect(out).toMatchObject({ status: 'incomplete', trackCount: 100, artistCount: 34 });
    expect(out.error).toMatchObject({ kind: 'incomplete', cause: 'http' });
    expectIncompleteMessage(out);
    expect(f.adds()).toHaveLength(2);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('a failure on the first batch resolves incomplete with zero tracks and the link', async () => {
    const f = fakeSpotify({ override: (r) => (r.path.endsWith('/items') ? json({}, 403) : undefined) });
    const out = await run(f, mkPlan(2));
    expect(out).toMatchObject({ status: 'incomplete', trackCount: 0, artistCount: 0, plannedTracks: 6, url: 'https://open.spotify.com/playlist/PL1' });
    expect(out.error).toMatchObject({ kind: 'incomplete', cause: 'forbidden' });
    expectIncompleteMessage(out);
  });
});

describe('releases route details', () => {
  it('reports quota, not lookup-failed, when one id fails plainly and the next id hits the quota', async () => {
    const f = fakeSpotify({
      search: () => [],
      override: (r) => {
        if (r.path === '/v1/artists/IDA1/albums') return json({}, 404);
        if (r.path === '/v1/artists/IDB2/albums') return QUOTA();
        return undefined;
      },
    });
    const plan = { artists: [{ n: 1, name: 'Dual', spotifyIds: ['IDA1', 'IDB2'] }], leftOut: [] };
    const out = await createPlaylist({ api: f.api, plan, year: 2027, now: NOW });
    expect(out.leftOut).toEqual([{ n: 1, name: 'Dual', reason: 'quota' }]);
    expect(out.releasesExhausted).toBe(true);
    expect(out.status).toBe('empty');
  });

  it('never puts an id that is not a Spotify id into a request, and still uses the good one', async () => {
    const f = fakeSpotify({
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: () => [],
    });
    const plan = { artists: [{ n: 1, name: 'Odd', spotifyIds: ['bad/../id', 'GoodId1'] }], leftOut: [] };
    f.searches; // no search results are needed: the fake returns nothing for this name
    await lookupTracks(f.api, plan);
    expect(f.calls.some((c) => c.url.includes('bad'))).toBe(false);
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/GoodId1/albums']);
  });
});

describe('lookupTracks', () => {
  it('keeps plan order, one entry per artist, whatever order lookups finish in', async () => {
    const f = fakeSpotify({ search: (name) => (name === 'Artist 1' ? [] : own(`ART${name.slice(7)}`)) });
    const found = await lookupTracks(f.api, mkPlan(4), { concurrency: 4 });
    expect(found.artists.map((a) => a.n)).toEqual([1, 2, 3, 4]);
    expect(found.artists[1].tracks).toEqual([]);
    expect(found.artists[0].tracks).toHaveLength(3);
    expect(found.artists[0]).toMatchObject({ searched: true, newestIds: [] });
  });

  it('bounds the number of lookups in flight, and uses more than one for a large plan', async () => {
    const f = fakeSpotify();
    await lookupTracks(f.api, mkPlan(24), { concurrency: 3 });
    expect(f.peak).toBeLessThanOrEqual(3);
    expect(f.peak).toBeGreaterThan(1);
  });

  it('reports progress ending at done = total, then create, then add', async () => {
    const f = fakeSpotify();
    const events = [];
    await run(f, mkPlan(5), { onProgress: (p) => events.push(p) });
    const lookups = events.filter((e) => e.phase === 'lookup');
    expect(lookups).toHaveLength(5);
    expect(lookups.map((e) => e.done)).toEqual([1, 2, 3, 4, 5]);
    expect(lookups.at(-1)).toEqual({ phase: 'lookup', done: 5, total: 5 });
    const phases = events.map((e) => e.phase);
    expect(phases.indexOf('create')).toBe(5);
    expect(phases.filter((p) => p === 'create')).toHaveLength(1);
    expect(phases.slice(6)).toEqual(['add']);
    expect(events.at(-1)).toEqual({ phase: 'add', done: 15, total: 15 });
  });

  it('an empty plan makes no requests and is empty, with the plan\'s left-out list', async () => {
    const f = fakeSpotify();
    const left = [{ n: 7, name: 'Gone', reason: LEFT_OUT.UNVERIFIED }];
    const out = await run(f, { artists: [], leftOut: left });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'empty', url: null, playlistId: null, trackCount: 0, artistCount: 0, plannedTracks: 0, error: null });
    expect(out.leftOut).toEqual(left);
  });
});

describe('createPlaylist: search failing without a readable body (rejected fetch)', () => {
  const releasesFor = {
    albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
    albumTracks: (id) => own(id.slice(2), 3, 'r'),
  };
  const searchRejects = (r) => { if (r.path === '/v1/search') throw new TypeError('Failed to fetch'); };

  it('search rejects but the releases route answers: the route switches and the playlist is made', async () => {
    const f = fakeSpotify({ ...releasesFor, override: searchRejects });
    const out = await run(f, mkPlan(5), { concurrency: 1 });
    expect(f.searches()).toHaveLength(5); // one artist's five attempts; nobody searches afterwards
    expect(f.sleep).toHaveBeenCalledTimes(4);
    expect(out).toMatchObject({ status: 'created', trackCount: 15, searchExhausted: true, searchStopReason: 'network', leftOut: [] });
    expect(out.newestReleases).toHaveLength(5);
    expect(f.albumReqs()).toHaveLength(5);
  });

  it('any HTTP answer from the releases route proves the connection works, even an error answer', async () => {
    const f = fakeSpotify({
      ...releasesFor,
      override: (r) => (r.path === '/v1/artists/ART0/albums' ? json({}, 404) : searchRejects(r)),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.searchStopReason).toBe('network');
    expect(f.searches()).toHaveLength(5);
    expect(out.leftOut).toEqual([{ n: 1, name: 'Artist 0', reason: LEFT_OUT.LOOKUP_FAILED }]);
    expect(out.trackCount).toBe(6);
  });

  it('with concurrency 4 the switch happens after the first answered releases request', async () => {
    const f = fakeSpotify({ ...releasesFor, override: searchRejects });
    const out = await run(f, mkPlan(20), { concurrency: 4 });
    // Exactly the four first artists, five attempts each: the four workers start together and make all their attempts
    // before the first releases answer (a millisecond later) can stop search for the artists after them.
    expect(f.searches()).toHaveLength(4 * 5);
    expect(f.albumReqs()).toHaveLength(20);
    expect(out.searchStopReason).toBe('network');
    expect(out.trackCount).toBe(60);
  });

  it('everything rejecting is a real offline state: it rejects with kind network, creates nothing, starts nothing more', async () => {
    const f = fakeSpotify({ override: () => { throw new TypeError('offline'); } });
    const events = [];
    await expect(run(f, mkPlan(6), { concurrency: 1, onProgress: (p) => events.push(p) })).rejects.toMatchObject({ kind: 'network' });
    expect(f.searches()).toHaveLength(5);
    expect(f.albumReqs()).toHaveLength(5);
    expect(f.fetch).toHaveBeenCalledTimes(10);
    expect(f.posts()).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('offline with concurrency 4 gives no progress and no POST', async () => {
    const f = fakeSpotify({ override: () => { throw new TypeError('offline'); } });
    const events = [];
    await expect(run(f, mkPlan(8), { concurrency: 4, onProgress: (p) => events.push(p) })).rejects.toMatchObject({ kind: 'network' });
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([]);
    expect(f.posts()).toHaveLength(0);
  });

  it('a search that rejects for an artist with no releases request to make cannot prove the connection, so it is fatal', async () => {
    const f = fakeSpotify({ override: searchRejects });
    const plan = { artists: [{ n: 1, name: 'No ids', spotifyIds: [] }], leftOut: [] };
    await expect(lookupTracks(f.api, plan)).rejects.toMatchObject({ kind: 'network' });
  });

  it('a search that works followed by a rejecting releases request is still fatal as before', async () => {
    const f = fakeSpotify({ search: () => [], override: (r) => { if (/\/albums$/.test(r.path)) throw new TypeError('offline'); } });
    await expect(run(f, mkPlan(3), { concurrency: 1 })).rejects.toMatchObject({ kind: 'network' });
    expect(f.posts()).toHaveLength(0);
  });
});

describe('createPlaylist: a track shared by two lineup artists', () => {
  const SH = (order = ['ART0', 'ART1']) => trk('SH', 'Duet', ...order);
  const slow = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

  // Artist 0 has exactly three tracks, one of them the duet. Artist 1 lists the duet first (not listed-first: it is
  // second on the track) and then three songs of its own, so a plain "first three" would pick the duet.
  const searchTwo = (name) => (name === 'Artist 0'
    ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')]
    : [SH(), trk('b1', 'B One', 'X1', 'ART1'), trk('b2', 'B Two', 'X1', 'ART1'), trk('b3', 'B Three', 'X1', 'ART1')]);

  it('tops the later artist up from its remaining search results; the earlier artist keeps the shared track', async () => {
    const f = fakeSpotify({ search: searchTwo });
    const out = await run(f, mkPlan(2), { concurrency: 1 });
    expect(addedUris(f)).toEqual(['SH', 'a1', 'a2', 'b1', 'b2', 'b3'].map((x) => `spotify:track:${x}`));
    expect(out).toMatchObject({ status: 'created', trackCount: 6, artistCount: 2, leftOut: [], newestReleases: [] });
    expect(f.albumReqs()).toHaveLength(0); // no extra request for the top-up
    expect(f.searches()).toHaveLength(2);
  });

  it('gives the same result when the earlier artist\'s answers arrive last', async () => {
    const plain = fakeSpotify({ search: searchTwo });
    const a = await lookupTracks(plain.api, mkPlan(2), { concurrency: 2 });
    const delayed = fakeSpotify({
      search: searchTwo,
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === 'artist:"Artist 0"'
        ? slow(30, json({ tracks: { items: searchTwo('Artist 0') } }))
        : undefined),
    });
    const b = await lookupTracks(delayed.api, mkPlan(2), { concurrency: 2 });
    expect(b).toEqual(a);
    expect(b.artists[0].tracks.map((t) => t.id)).toEqual(['SH', 'a1', 'a2']);
    expect(b.artists[1].tracks.map((t) => t.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('when search has nothing more, tops the later artist up from newest releases, skipping taken tracks', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] : [SH(), trk('b1', 'B One', 'X1', 'ART1'), trk('b2', 'B Two', 'X1', 'ART1')]),
      albums: (id) => (id === 'ART1' ? [{ id: 'ALB1', name: 'A', release_date: '2024-01-01' }] : []),
      albumTracks: () => [SH(), trk('r1', 'Rel One', 'ART1')],
    });
    const out = await run(f, mkPlan(2), { concurrency: 2 });
    expect(addedUris(f)).toEqual(['SH', 'a1', 'a2', 'b1', 'b2', 'r1'].map((x) => `spotify:track:${x}`));
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/ART1/albums']);
    expect(out.newestReleases).toEqual([{ n: 2, name: 'Artist 1', searched: true }]);
    expect(out.leftOut).toEqual([]);
    expect(out.trackCount).toBe(6);
  });

  it('keeps reading releases when the newest one only holds a track that is already taken', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] : [SH(), trk('b1', 'B One', 'X1', 'ART1'), trk('b2', 'B Two', 'X1', 'ART1')]),
      albums: (id) => (id === 'ART1' ? [{ id: 'NEW', name: 'N', release_date: '2025-01-01' }, { id: 'OLD', name: 'O', release_date: '2020-01-01' }] : []),
      albumTracks: (id) => (id === 'NEW' ? [SH()] : [trk('r1', 'Rel One', 'ART1')]),
    });
    const found = await lookupTracks(f.api, mkPlan(2), { concurrency: 1 });
    expect(f.trackReqs().map((c) => c.path)).toEqual(['/v1/albums/NEW/tracks', '/v1/albums/OLD/tracks']);
    expect(found.artists[1].tracks.map((t) => t.id)).toEqual(['b1', 'b2', 'r1']);
  });

  it('the releases result is the same when the earlier artist\'s search arrives last', async () => {
    const make = (delay) => fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] : [SH(), trk('b1', 'B One', 'X1', 'ART1'), trk('b2', 'B Two', 'X1', 'ART1')]),
      albums: (id) => (id === 'ART1' ? [{ id: 'ALB1', name: 'A', release_date: '2024-01-01' }] : []),
      albumTracks: () => [SH(), trk('r1', 'Rel One', 'ART1')],
      override: delay ? (r) => (r.path === '/v1/search' && r.params.get('q') === 'artist:"Artist 0"'
        ? slow(30, json({ tracks: { items: [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] } }))
        : undefined) : undefined,
    });
    const a = await lookupTracks(make(false).api, mkPlan(2), { concurrency: 2 });
    const f = make(true);
    const b = await lookupTracks(f.api, mkPlan(2), { concurrency: 2 });
    expect(b).toEqual(a);
    expect(b.artists[1].tracks.map((t) => t.id)).toEqual(['b1', 'b2', 'r1']);
    expect(b.artists[1].newestIds).toEqual(['r1']);
  });

  it('an artist that only ever has the shared track keeps counting as included, and a release track is not asked for twice', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] : [SH()]),
      albums: () => [],
    });
    const out = await run(f, mkPlan(2), { concurrency: 2 });
    expect(out.leftOut).toEqual([]);
    expect(out.artistCount).toBe(2);
    expect(out.trackCount).toBe(3);
    expect(out.newestReleases).toEqual([]);
  });

  it('an artist with no own track at all is still left out as no-tracks, one with fewer than three is not', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 1' ? own('OTHER9') : name === 'Artist 2' ? own('ART2', 1) : own('ART0')),
    });
    const out = await run(f, mkPlan(3), { concurrency: 3 });
    expect(out.leftOut).toEqual([{ n: 2, name: 'Artist 1', reason: LEFT_OUT.NO_TRACKS }]);
    expect(out.trackCount).toBe(4);
  });

  it('the quota switch part-way through the searches still works with shared tracks', async () => {
    let n = 0;
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0' ? [SH(), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')] : []),
      albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
      albumTracks: (id) => (id === 'ALART1' ? [SH(), trk('r1', 'R1', 'ART1'), trk('r2', 'R2', 'ART1'), trk('r3', 'R3', 'ART1')] : own(id.slice(2), 3, 'r')),
      override: (r) => (r.path === '/v1/search' && ++n > 1 ? QUOTA() : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.searchStopReason).toBe('quota');
    expect(f.searches()).toHaveLength(2);
    expect(addedUris(f)).toEqual(['SH', 'a1', 'a2', 'r1', 'r2', 'r3', 'ART2r0', 'ART2r1', 'ART2r2'].map((x) => `spotify:track:${x}`));
    expect(out.leftOut).toEqual([]);
  });

  it('progress is monotonic, ends at total, and nothing follows a rejection', async () => {
    const f = fakeSpotify({ search: searchTwo });
    const events = [];
    await run(f, mkPlan(2), { onProgress: (p) => events.push(p) });
    const dones = events.filter((e) => e.phase === 'lookup').map((e) => e.done);
    expect(dones).toEqual([1, 2]);

    const g = fakeSpotify({ search: (name) => (name === 'Artist 0' ? own('ART0', 1) : own('ART1')), override: (r) => (/\/albums$/.test(r.path) ? json({}, 401) : undefined) });
    const ev = [];
    await expect(run(g, mkPlan(2), { concurrency: 1, onProgress: (p) => ev.push(p) })).rejects.toMatchObject({ kind: 'auth' });
    expect(ev.every((e) => e.phase === 'lookup')).toBe(true);
    expect(g.posts()).toHaveLength(0);
  });
});

describe('createPlaylist: request counts in the ordinary case', () => {
  it('artists with three own search results cost exactly one request each', async () => {
    const f = fakeSpotify();
    await run(f, mkPlan(6), { concurrency: 4 });
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(6);
    expect(f.searches()).toHaveLength(6);
  });

  it('an artist with two songs costs a search, one albums request and the tracks of one release', async () => {
    const f = fakeSpotify({
      search: () => own('ART0', 2),
      albums: () => [{ id: 'AL0', name: 'A', release_date: '2024-01-01' }],
      albumTracks: () => [],
    });
    await run(f, mkPlan(1));
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(3);
  });

  it('sharing a track costs no request when the later artist has other own search results', async () => {
    const f = fakeSpotify({
      search: (name) => (name === 'Artist 0'
        ? [trk('SH', 'Duet', 'ART0', 'ART1'), trk('a1', 'A One', 'ART0'), trk('a2', 'A Two', 'ART0')]
        : [trk('SH', 'Duet', 'ART0', 'ART1'), trk('b1', 'B One', 'X1', 'ART1'), trk('b2', 'B Two', 'X1', 'ART1'), trk('b3', 'B Three', 'X1', 'ART1')]),
    });
    await run(f, mkPlan(2));
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const laterReject = (ms) => new Promise((_, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), ms));
const releasesFor2 = {
  albums: (id) => [{ id: `AL${id}`, name: 'A', release_date: '2024-01-01' }],
  albumTracks: (id) => own(id.slice(2), 3, 'r'),
};

describe('network probe: run-wide evidence that Spotify answers', () => {
  const searchOf = (n) => `artist:"Artist ${n}"`;

  it('a search that fails while another request is answered does not make the run offline, even if the releases route is used up', async () => {
    // Artist 0: search 500 (five answers), then its albums request is the quota: the releases route is used up.
    // Artist 1: its search only rejects, slowly, so those answers arrive while it is failing.
    const f = fakeSpotify({
      override: (r) => {
        if (r.path === '/v1/search' && r.params.get('q') === searchOf(0)) return json({}, 500);
        if (r.path === '/v1/search' && r.params.get('q') === searchOf(1)) return laterReject(10);
        if (/\/albums$/.test(r.path)) return QUOTA();
        return undefined;
      },
    });
    const events = [];
    const found = await lookupTracks(f.api, mkPlan(2), { concurrency: 2, onProgress: (e) => events.push(e) });
    expect(found.searchStopReason).toBe('network');
    expect(found.releasesExhausted).toBe(true);
    expect(found.releasesStopReason).toBe('quota');
    expect(found.incomplete).toEqual([1, 2]);
    expect(f.albumReqs()).toHaveLength(1); // artist 1 made no request on the used-up route
    expect(events).toHaveLength(2);
  });

  it('the same when the failing artist has no valid Spotify id (no probe request can be made)', async () => {
    const f = fakeSpotify({
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === searchOf(1) ? laterReject(10) : undefined),
    });
    const plan = { artists: [{ n: 1, name: 'Artist 0', spotifyIds: ['ART0'] }, { n: 2, name: 'Artist 1', spotifyIds: ['bad/id'] }], leftOut: [] };
    const found = await lookupTracks(f.api, plan, { concurrency: 2 });
    expect(found.searchStopReason).toBe('network');
    expect(found.artists[0].searched).toBe(true);
    expect(found.artists[1].tracks).toEqual([]);
    expect(f.albumReqs()).toHaveLength(0);
  });

  it('with the evidence the failing artist carries on by the normal route and is served from it', async () => {
    const f = fakeSpotify({
      ...releasesFor2,
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === searchOf(1) ? laterReject(10) : undefined),
    });
    const found = await lookupTracks(f.api, mkPlan(2), { concurrency: 2 });
    expect(found.searchStopReason).toBe('network');
    expect(found.artists[1].tracks).toHaveLength(3);
    expect(found.artists[1].newestIds).toHaveLength(3);
  });

  it('answers that arrived before the failing search began are not evidence: offline part-way through rejects (concurrency 1)', async () => {
    const f = fakeSpotify({
      override: (r) => {
        if (r.path === '/v1/search' && r.params.get('q') === searchOf(0)) return undefined; // answered
        throw new TypeError('offline');
      },
    });
    const events = [];
    await expect(run(f, mkPlan(4), { concurrency: 1, onProgress: (p) => events.push(p) })).rejects.toMatchObject({ kind: 'network' });
    expect(f.searches()).toHaveLength(1 + 5);
    expect(f.albumReqs()).toHaveLength(5);
    expect(f.posts()).toHaveLength(0);
    await wait(30);
    expect(events).toEqual([{ phase: 'lookup', done: 1, total: 4 }]); // only the artist answered before the drop
  });

  it('earlier answers do not count either when the releases route is used up and the search then fails (concurrency 1)', async () => {
    const f = fakeSpotify({
      override: (r) => {
        if (r.path === '/v1/search' && r.params.get('q') === searchOf(0)) return json({}, 500);
        if (/\/albums$/.test(r.path)) return QUOTA();
        if (r.path === '/v1/search') throw new TypeError('offline');
        return undefined;
      },
    });
    const events = [];
    await expect(lookupTracks(f.api, mkPlan(3), { concurrency: 1, onProgress: (e) => events.push(e) })).rejects.toMatchObject({ kind: 'network' });
    expect(f.albumReqs()).toHaveLength(1); // artist 1 could not even probe
    await wait(30);
    expect(events).toHaveLength(1);
  });

  it('offline from the start with concurrency 4: one rejection, no progress, no create request, nothing started late', async () => {
    const f = fakeSpotify({ override: () => { throw new TypeError('offline'); } });
    const events = [];
    await expect(run(f, mkPlan(8), { concurrency: 4, onProgress: (p) => events.push(p) })).rejects.toMatchObject({ kind: 'network' });
    const after = f.fetch.mock.calls.length;
    await wait(40);
    expect(f.fetch.mock.calls.length).toBe(after);
    expect(events).toEqual([]);
    expect(f.posts()).toHaveLength(0);
  });
});

describe('releases route stops on a surviving 429', () => {
  const quotaSearch = (r) => (r.path === '/v1/search' ? QUOTA() : undefined);
  const hot = () => json({}, 429, { 'Retry-After': '120' });

  it('every albums request answering 429 costs five fetches in all, not five per artist', async () => {
    const f = fakeSpotify({ override: (r) => quotaSearch(r) ?? (/\/albums$/.test(r.path) ? hot() : undefined) });
    const out = await run(f, mkPlan(20), { concurrency: 1 });
    expect(f.fetch).toHaveBeenCalledTimes(1 + 5); // one search, one artist's five albums attempts
    expect(f.sleep).toHaveBeenCalledTimes(4);
    expect(out).toMatchObject({ status: 'empty', searchStopReason: 'quota', releasesExhausted: true, releasesStopReason: 'rate' });
    expect(out.leftOut.map((l) => l.reason)).toEqual(Array(20).fill(LEFT_OUT.QUOTA));
  });

  it('a 429 on the tracks of a release stops the route too, and the quota reason is kept when it comes first', async () => {
    const f = fakeSpotify({
      ...releasesFor2,
      override: (r) => quotaSearch(r) ?? (/^\/v1\/albums\/[^/]+\/tracks$/.test(r.path) ? hot() : undefined),
    });
    const out = await run(f, mkPlan(4), { concurrency: 1 });
    expect(f.albumReqs()).toHaveLength(1);
    expect(f.trackReqs()).toHaveLength(5);
    expect(out.releasesStopReason).toBe('rate');
    expect(out.releasesExhausted).toBe(true);
    expect(out.status).toBe('empty');
  });

  it('the first stop reason of the releases route is kept', async () => {
    let n = 0;
    const f = fakeSpotify({
      ...releasesFor2,
      override: (r) => {
        if (r.path === '/v1/search') return QUOTA();
        if (/\/albums$/.test(r.path)) return ++n === 1 ? QUOTA() : hot();
        return undefined;
      },
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(out.releasesStopReason).toBe('quota');
  });
});

describe('search stops after consecutive server errors', () => {
  it('twenty artists whose search answers 503 cost 15 search fetches, then use the releases route', async () => {
    const f = fakeSpotify({ ...releasesFor2, override: (r) => (r.path === '/v1/search' ? json({}, 503) : undefined) });
    const out = await run(f, mkPlan(20), { concurrency: 1 });
    expect(f.searches()).toHaveLength(SEARCH_ERROR_LIMIT * 5);
    expect(SEARCH_ERROR_LIMIT).toBe(3);
    expect(out).toMatchObject({ status: 'created', trackCount: 60, searchExhausted: true, searchStopReason: 'errors', leftOut: [] });
    expect(f.albumReqs()).toHaveLength(20);
  });

  it('a search that works resets the count', async () => {
    const bad = new Set(['Artist 0', 'Artist 1', 'Artist 3', 'Artist 4', 'Artist 6', 'Artist 7']);
    const f = fakeSpotify({
      ...releasesFor2,
      override: (r) => (r.path === '/v1/search' && bad.has(/artist:"(.*)"/.exec(r.params.get('q'))[1]) ? json({}, 500) : undefined),
    });
    const out = await run(f, mkPlan(9), { concurrency: 1 });
    expect(out.searchStopReason).toBeNull();
    expect(f.searches()).toHaveLength(6 * 5 + 3);
    expect(out.trackCount).toBe(27);
  });

  it('three unreadable 200 answers in a row stop search too', async () => {
    const junk = { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    const f = fakeSpotify({ ...releasesFor2, override: (r) => (r.path === '/v1/search' ? junk : undefined) });
    const out = await run(f, mkPlan(6), { concurrency: 1 });
    expect(f.searches()).toHaveLength(SEARCH_ERROR_LIMIT);
    expect(out.searchStopReason).toBe('errors');
    expect(out.trackCount).toBe(18);
  });

  it('with several in flight the count follows the order searches finish: four failing at once stop search after exactly their own requests', async () => {
    const f = fakeSpotify({ ...releasesFor2, override: (r) => (r.path === '/v1/search' ? json({}, 503) : undefined) });
    const out = await run(f, mkPlan(20), { concurrency: 4 });
    expect(f.searches()).toHaveLength(4 * 5); // all four were in flight when the third failure was counted
    expect(out.searchStopReason).toBe('errors');
    expect(out.trackCount).toBe(60);
  });

  it('a stop reason already set is kept', async () => {
    let n = 0;
    const f = fakeSpotify({ ...releasesFor2, override: (r) => (r.path === '/v1/search' ? (++n === 1 ? QUOTA() : json({}, 503)) : undefined) });
    const out = await run(f, mkPlan(5), { concurrency: 1 });
    expect(out.searchStopReason).toBe('quota');
    expect(f.searches()).toHaveLength(1);
  });
});

describe('a throwing onProgress does not break the engine', () => {
  it('during lookup: the result is the same, every worker finishes, and the playlist is made', async () => {
    const f = fakeSpotify();
    let calls = 0;
    const out = await run(f, mkPlan(8), { concurrency: 4, onProgress: () => { calls++; throw new Error('display broke'); } });
    expect(out).toMatchObject({ status: 'created', trackCount: 24, artistCount: 8 });
    expect(calls).toBe(8 + 1 + 1); // 8 lookup events, create, one add
    expect(f.searches()).toHaveLength(8);
  });

  it('during the add step: every batch is still added and the status is created', async () => {
    const f = fakeSpotify();
    const out = await run(f, mkPlan(40), { onProgress: (p) => { if (p.phase === 'add') throw new Error('display broke'); } });
    expect(f.adds().map((c) => c.body.uris.length)).toEqual([ADD_BATCH_SIZE, 20]);
    expect(out).toMatchObject({ status: 'created', trackCount: 120, error: null });
  });

  it('on the create event too, and a callback that is not a function is ignored', async () => {
    const f = fakeSpotify();
    const out = await run(f, mkPlan(2), { onProgress: (p) => { if (p.phase === 'create') throw new Error('x'); } });
    expect(out.status).toBe('created');
    const g = fakeSpotify();
    expect((await run(g, mkPlan(2), { onProgress: 5 })).status).toBe('created');
  });
});

describe('after a fatal error nothing new starts', () => {
  // Every search is refused with the quota, so each artist goes to the releases route in step 1.
  const base = (extra) => fakeSpotify({
    search: () => [],
    ...extra,
    override: (r) => (r.path === '/v1/search' ? QUOTA() : extra.override(r)),
  });

  it('a worker in the releases route starts no request for its next Spotify id once another worker failed', async () => {
    const f = base({
      albums: () => [],
      override: (r) => {
        if (r.path === '/v1/artists/ART0/albums') return json({}, 401);
        if (/\/albums$/.test(r.path)) return later(30, json({ items: [] }));
        return undefined;
      },
    });
    const plan = { artists: [
      { n: 1, name: 'Artist 0', spotifyIds: ['ART0'] },
      { n: 2, name: 'Artist 1', spotifyIds: ['ART1', 'ART1b', 'ART1c'] },
    ], leftOut: [] };
    const events = [];
    await expect(lookupTracks(f.api, plan, { concurrency: 2, onProgress: (e) => events.push(e) })).rejects.toMatchObject({ kind: 'auth' });
    await wait(120);
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/ART0/albums', '/v1/artists/ART1/albums']);
    expect(events).toEqual([]); // the worker that was in flight reports nothing either
  });

  it('a worker in the releases route starts no request for the next release once another worker failed', async () => {
    const f = base({
      albums: (id) => (id === 'ART0' ? [] : [{ id: 'N1', release_date: '2025-01-01' }, { id: 'N2', release_date: '2024-01-01' }, { id: 'N3', release_date: '2023-01-01' }]),
      override: (r) => {
        if (r.path === '/v1/artists/ART0/albums') return later(20, json({}, 401)); // fails while artist 1's first tracks request is out
        if (/^\/v1\/albums\/[^/]+\/tracks$/.test(r.path)) return later(40, json({ items: [] }));
        return undefined;
      },
    });
    await expect(lookupTracks(f.api, mkPlan(2), { concurrency: 2 })).rejects.toMatchObject({ kind: 'auth' });
    await wait(120);
    expect(f.trackReqs().map((c) => c.path)).toEqual(['/v1/albums/N1/tracks']);
  });

  it('no top-up request starts after a fatal error', async () => {
    // Step 1: every search works but finds one track. Step 2: five artists need a top-up; the first one fails fatally.
    const f = fakeSpotify({
      search: (name) => [trk(`s${name.slice(7)}`, `One ${name}`, `ART${name.slice(7)}`)],
      albums: (id) => [{ id: `AL${id}`, release_date: '2024-01-01' }],
      albumTracks: () => [],
      override: (r) => (r.path === '/v1/artists/ART0/albums' ? json({}, 401) : undefined),
    });
    await expect(lookupTracks(f.api, mkPlan(5), { concurrency: 1 })).rejects.toMatchObject({ kind: 'auth' });
    expect(f.albumReqs().map((c) => c.path)).toEqual(['/v1/artists/ART0/albums']);
  });

  it('two workers failing at once with different fatal kinds give one rejection, from the first', async () => {
    const f = fakeSpotify({
      override: (r) => {
        if (r.path !== '/v1/search') return undefined;
        return r.params.get('q') === 'artist:"Artist 0"' ? json({}, 401) : json({}, 403);
      },
    });
    const events = [];
    const results = await Promise.allSettled([lookupTracks(f.api, mkPlan(6), { concurrency: 2, onProgress: (e) => events.push(e) })]);
    expect(results[0].status).toBe('rejected');
    expect(results[0].reason.kind).toBe('auth');
    await wait(30);
    expect(f.searches()).toHaveLength(2);
    expect(events).toEqual([]);
  });
});

describe('top-up selection', () => {
  it('an artist that already ran the releases route in step 1 is not asked for its albums again', async () => {
    const f = fakeSpotify({
      override: (r) => (r.path === '/v1/search' ? QUOTA() : undefined),
      albums: () => [{ id: 'AL0', name: 'A', release_date: '2024-01-01' }],
      albumTracks: () => own('ART0', 2, 'r'), // only two: still short of three after the route
    });
    const found = await lookupTracks(f.api, mkPlan(1), { concurrency: 1 });
    expect(found.artists[0].tracks).toHaveLength(2);
    expect(f.albumReqs()).toHaveLength(1);
    expect(f.trackReqs()).toHaveLength(1);
  });
});

describe('search that works after the switch', () => {
  it('a slow search answered after another artist switched search off is used, and is not searched again', async () => {
    const f = fakeSpotify({
      ...releasesFor2,
      override: (r) => {
        if (r.path !== '/v1/search') return undefined;
        const q = r.params.get('q');
        if (q === 'artist:"Artist 0"') return QUOTA();
        if (q === 'artist:"Artist 1"') return later(40, json({ tracks: { items: own('ART1', 3, 's') } }));
        return undefined;
      },
    });
    const found = await lookupTracks(f.api, mkPlan(4), { concurrency: 2 });
    expect(found.searchStopReason).toBe('quota');
    expect(f.searches()).toHaveLength(2); // Artist 0 and the slow Artist 1; nobody else
    expect(found.artists[1].searched).toBe(true);
    expect(found.artists[1].tracks.map((t) => t.id)).toEqual([0, 1, 2].map((k) => `ART1s${k}`));
    expect(found.artists[1].newestIds).toEqual([]);
    expect(f.albumReqs().map((c) => c.path)).not.toContain('/v1/artists/ART1/albums');
    expect(found.artists.map((a) => a.tracks.length)).toEqual([3, 3, 3, 3]);
  });
});

describe('error shapes never read like a rejection', () => {
  it('unconfirmed and incomplete carry their own kind, keep the cause apart, and never say try again', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json({}, 500) : undefined) });
    const u = await run(f, mkPlan(2));
    expect(u.error).toMatchObject({ kind: 'unconfirmed', cause: 'http' });
    expect(u.error.message.toLowerCase()).not.toContain('try again');
    const g = fakeSpotify({ override: (r) => { if (r.path.endsWith('/items')) throw new TypeError('offline'); } });
    const i = await run(g, mkPlan(2));
    expect(i.status).toBe('incomplete');
    expect(i.error).toMatchObject({ kind: 'incomplete', cause: 'network' });
    expect(i.error.message.toLowerCase()).not.toContain('try again');
    expect(i.error.message.toLowerCase()).not.toContain('connection');
  });
});
