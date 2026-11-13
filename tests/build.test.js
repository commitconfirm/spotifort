import { describe, it, expect } from 'vitest';
import { buildOutputs, resolveRecord } from '../scripts/lib/build.js';
import { formatCompactLines } from '../scripts/lib/json-format.js';
import { normalizeName } from '../src/core/normalize.js';

const keysOf = (similarity) => similarity.names.map(normalizeName);

const lf = (similar, tags = [], extra = {}) => ({
  queriedName: extra.queriedName ?? 'x', resolvedName: extra.resolvedName ?? 'x', nameChanged: extra.nameChanged ?? 'no',
  listeners: 100, url: extra.url ?? null, similar, tags,
});
const rec = (n, name, extra = {}) => ({
  n, id: name.toLowerCase().replace(/\W+/g, '-'), name, firstSeen: '2026-11-13',
  spotify: { ids: [`id${n}`.padEnd(22, 'x')], matchedName: name, confidence: 'exact' },
  ...extra,
});

function fixture() {
  const alpha = rec(1, 'Alpha', { lastfm: lf([['Beta', 0.8], ['Outside One', 0.5], ['Weak', 0.05], ['Alpha', 1]], [['indie', 100]], { queriedName: 'Alpha', resolvedName: 'Alpha' }) });
  const beta = rec(2, 'Beta', { lastfm: lf([['Outside One', 0.4], ['Foo & Bar', 0.3]], [['indie', 80]], { queriedName: 'Beta', resolvedName: 'Beta' }) });
  const gamma = rec(3, 'Gamma', { lastfm: lf([['Foo and Bar', 0.6]], [], { queriedName: 'Gamma', resolvedName: 'Gamma' }) });
  const gone = rec(4, 'Gone', { removed: '2026-12-01', lastfm: lf([['Ghost Only', 0.9]], [], { queriedName: 'Gone', resolvedName: 'Gone' }) });
  return { year: 2027, lastUpdated: '2026-11-13', lastScrape: { date: '2026-11-13', added: [], removed: ['Gone'] }, artists: [alpha, beta, gamma, gone] };
}

describe('buildOutputs', () => {
  it('excludes removed artists everywhere', () => {
    const out = buildOutputs({ state: fixture(), overrides: {} });
    expect(out.lineup.artists.map((a) => a.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(keysOf(out.similarity)).not.toContain('ghost only');
    expect(out.stats.removed).toBe(1);
  });

  it('writes the spec shapes', () => {
    const out = buildOutputs({ state: fixture(), overrides: {} });
    const a = out.lineup.artists[0];
    expect(Object.keys(a)).toEqual(['n', 'id', 'name', 'spotifyIds', 'ids', 'links', 'tags', 'similar']);
    expect(a.links.spotify).toBe(`https://open.spotify.com/artist/${a.spotifyIds[0]}`);
    expect(a.tags).toEqual(['indie']);
    expect(a.similar[0][0]).toBe(2);
    expect(['direct', 'neighbours', 'tags']).toContain(a.similar[0][2]);
    expect(Object.keys(out.similarity)).toEqual(['minMatch', 'names', 'edges']); // no `keys`: the client derives them
    expect(out.similarity.minMatch).toBe(0.1);
    expect(out.similarity.edges).toHaveLength(out.similarity.names.length);
  });

  it('reverse index: no lineup artists, no self, cutoff, merged collisions keep the higher score', () => {
    const { similarity } = buildOutputs({ state: fixture(), overrides: {} });
    expect(keysOf(similarity)).toEqual(['foo and bar', 'outside one']);
    expect(keysOf(similarity)).not.toContain('beta');
    expect(keysOf(similarity)).not.toContain('weak');
    // Foo & Bar: Beta 0.3, Gamma 0.6 -> Gamma first
    expect(similarity.edges[0]).toEqual([3, 60, 2, 30]);
    expect(similarity.edges[1]).toEqual([1, 50, 2, 40]);
  });

  it('is deterministic: same inputs, byte-identical files', () => {
    const a = buildOutputs({ state: fixture(), overrides: {} });
    const b = buildOutputs({ state: JSON.parse(JSON.stringify(fixture())), overrides: {} });
    expect(formatCompactLines(a.lineup)).toBe(formatCompactLines(b.lineup));
    expect(formatCompactLines(a.similarity)).toBe(formatCompactLines(b.similarity));
    expect(a.review).toBe(b.review);
    expect(a.sanity).toBe(b.sanity);
  });

  it('flags inexact and ambiguous Spotify matches as unverified, not manual or exact', () => {
    const s = fixture();
    s.artists[0].spotify.confidence = 'inexact';
    s.artists[1].spotify.confidence = 'ambiguous';
    const out = buildOutputs({ state: s, overrides: { Gamma: { spotifyIds: ['6hhmxPotJ2kCsQjUGPtH14'] } } });
    const by = Object.fromEntries(out.lineup.artists.map((a) => [a.name, a]));
    expect(by.Alpha.unverified).toBe(true);
    expect(by.Beta.unverified).toBe(true);
    expect(by.Gamma.unverified).toBeUndefined();
    expect(by.Gamma.spotifyIds).toEqual(['6hhmxPotJ2kCsQjUGPtH14']);
    expect(out.review).toMatch(/inexact matches[^\n]*\(1\)/);
    expect(out.review).toMatch(/Alpha -> Alpha/);
  });

  it('MusicBrainz confirms a doubtful match when its name equals the festival name', () => {
    const mb = (extra) => ({ mbid: 'm1', mbFor: 'id2'.padEnd(22, 'x'), mbFetched: 'm1', mbName: 'Beta', ...extra });
    const run = (extraState, overrides = {}) => {
      const s = fixture();
      s.artists[1].spotify.confidence = 'ambiguous';
      Object.assign(s.artists[1], extraState);
      const out = buildOutputs({ state: s, overrides });
      return { beta: out.lineup.artists[1], out };
    };
    expect(run({}).beta.unverified).toBe(true);
    expect(run(mb()).beta.unverified).toBeUndefined();
    expect(run(mb({ mbName: 'BETA' })).beta.unverified).toBeUndefined(); // equal after normalisation
    expect(run(mb({ mbName: 'Beta Two' })).beta.unverified).toBe(true);   // different artist
    expect(run(mb({ mbFor: 'other'.padEnd(22, 'x') })).beta.unverified).toBe(true); // MBID came from a different Spotify id
    expect(run(mb({ mbName: undefined })).beta.unverified).toBe(true);
    expect(run(mb(), { Beta: { mbid: '3a3e2a31-1b5c-4c7e-9f0a-0a1b2c3d4e5f' } }).beta.unverified).toBe(true); // hand-set MBID is not a confirmation
    const { out } = run(mb());
    expect(out.review).toMatch(/Confirmed by MusicBrainz, not flagged \(1\)\nBeta\n/);
    expect(out.review).toMatch(/Needs a human look, flagged unverified \(0\)/);
    expect(out.stats.confirmedByMusicbrainz).toBe(1);
  });

  it('an override with unverified: true stays flagged even when MusicBrainz knows the artist', () => {
    const id = '6hhmxPotJ2kCsQjUGPtH14';
    const o = { Gamma: { spotifyIds: [id], unverified: true } };
    let out = buildOutputs({ state: fixture(), overrides: o });
    expect(out.lineup.artists[2].unverified).toBe(true);
    expect(out.review).toMatch(/owner-accepted unconfirmed matches[^\n]*\(1\)/);
    const s = fixture();
    Object.assign(s.artists[2], { mbid: 'm3', mbFor: id, mbFetched: 'm3', mbName: 'Gamma' });
    out = buildOutputs({ state: s, overrides: o });
    expect(out.lineup.artists[2].unverified).toBe(true);
  });

  it('applies overrides: Spotify ids, links, ids, tags, and null clears', () => {
    const s = fixture();
    s.artists[0].links = { bandcamp: 'https://alpha.bandcamp.com/', youtube: 'https://www.youtube.com/channel/UCx' };
    s.artists[0].ids = { tidal: '1', deezer: '2' };
    const out = buildOutputs({
      state: s,
      overrides: { Alpha: { links: { youtube: null, soundcloud: 'https://soundcloud.com/alpha' }, ids: { tidal: null, appleMusic: '9' }, tags: ['Post-Punk'] } },
    });
    const a = out.lineup.artists[0];
    expect(a.links.youtube).toBeUndefined();
    expect(a.links.soundcloud).toBe('https://soundcloud.com/alpha');
    expect(a.links.bandcamp).toBe('https://alpha.bandcamp.com/');
    expect(a.ids).toEqual({ appleMusic: '9', deezer: '2' });
    expect(a.tags).toEqual(['post-punk']);
  });

  it('never ships a link that fails the allow-list, even from state', () => {
    const s = fixture();
    s.artists[0].links = { bandcamp: 'http://alpha.bandcamp.com/', youtube: 'https://evil.example/x', soundcloud: 'https://soundcloud.com/ok' };
    const a = buildOutputs({ state: s, overrides: {} }).lineup.artists[0];
    expect(Object.keys(a.links)).toEqual(['spotify', 'soundcloud']);
  });

  it('uses no Last.fm data for an artist whose name was autocorrected to a different artist, until overridden', () => {
    const s = fixture();
    s.artists[1].lastfm = lf([['Trance Act', 0.9]], [['trance', 100]], { queriedName: 'Beta', resolvedName: 'Betamax', nameChanged: 'different' });
    const out = buildOutputs({ state: s, overrides: {} });
    expect(keysOf(out.similarity)).not.toContain('trance act');
    expect(out.lineup.artists[1].tags).toEqual([]);
    expect(out.review).toMatch(/autocorrected to a different artist, data not used \(1\)/);
    expect(out.review).toMatch(/Beta -> Betamax/);
  });

  it('uses Last.fm data fetched under an override name, and ignores stale data when the override changed', () => {
    const s = fixture();
    s.artists[1].lastfm = lf([['Outside Two', 0.5]], [], { queriedName: 'Betaa', resolvedName: 'Betaa' });
    let out = buildOutputs({ state: s, overrides: { Beta: { lastfmName: 'Betaa' } } });
    expect(keysOf(out.similarity)).toContain('outside two');
    out = buildOutputs({ state: s, overrides: { Beta: { lastfmName: 'Different' } } });
    expect(keysOf(out.similarity)).not.toContain('outside two');
    out = buildOutputs({ state: s, overrides: { Beta: { lastfmName: null } } });
    expect(keysOf(out.similarity)).not.toContain('outside two');
  });

  it('recognises a lineup artist by its Last.fm name too (alias) when excluding from the reverse index', () => {
    const s = fixture();
    s.artists[1].lastfm = lf([], [], { queriedName: 'Beta', resolvedName: 'Beta Band', nameChanged: 'cosmetic' });
    s.artists[0].lastfm = lf([['Beta Band', 0.7]], [], { queriedName: 'Alpha', resolvedName: 'Alpha' });
    // 'Beta Band' normalises differently from 'Beta' so cosmetic would not really happen; force it via the state to test aliasing.
    const out = buildOutputs({ state: s, overrides: {} });
    expect(keysOf(out.similarity)).not.toContain('beta band');
  });

  it('reports artists whose Spotify lookup is unresolved', () => {
    const s = fixture();
    delete s.artists[2].spotify;
    const out = buildOutputs({ state: s, overrides: {} });
    expect(out.review).toMatch(/Spotify not resolved yet \(1\)/);
  });

  it('warns about overrides that match nobody', () => {
    expect(buildOutputs({ state: fixture(), overrides: { Nobody: { note: 'x' } } }).warnings.join()).toMatch(/Nobody/);
  });

  it('sanity report lists the neighbours, distribution and reverse-index targets', () => {
    const out = buildOutputs({ state: fixture(), overrides: {} });
    expect(out.sanity).toMatch(/## Neighbour counts/);
    expect(out.sanity).toMatch(/Dominant signal/);
    expect(out.sanity).toMatch(/Reverse index targets/);
    expect(out.sanity).toMatch(/Phoebe Bridgers: not in the index/);
  });
});

describe('resolveRecord', () => {
  it('falls back to the Last.fm page for the lastfm link only when MusicBrainz had none', () => {
    const r = rec(1, 'Alpha', { lastfm: lf([], [], { queriedName: 'Alpha', resolvedName: 'Alpha', url: 'https://www.last.fm/music/Alpha' }) });
    expect(resolveRecord(r, {}).links.lastfm).toBe('https://www.last.fm/music/Alpha');
    r.links = { lastfm: 'https://www.last.fm/music/Alpha+Band' };
    expect(resolveRecord(r, {}).links.lastfm).toBe('https://www.last.fm/music/Alpha+Band');
  });
});
