import { describe, it, expect } from 'vitest';
import {
  apiClassify,
  apiUrl,
  buildSchedule,
  fetchDionysus,
  numberByApiId,
  parseEvents,
  parsePerformers,
  parseTagTitles,
  parseVenues,
  scheduleSummary,
} from '../scripts/lib/dionysus.js';
import { parsePerformer, parseSocialLinks } from '../scripts/lib/festival.js';
import { ApiError, createClient } from '../scripts/lib/http.js';
import { buildOutputs } from '../scripts/lib/build.js';

const ID = '6hhmxPotJ2kCsQjUGPtH14';
const MUSIC = { id: 't1', title: 'Music' };
const COMEDY = { id: 't2', title: 'Comedyfort' };
const perf = (i, extra = {}) => ({
  id: `p${i}`,
  name: `Band ${i}`,
  status: 'published',
  tags: [MUSIC],
  hometown: 'Boise, ID',
  socialLinks: [{ name: 'Spotify', url: `https://open.spotify.com/artist/${ID}?si=x` }],
  bio: 'a long biography that must never be stored',
  thumbnailImageUrl: 'https://img.example/x.jpg',
  trackInfo: { previewUrl: 'https://p.scdn.co/x' },
  version: { seconds: 1, nanoseconds: 2 },
  ...extra,
});
const many = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => perf(i, extra(i)));
const api = { baseUrl: 'https://api.example/v1/', festivalId: 'F 1', musicTags: ['Music'] };

describe('apiUrl / apiClassify', () => {
  it('builds one URL per endpoint and encodes the festival id', () => {
    expect(apiUrl(api, 'performers')).toBe('https://api.example/v1/festivals/F%201/performers');
  });
  it('200 is final, 5xx and non-JSON retry, 4xx fail', () => {
    expect(apiClassify(200, [])).toBe('ok');
    expect(apiClassify(200, null)).toBe('retry');
    expect(apiClassify(502, {})).toBe('retry');
    expect(apiClassify(404, {})).toBe('fail');
  });
});

describe('parsePerformers', () => {
  it('rejects anything that is not an array', () => {
    for (const bad of [null, {}, 'x', 5, { performers: [] }]) expect(parsePerformers(bad).ok).toBe(false);
  });
  it('includes published music performers and keeps only the allowed fields', () => {
    const r = parsePerformers([
      perf(1, {
        socialLinks: [
          { name: 'Spotify', url: `https://open.spotify.com/artist/${ID}` },
          { name: 'Apple Music', url: 'https://music.apple.com/us/artist/x/12345' },
          { name: 'Twitter', url: 'https://twitter.com/x' },
        ],
      }),
    ]);
    expect(r.included).toEqual([
      {
        apiId: 'p1',
        name: 'Band 1',
        festival: {
          id: 'p1',
          hometown: 'Boise, ID',
          spotify: { kind: 'artist', id: ID },
          links: { appleMusic: 'https://music.apple.com/us/artist/x/12345', x: 'https://twitter.com/x' },
        },
      },
    ]);
    expect(JSON.stringify(r.included)).not.toMatch(/biography|img\.example|scdn|seconds/);
  });
  it('excludes other statuses (counted) and a missing status', () => {
    const r = parsePerformers([perf(1), perf(2, { status: 'staged' }), perf(3, { status: 'staged' }), perf(4, { status: 'deleted' }), perf(5, { status: undefined })]);
    expect(r.included.map((p) => p.apiId)).toEqual(['p1']);
    expect(r.excluded.byStatus).toEqual({ deleted: 1, missing: 1, staged: 2 });
  });
  it('excludes by tag, listing names; no tags means included; any music tag among several is enough', () => {
    const r = parsePerformers([
      perf(1, { tags: [COMEDY], name: 'Funny Person' }),
      perf(2, { tags: [] }),
      perf(3, { tags: undefined }),
      perf(4, { tags: [COMEDY, { id: 'x', title: 'music' }] }),
      perf(5, { tags: [COMEDY, { id: 'y', title: 'Kidfort' }] }),
    ]);
    expect(r.included.map((p) => p.apiId)).toEqual(['p2', 'p3', 'p4']);
    expect(r.excluded.byTag).toEqual([
      { name: 'Band 5', tags: ['Comedyfort', 'Kidfort'] },
      { name: 'Funny Person', tags: ['Comedyfort'] },
    ]);
    expect(r.excludedIds.has('p1')).toBe(true);
  });
  it('musicTags is configurable', () => {
    const r = parsePerformers([perf(1, { tags: [COMEDY] }), perf(2)], { musicTags: ['Comedyfort', 'Music'] });
    expect(r.included).toHaveLength(2);
    expect(parsePerformers([perf(1, { tags: [COMEDY] })], { musicTags: ['Comedyfort'] }).included).toHaveLength(1);
  });
  it('skips entries with no id or name and counts them', () => {
    const r = parsePerformers([perf(1), null, 'x', { id: 'a' }, { name: 'b' }, { id: '', name: 'c' }]);
    expect(r.included).toHaveLength(1);
    expect(r.excluded.invalid).toBe(5);
  });
  it('is sorted by name then id whatever the API order, and drops same-name duplicates', () => {
    const a = parsePerformers([perf(2, { name: 'Zed' }), perf(1, { name: 'Alpha' }), perf(9, { name: 'the foo & bar' }), perf(3, { name: 'The Foo and Bar' })]);
    const b = parsePerformers([perf(3, { name: 'The Foo and Bar' }), perf(9, { name: 'the foo & bar' }), perf(1, { name: 'Alpha' }), perf(2, { name: 'Zed' })]);
    expect(a.included).toEqual(b.included);
    expect(a.included.map((p) => p.name)).toEqual(['Alpha', 'The Foo and Bar', 'Zed']);
    expect(a.duplicates).toEqual(['the foo & bar']);
  });
  it('does not store volatile fields: the same answer with a new version parses identically', () => {
    const a = parsePerformers([perf(1)]);
    const b = parsePerformers([perf(1, { version: { seconds: 99, nanoseconds: 7 }, bio: 'changed' })]);
    expect(b.included).toEqual(a.included);
  });
  it('tolerates bad field types', () => {
    const r = parsePerformers([perf(1, { hometown: 5, socialLinks: 'x', tags: 'x' }), perf(2, { socialLinks: [null, { name: 5, url: 'x' }, { name: 'Spotify' }] })]);
    expect(r.included).toHaveLength(2);
    expect(r.included[0].festival).toEqual({ id: 'p1', links: {} });
  });
});

describe('API and feed give the same record shape', () => {
  it('the same links parse to the same festival fields', () => {
    const links = [
      ['Spotify', `https://open.spotify.com/artist/${ID}?si=1`],
      ['Apple Music', 'https://music.apple.com/us/artist/x/12345'],
      ['Bandcamp', 'https://x.bandcamp.com/'],
      ['YouTube', 'https://www.youtube.com/@x'],
      ['SoundCloud', 'https://soundcloud.com/x'],
      ['Instagram', 'https://www.instagram.com/x/'],
      ['Twitter', 'https://twitter.com/x'],
      ['Website', 'https://x.example/'],
    ];
    const fromApi = parsePerformers([perf(1, { socialLinks: links.map(([name, url]) => ({ name, url })) })]).included[0].festival;
    const fromFeed = parsePerformer({ found: true, hometown: 'Boise, ID', social: links.map(([type, url]) => ({ type: type === 'Twitter' ? 'x' : type, url })) }, 's', '2026-11-13').festival;
    const { id, ...api1 } = fromApi;
    const { slug, fetched, ...feed1 } = fromFeed;
    expect(id).toBe('p1');
    expect(slug).toBe('s');
    expect(fetched).toBe('2026-11-13');
    expect(api1).toEqual(feed1);
  });
  it('parseSocialLinks: Spotify order artist, album, other; allow-list enforced', () => {
    const r = parseSocialLinks(
      [
        { name: 'Spotify', url: 'https://open.spotify.com/user/u' },
        { name: 'Spotify', url: `https://open.spotify.com/album/${ID}` },
        { name: 'Apple Music', url: 'https://evil.example/artist/1' },
        { name: 'Bandcamp', url: 'http://x.bandcamp.com/' },
      ],
      'name'
    );
    expect(r.spotify).toEqual({ kind: 'album', id: ID });
    expect(r.links).toEqual({});
  });
});

describe('venues, tags, events', () => {
  it('venues keep id, title, address only, sorted by title', () => {
    const v = parseVenues([
      { id: 'b', title: 'Zebra Hall', address: '2 Main', subtitle: 's', headerImageUrl: 'x', version: { seconds: 1 } },
      { id: 'a', title: 'alpha bar', address: '1 Main' },
      { title: 'no id' },
    ]);
    expect(v).toEqual([{ id: 'a', title: 'alpha bar', address: '1 Main' }, { id: 'b', title: 'Zebra Hall', address: '2 Main' }]);
    expect(parseVenues({})).toBeNull();
  });
  it('tag titles', () => {
    expect(parseTagTitles([{ title: 'Music' }, { title: 'All Ages' }, {}, null])).toEqual(['All Ages', 'Music']);
    expect(parseTagTitles('x')).toBeNull();
  });
  it('events: ISO strings kept, Firestore seconds converted, unpublished dropped', () => {
    const e = parseEvents([
      { id: 'e1', title: 'Set', startTime: '2027-03-31T20:00:00.000Z', endTime: '2027-03-31T20:45:00.000Z', venueId: 'v1', performerIds: ['p1', 'p1', 5], canceled: true, status: 'published' },
      { id: 'e2', startTime: { seconds: 1806000000 }, endTime: 'garbage', status: '' },
      { id: 'e3', status: 'staged' },
      { title: 'no id' },
    ]);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ id: 'e1', venueId: 'v1', performerIds: ['p1', 'p1'], canceled: true });
    expect(e[1].start).toBe(new Date(1806000000 * 1000).toISOString());
    expect(e[1].end).toBe('');
    expect(parseEvents({})).toBeNull();
  });
  it('buildSchedule maps performer ids to numbers, keeps unknown ones raw, and is ordered', () => {
    const events = parseEvents([
      { id: 'e2', title: 'Late', startTime: '2027-04-01T01:00:00Z', endTime: '2027-04-01T02:00:00Z', venueId: 'v1', performerIds: ['p2', 'p1'] },
      { id: 'e1', title: 'Early', startTime: '2027-03-31T20:00:00Z', endTime: '2027-03-31T21:00:00Z', venueId: 'vX', performerIds: ['p1', 'comedian', 'comedian', 'other'] },
    ]);
    const map = numberByApiId([{ n: 5, festival: { id: 'p1' } }, { n: 3, festival: { id: 'p2' } }, { n: 9 }]);
    const s = buildSchedule({ venues: [{ id: 'v1', title: 'V', address: 'A' }], events, numberByApiId: map });
    expect(s.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(s.events[0]).toEqual({ id: 'e1', title: 'Early', start: '2027-03-31T20:00:00Z', end: '2027-03-31T21:00:00Z', venueId: 'vX', performers: [5], unknownPerformers: ['comedian', 'other'], canceled: false });
    expect(s.events[1].performers).toEqual([3, 5]);
    expect(s.events[1]).not.toHaveProperty('unknownPerformers');
    expect(s.unknownPerformerIds).toBe(2);
    expect(scheduleSummary(s)).toMatchObject({ venues: 1, events: 2, first: '2027-03-31T20:00:00Z', last: '2027-04-01T02:00:00Z', withUnknownPerformers: 1, unknownPerformerIds: 2, withUnknownVenue: 1, withoutVenue: 0 });
  });
  it('an empty schedule summarises as zeros', () => {
    expect(scheduleSummary(null)).toMatchObject({ venues: 0, events: 0, first: null, last: null });
  });
});

describe('fetchDionysus', () => {
  const fakeClient = (answers) => {
    const calls = [];
    return {
      calls,
      getJson: async (url) => {
        calls.push(url);
        const key = url.split('/').pop();
        const a = answers[key];
        if (a instanceof Error) throw a;
        return { status: 200, body: a };
      },
    };
  };
  const good = () => ({ performers: many(60), venues: [{ id: 'v', title: 'V', address: 'A' }], tags: [MUSIC], events: [] });

  it('one request per endpoint', async () => {
    const c = fakeClient(good());
    const r = await fetchDionysus(c, api);
    expect(c.calls.map((u) => u.split('/').pop())).toEqual(['performers', 'venues', 'tags', 'events']);
    expect(r.performers.ok).toBe(true);
    expect(r.performers.included).toHaveLength(60);
    expect(r.venues).toEqual({ ok: true, value: [{ id: 'v', title: 'V', address: 'A' }] });
    expect(r.events).toEqual({ ok: true, value: [] });
  });
  it('a failed performers request is reported and the other endpoints are skipped', async () => {
    const c = fakeClient({ ...good(), performers: new ApiError('gave up after 3 attempts (last: HTTP 503)') });
    const r = await fetchDionysus(c, api);
    expect(r.performers).toEqual({ ok: false, reason: 'gave up after 3 attempts (last: HTTP 503)' });
    expect(c.calls).toHaveLength(1);
    expect(r.venues.ok).toBe(false);
  });
  it('a non-array or too short lineup is not usable', async () => {
    expect((await fetchDionysus(fakeClient({ ...good(), performers: { error: 'x' } }), api)).performers).toMatchObject({ ok: false, reason: expect.stringMatching(/not a JSON array/) });
    const few = await fetchDionysus(fakeClient({ ...good(), performers: many(49) }), api);
    expect(few.performers).toMatchObject({ ok: false, reason: expect.stringMatching(/only 49 .* at least 50/) });
    // the filter counts: 60 performers of which 20 are comedy leaves 40
    const filtered = await fetchDionysus(fakeClient({ ...good(), performers: many(60, (i) => (i < 20 ? { tags: [COMEDY] } : {})) }), api);
    expect(filtered.performers.ok).toBe(false);
  });
  it('failures of venues, tags and events never throw', async () => {
    const r = await fetchDionysus(fakeClient({ ...good(), venues: new Error('boom'), tags: 'nope', events: { not: 'array' } }), api);
    expect(r.performers.ok).toBe(true);
    expect(r.venues).toMatchObject({ ok: false, reason: 'boom' });
    expect(r.tags).toMatchObject({ ok: false });
    expect(r.events).toMatchObject({ ok: false });
  });
  it('works through the real client: retries a 503, no cache, sends the given headers', async () => {
    const seen = [];
    const responses = [
      { s: 503, b: '' },
      { s: 200, b: JSON.stringify(many(60)) },
      { s: 200, b: '[]' },
      { s: 200, b: '[]' },
      { s: 200, b: '[]' },
    ];
    const client = createClient({
      cacheDir: null,
      minIntervalMs: 0,
      maxAttempts: 3,
      headers: { 'X-Test-Client': 'test-agent' },
      sleep: async () => {},
      fetchImpl: async (url, opts) => {
        seen.push({ url, header: opts.headers['X-Test-Client'] });
        const r = responses.shift();
        return { status: r.s, headers: { get: () => null }, text: async () => r.b };
      },
    });
    const r = await fetchDionysus(client, api);
    expect(r.performers.ok).toBe(true);
    expect(seen.map((x) => x.url.split('/').pop())).toEqual(['performers', 'performers', 'venues', 'tags', 'events']);
    expect(new Set(seen.map((x) => x.header))).toEqual(new Set(['test-agent']));
  });
  it('a host that cannot be reached ends in a failed performers answer, not a throw', async () => {
    const client = createClient({
      cacheDir: null,
      minIntervalMs: 0,
      maxAttempts: 3,
      sleep: async () => {},
      fetchImpl: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      },
    });
    const r = await fetchDionysus(client, api);
    expect(r.performers).toEqual({ ok: false, reason: expect.stringMatching(/gave up after 3 attempts.*ENOTFOUND/) });
  });
});

describe('createClient timeout', () => {
  it('passes an abort signal only when a timeout is set', async () => {
    const opts = [];
    const mk = (timeoutMs) =>
      createClient({
        cacheDir: null,
        minIntervalMs: 0,
        timeoutMs,
        sleep: async () => {},
        fetchImpl: async (url, o) => {
          opts.push(o);
          return { status: 200, headers: { get: () => null }, text: async () => '[]' };
        },
      });
    await mk(0).getJson('https://x.example/');
    await mk(5000).getJson('https://x.example/');
    expect(opts[0].signal).toBeUndefined();
    expect(opts[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('review report', () => {
  const base = (i) => ({ n: i, id: `a${i}`, name: `Band ${i}`, firstSeen: 'd', festival: { id: `p${i}`, links: {} }, spotify: { ids: [ID], matchedName: null, confidence: 'festival', via: 'artist' } });
  const state = (extra) => ({ year: 2027, lastUpdated: 'd', lastScrape: null, artists: [base(1), base(2)], ...extra });

  it('shows the API source, exclusions and the schedule', () => {
    const out = buildOutputs({
      state: state({
        source: { kind: 'api', performers: 2, excluded: { byStatus: { staged: 3 }, byTag: [{ name: 'Funny Person', tags: ['Comedyfort'] }] } },
        schedule: {
          venues: [{ id: 'v1', title: 'V', address: 'A' }],
          events: [{ id: 'e', title: 'T', start: '2027-03-31T20:00:00Z', end: '2027-03-31T21:00:00Z', venueId: 'zz', performers: [1], unknownPerformers: ['c1'], canceled: false }],
          unknownPerformerIds: 1,
        },
      }),
      overrides: {},
    }).review;
    expect(out).toContain('Source this run: the vendor API. 2 performers included.');
    expect(out).toContain('Excluded by status (3): staged 3.');
    expect(out).toMatch(/Excluded by tag.*\(1\):\n- Funny Person \(Comedyfort\)/);
    expect(out).toContain('1 venues, 1 events, 2027-03-31T20:00:00Z to 2027-03-31T21:00:00Z.');
    expect(out).toContain('Events with performers not on the lineup: 1 (1 distinct performer ids). Events with a venue not in the venue list: 1.');
  });
  it('says loudly when the fallback was used, and handles a state with no source or schedule', () => {
    expect(buildOutputs({ state: state({ source: { kind: 'fallback', reason: 'HTTP 503' } }), overrides: {} }).review).toMatch(/Source this run: FALLBACK[\s\S]*not used: HTTP 503/);
    const none = buildOutputs({ state: state(), overrides: {} }).review;
    expect(none).toContain('Not recorded');
    expect(none).toContain('No schedule data fetched yet.');
  });
  it('lists renames, and flags an override still keyed by the old name', () => {
    const renamed = { ...base(1), name: 'New Name', formerNames: ['Old Name'] };
    const s = state({
      artists: [renamed, base(2)],
      lastScrape: { date: 'd', added: [], removed: [], renamed: [{ from: 'Old Name', to: 'New Name', n: 1, cosmetic: false }, { from: 'band 2', to: 'Band 2', n: 2, cosmetic: true }] },
    });
    const out = buildOutputs({ state: s, overrides: { 'Old Name': { note: 'x' } } });
    expect(out.review).toContain('Old Name -> New Name (n=1). OVERRIDE KEYED "Old Name" STILL APPLIES; RE-KEY IT to "New Name"');
    expect(out.review).toContain('band 2 -> Band 2 (n=2) (spelling only)');
    expect(out.warnings.join('\n')).toMatch(/renamed "Old Name" to "New Name" \(n=1\).*re-key/);
    expect(out.warnings.join('\n')).not.toMatch(/matches no artist/);
  });
});
