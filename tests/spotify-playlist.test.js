import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../src/sources/spotify.js';
import { createPlaylist, lookupTracks } from '../src/sources/spotify-playlist.js';
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
      searchExhausted: false, releasesExhausted: false, error: null,
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

  it('a plain 429 on one artist\'s search fails only that artist; later artists are still searched', async () => {
    const f = fakeSpotify({
      ...releasesFor,
      override: (r) => (r.path === '/v1/search' && r.params.get('q') === 'artist:"Artist 0"' ? json({}, 429) : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(f.searches()).toHaveLength(5 + 2); // five attempts for artist 0, then one each for the others
    expect(out.searchExhausted).toBe(false);
    expect(out.releasesExhausted).toBe(false);
    expect(out.status).toBe('created');
    expect(out.trackCount).toBe(9);
    expect(out.newestReleases).toEqual([{ n: 1, name: 'Artist 0', searched: false }]);
  });

  it('a plain 429 on one artist\'s albums fails only that artist; later artists\' releases are still read', async () => {
    const f = fakeSpotify({
      ...releasesFor,
      search: () => [],
      override: (r) => (r.path === '/v1/artists/ART0/albums' ? json({}, 429) : undefined),
    });
    const out = await run(f, mkPlan(3), { concurrency: 1 });
    expect(f.albumReqs().map((c) => c.path)).toEqual([...Array(5).fill('/v1/artists/ART0/albums'), '/v1/artists/ART1/albums', '/v1/artists/ART2/albums']);
    expect(out.releasesExhausted).toBe(false);
    expect(out.searchExhausted).toBe(false);
    expect(out.trackCount).toBe(6);
    expect(out.leftOut).toEqual([{ n: 1, name: 'Artist 0', reason: LEFT_OUT.LOOKUP_FAILED }]);
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

  it('a network failure on POST me/playlists rejects, is not retried, and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => { if (r.path === '/v1/me/playlists') throw new TypeError('offline'); } });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'network' });
    expect(f.posts()).toHaveLength(1);
    expect(f.adds()).toHaveLength(0);
  });

  it('a 502 on POST me/playlists rejects with kind http after one create request and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json({}, 502) : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'http' });
    expect(f.posts()).toHaveLength(1);
    expect(f.adds()).toHaveLength(0);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('a QUOTA_EXCEEDED 429 on POST me/playlists rejects with kind quota at once and adds nothing', async () => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? QUOTA() : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'quota' });
    expect(f.posts()).toHaveLength(1);
    expect(f.adds()).toHaveLength(0);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['no id', {}],
    ['an id with odd characters', { id: '../evil' }],
    ['a non-string id', { id: 5 }],
  ])('a create response with %s rejects with kind http', async (_n, body) => {
    const f = fakeSpotify({ override: (r) => (r.path === '/v1/me/playlists' ? json(body, 201) : undefined) });
    await expect(run(f, mkPlan(2))).rejects.toMatchObject({ kind: 'http' });
    expect(f.adds()).toHaveLength(0);
  });
});

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
    expect(out.error.kind).toBe(kind);
    expect(typeof out.error.message).toBe('string');
    expect(f.adds()).toHaveLength(expectedItemCalls); // a rejected fetch is not retried
  });

  it('a 502 on an add batch resolves incomplete and that batch is requested exactly once', async () => {
    let n = 0;
    const f = fakeSpotify({ override: (r) => (r.path.endsWith('/items') && ++n === 2 ? json({}, 502) : undefined) });
    const out = await run(f, mkPlan(40));
    expect(out).toMatchObject({ status: 'incomplete', trackCount: 100, artistCount: 34 });
    expect(out.error.kind).toBe('http');
    expect(f.adds()).toHaveLength(2);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it('a failure on the first batch resolves incomplete with zero tracks and the link', async () => {
    const f = fakeSpotify({ override: (r) => (r.path.endsWith('/items') ? json({}, 403) : undefined) });
    const out = await run(f, mkPlan(2));
    expect(out).toMatchObject({ status: 'incomplete', trackCount: 0, artistCount: 0, plannedTracks: 6, url: 'https://open.spotify.com/playlist/PL1' });
    expect(out.error.kind).toBe('forbidden');
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
