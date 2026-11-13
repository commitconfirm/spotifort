import { describe, it, expect } from 'vitest';
import {
  effectiveMbid,
  effectiveSpotify,
  emptyState,
  lastfmQueryName,
  mergeScrape,
  needsLastfm,
  needsMbLinks,
  needsMbid,
  needsSpotify,
  pickSpotifyMatch,
  slugify,
  uniqueId,
} from '../scripts/lib/state.js';

const names = (n) => Array.from({ length: n }, (_, i) => `Artist ${i}`);
const sp = (name, id = name) => ({ id, name });

describe('slugify / uniqueId', () => {
  it('makes lowercase hyphenated ids, drops accents and keeps non-Latin letters', () => {
    expect(slugify('Mabe Fratti & Bill Orcutt')).toBe('mabe-fratti-bill-orcutt');
    expect(slugify('La Sécurité')).toBe('la-securite');
    expect(slugify('JÜN')).toBe('jun');
    expect(slugify('宇多田ヒカル')).toBe('宇多田ヒカル');
    expect(slugify('DLG.')).toBe('dlg');
  });
  it('is empty for names with no letters or digits, and uniqueId falls back to the number', () => {
    expect(slugify('!!!')).toBe('');
    expect(uniqueId('!!!', 7, new Set())).toBe('artist-7');
  });
  it('de-duplicates', () => {
    const taken = new Set();
    expect(uniqueId('The Band', 1, taken)).toBe('the-band');
    expect(uniqueId('the band!', 2, taken)).toBe('the-band-2');
    expect(uniqueId('The Band', 3, taken)).toBe('the-band-3');
  });
});

describe('mergeScrape', () => {
  const seed = () => mergeScrape(emptyState(2027), names(60), '2026-11-13').state;

  it('numbers new artists in order and records them', () => {
    const r = mergeScrape(emptyState(2027), names(60), '2026-11-13');
    expect(r.added).toHaveLength(60);
    expect(r.state.artists[0]).toMatchObject({ n: 1, id: 'artist-0', name: 'Artist 0', firstSeen: '2026-11-13' });
    expect(r.state.artists[59].n).toBe(60);
    expect(r.state.lastUpdated).toBe('2026-11-13');
  });

  it('keeps n for existing names and gives new names the next n', () => {
    const r = mergeScrape(seed(), [...names(60), 'Newcomer'], '2026-12-01');
    expect(r.added).toEqual(['Newcomer']);
    expect(r.state.artists.find((a) => a.name === 'Newcomer').n).toBe(61);
    expect(r.state.artists.find((a) => a.name === 'Artist 5').n).toBe(6);
    expect(r.state.lastScrape).toEqual({ date: '2026-12-01', added: ['Newcomer'], removed: [] });
  });

  it('marks vanished artists removed, never deletes them, and never reuses their n', () => {
    const r = mergeScrape(seed(), names(60).slice(1), '2026-12-01');
    expect(r.removed).toEqual(['Artist 0']);
    const gone = r.state.artists.find((a) => a.name === 'Artist 0');
    expect(gone).toMatchObject({ n: 1, removed: '2026-12-01' });
    const again = mergeScrape(r.state, [...names(60).slice(1), 'Fresh'], '2026-12-02');
    expect(again.state.artists.find((a) => a.name === 'Fresh').n).toBe(61);
  });

  it('restores a returning artist with its old n', () => {
    const gone = mergeScrape(seed(), names(60).slice(1), '2026-12-01').state;
    const back = mergeScrape(gone, names(60), '2026-12-05');
    expect(back.restored).toEqual(['Artist 0']);
    const rec = back.state.artists.find((a) => a.name === 'Artist 0');
    expect(rec.n).toBe(1);
    expect(rec.removed).toBeUndefined();
  });

  it('matches cosmetic renames by normalised name and adopts the new spelling', () => {
    const base = seed();
    const list = names(60);
    list[3] = 'ARTIST 3!';
    const r = mergeScrape(base, list, '2026-12-01');
    expect(r.added).toEqual([]);
    expect(r.renamed).toEqual(['Artist 3 -> ARTIST 3!']);
    expect(r.state.artists[3]).toMatchObject({ n: 4, name: 'ARTIST 3!' });
  });

  it('collapses names that normalise the same', () => {
    const r = mergeScrape(emptyState(2027), [...names(60), 'The Foo & Bar', 'the foo and bar'], '2026-11-13');
    expect(r.state.artists).toHaveLength(61);
  });

  it('fails loudly, changing nothing, on a short scrape', () => {
    const base = seed();
    expect(() => mergeScrape(base, names(49), '2026-12-01')).toThrow(/at least 50/);
  });

  it('refuses a scrape that would remove most of the lineup', () => {
    const base = seed();
    const half = names(100).slice(40); // keeps only Artist 40..59 of the 60 seeded
    expect(() => mergeScrape(base, half, '2026-12-01')).toThrow(/would remove 40 of 60/);
  });

  it('does not mutate its input', () => {
    const base = seed();
    const copy = JSON.stringify(base);
    mergeScrape(base, [...names(60).slice(2), 'New'], '2026-12-01');
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('keeps the last non-empty change list when a rerun on the same day finds nothing', () => {
    const first = mergeScrape(seed(), [...names(60), 'New'], '2026-12-01').state;
    const rerun = mergeScrape(first, [...names(60), 'New'], '2026-12-01').state;
    expect(rerun.lastScrape.added).toEqual(['New']);
    const nextDay = mergeScrape(first, [...names(60), 'New'], '2026-12-02').state;
    expect(nextDay.lastScrape).toEqual({ date: '2026-12-02', added: [], removed: [] });
  });
});

describe('pickSpotifyMatch', () => {
  it('returns null for no results', () => {
    expect(pickSpotifyMatch('X', [])).toBeNull();
    expect(pickSpotifyMatch('X', undefined)).toBeNull();
  });
  it('exact: one result equal after normalisation (case, &/and, punctuation)', () => {
    expect(pickSpotifyMatch('Sam & Louise Sullivan', [sp('Sam and Louise Sullivan', 'a')])).toEqual({
      ids: ['a'], matchedName: 'Sam and Louise Sullivan', confidence: 'exact',
    });
    expect(pickSpotifyMatch('wishy', [sp('Other', 'x'), sp('WISHY', 'w')]).ids).toEqual(['w']);
  });
  it('inexact: no equal name, top hit used', () => {
    expect(pickSpotifyMatch('Jeffrey Lewis & The Voltage', [sp('Jeffrey Lewis', 'j'), sp('Other', 'o')])).toEqual({
      ids: ['j'], matchedName: 'Jeffrey Lewis', confidence: 'inexact',
    });
  });
  it('ambiguous: several equal names, the first is used', () => {
    const r = pickSpotifyMatch('Barbara', [sp('Other', 'o'), sp('Barbara', 'b1'), sp('barbara', 'b2')]);
    expect(r).toMatchObject({ ids: ['b1'], confidence: 'ambiguous' });
  });
  it('ignores results without an id', () => {
    expect(pickSpotifyMatch('X', [{ name: 'X' }])).toBeNull();
  });
});

describe('what each stage still has to do', () => {
  const rec = (extra = {}) => ({ n: 1, id: 'a', name: 'A', ...extra });
  const found = { ids: ['id1'], matchedName: 'A', confidence: 'exact' };

  it('spotify: unresolved until a successful search; none is a real answer; an override resolves', () => {
    expect(needsSpotify(rec(), {})).toBe(true);
    expect(needsSpotify(rec({ spotify: found }), {})).toBe(false);
    expect(needsSpotify(rec({ spotify: { ids: [], confidence: 'none' } }), {})).toBe(false);
    expect(needsSpotify(rec(), { spotifyIds: [] })).toBe(false);
    expect(needsSpotify(rec({ removed: '2026-12-01' }), {})).toBe(false);
  });
  it('effectiveSpotify: overrides win and are manual', () => {
    expect(effectiveSpotify(rec({ spotify: found }), { spotifyIds: ['x', 'y'] })).toMatchObject({ ids: ['x', 'y'], confidence: 'manual', resolved: true });
    expect(effectiveSpotify(rec(), {})).toMatchObject({ ids: [], resolved: false });
  });
  it('musicbrainz: needs a Spotify id and an answer for that id', () => {
    expect(needsMbid(rec(), {})).toBe(false);
    expect(needsMbid(rec({ spotify: found }), {})).toBe(true);
    expect(needsMbid(rec({ spotify: found, mbid: null, mbFor: 'id1' }), {})).toBe(false);
    expect(needsMbid(rec({ spotify: found, mbid: 'm', mbFor: 'old' }), {})).toBe(true); // Spotify id changed
    expect(needsMbid(rec({ spotify: found }), { mbid: null })).toBe(false);
  });
  it('musicbrainz links: fetched once per mbid; an override mbid is used', () => {
    expect(needsMbLinks(rec({ mbid: 'm' }), {})).toBe(true);
    expect(needsMbLinks(rec({ mbid: 'm', mbFetched: 'm' }), {})).toBe(true); // name not stored yet
    expect(needsMbLinks(rec({ mbid: 'm', mbFetched: 'm', mbName: 'A' }), {})).toBe(false);
    expect(needsMbLinks(rec({ mbid: null }), {})).toBe(false);
    expect(effectiveMbid(rec({ mbid: 'm' }), { mbid: 'o' })).toBe('o');
    expect(needsMbLinks(rec({ mbid: 'm', mbFetched: 'm' }), { mbid: 'o' })).toBe(true);
  });
  it('lastfm: asks again only when the name asked for changes; null means skip once', () => {
    expect(needsLastfm(rec(), {})).toBe(true);
    expect(needsLastfm(rec({ lastfm: { queriedName: 'A' } }), {})).toBe(false);
    expect(needsLastfm(rec({ lastfm: { queriedName: 'A' } }), { lastfmName: 'B' })).toBe(true);
    expect(lastfmQueryName(rec(), { lastfmName: null })).toBeNull();
    expect(needsLastfm(rec({ lastfm: { queriedName: 'A' } }), { lastfmName: null })).toBe(true);
    expect(needsLastfm(rec({ lastfm: { skipped: true } }), { lastfmName: null })).toBe(false);
  });
});
