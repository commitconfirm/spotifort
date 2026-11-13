import { describe, it, expect } from 'vitest';
import {
  effectiveMbid,
  effectiveSpotify,
  emptyState,
  lastfmQueryName,
  mergeLineup,
  needsLastfm,
  needsMbLinks,
  needsMbid,
  needsSpotify,
  pickSpotifyMatch,
  slugify,
  uniqueId,
} from '../scripts/lib/state.js';
import { indexOverrides, overrideFor } from '../scripts/lib/overrides.js';

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

describe('mergeLineup', () => {
  const seed = () => mergeLineup(emptyState(2027), names(60), '2026-11-13').state;

  it('numbers new artists in order and records them', () => {
    const r = mergeLineup(emptyState(2027), names(60), '2026-11-13');
    expect(r.added).toHaveLength(60);
    expect(r.state.artists[0]).toMatchObject({ n: 1, id: 'artist-0', name: 'Artist 0', firstSeen: '2026-11-13' });
    expect(r.state.artists[59].n).toBe(60);
    expect(r.state.lastUpdated).toBe('2026-11-13');
  });

  it('keeps n for existing names and gives new names the next n', () => {
    const r = mergeLineup(seed(), [...names(60), 'Newcomer'], '2026-12-01');
    expect(r.added).toEqual(['Newcomer']);
    expect(r.state.artists.find((a) => a.name === 'Newcomer').n).toBe(61);
    expect(r.state.artists.find((a) => a.name === 'Artist 5').n).toBe(6);
    expect(r.state.lastScrape).toEqual({ date: '2026-12-01', added: ['Newcomer'], removed: [] });
  });

  it('marks vanished artists removed, never deletes them, and never reuses their n', () => {
    const r = mergeLineup(seed(), names(60).slice(1), '2026-12-01');
    expect(r.removed).toEqual(['Artist 0']);
    const gone = r.state.artists.find((a) => a.name === 'Artist 0');
    expect(gone).toMatchObject({ n: 1, removed: '2026-12-01' });
    const again = mergeLineup(r.state, [...names(60).slice(1), 'Fresh'], '2026-12-02');
    expect(again.state.artists.find((a) => a.name === 'Fresh').n).toBe(61);
  });

  it('restores a returning artist with its old n', () => {
    const gone = mergeLineup(seed(), names(60).slice(1), '2026-12-01').state;
    const back = mergeLineup(gone, names(60), '2026-12-05');
    expect(back.restored).toEqual(['Artist 0']);
    const rec = back.state.artists.find((a) => a.name === 'Artist 0');
    expect(rec.n).toBe(1);
    expect(rec.removed).toBeUndefined();
  });

  it('matches cosmetic renames by normalised name and adopts the new spelling', () => {
    const base = seed();
    const list = names(60);
    list[3] = 'ARTIST 3!';
    const r = mergeLineup(base, list, '2026-12-01');
    expect(r.added).toEqual([]);
    expect(r.renamed).toEqual(['Artist 3 -> ARTIST 3!']);
    expect(r.state.artists[3]).toMatchObject({ n: 4, name: 'ARTIST 3!' });
  });

  it('collapses names that normalise the same', () => {
    const r = mergeLineup(emptyState(2027), [...names(60), 'The Foo & Bar', 'the foo and bar'], '2026-11-13');
    expect(r.state.artists).toHaveLength(61);
  });

  it('fails loudly, changing nothing, on a short scrape', () => {
    const base = seed();
    expect(() => mergeLineup(base, names(49), '2026-12-01')).toThrow(/at least 50/);
  });

  it('refuses a scrape that would remove most of the lineup', () => {
    const base = seed();
    const half = names(100).slice(40); // keeps only Artist 40..59 of the 60 seeded
    expect(() => mergeLineup(base, half, '2026-12-01')).toThrow(/would remove 40 of 60/);
  });

  it('does not mutate its input', () => {
    const base = seed();
    const copy = JSON.stringify(base);
    mergeLineup(base, [...names(60).slice(2), 'New'], '2026-12-01');
    expect(JSON.stringify(base)).toBe(copy);
  });

  it('keeps the last non-empty change list when a rerun on the same day finds nothing', () => {
    const first = mergeLineup(seed(), [...names(60), 'New'], '2026-12-01').state;
    const rerun = mergeLineup(first, [...names(60), 'New'], '2026-12-01').state;
    expect(rerun.lastScrape.added).toEqual(['New']);
    const nextDay = mergeLineup(first, [...names(60), 'New'], '2026-12-02').state;
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

describe('mergeLineup with API ids', () => {
  const api = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ name: `Artist ${i}`, apiId: `p${i}`, festival: { id: `p${i}`, hometown: 'X', links: {} }, ...over }));
  const seed = () => mergeLineup(emptyState(2027), api(60), '2026-11-13').state;

  it('stores the festival block (with the id) on new records and leaves the slug alone', () => {
    const s = seed();
    expect(s.artists[3]).toEqual({ n: 4, id: 'artist-3', name: 'Artist 3', firstSeen: '2026-11-13', festival: { id: 'p3', hometown: 'X', links: {} } });
    const withSlug = { ...s, artists: s.artists.map((a) => ({ ...a, slug: `s-${a.n}` })) };
    const again = mergeLineup(withSlug, api(60), '2026-11-14');
    expect(again.state.artists[3].slug).toBe('s-4');
  });

  it('a performer renamed by the festival keeps n, data and id; the old name is reported', () => {
    const base = seed();
    base.artists[5].spotify = { ids: ['x'], confidence: 'festival', via: 'artist' };
    const list = api(60);
    list[5] = { ...list[5], name: 'Brand New Name' };
    const r = mergeLineup(base, list, '2026-12-01');
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.renames).toEqual([{ from: 'Artist 5', to: 'Brand New Name', n: 6, cosmetic: false }]);
    const rec = r.state.artists[5];
    expect(rec).toMatchObject({ n: 6, name: 'Brand New Name', id: 'artist-5', spotify: { ids: ['x'] } });
    expect(r.state.lastScrape.renamed).toEqual(r.renames);
    expect(r.state.artists).toHaveLength(60);
  });

  it('formerNames is kept only while an override is keyed by the old name', () => {
    const list = api(60);
    list[5] = { ...list[5], name: 'Brand New Name' };
    const noOverride = mergeLineup(seed(), list, '2026-12-01', { overrideIndex: indexOverrides({}) });
    expect(noOverride.state.artists[5].formerNames).toBeUndefined();
    const withOverride = mergeLineup(seed(), list, '2026-12-01', { overrideIndex: indexOverrides({ 'Artist 5': { note: 'x' } }) });
    expect(withOverride.state.artists[5].formerNames).toEqual(['Artist 5']);
    expect(overrideFor(indexOverrides({ 'Artist 5': { note: 'x' } }), withOverride.state.artists[5])).toEqual({ note: 'x' });
    // re-keyed: the next run drops it
    const rekeyed = mergeLineup(withOverride.state, list, '2026-12-02', { overrideIndex: indexOverrides({ 'Brand New Name': { note: 'x' } }) });
    expect(rekeyed.state.artists[5].formerNames).toBeUndefined();
    // a cosmetic edit never needs one
    const cosmetic = [...api(60)];
    cosmetic[5] = { ...cosmetic[5], name: 'ARTIST 5' };
    const c = mergeLineup(seed(), cosmetic, '2026-12-01', { overrideIndex: indexOverrides({ 'Artist 5': {} }) });
    expect(c.renames[0].cosmetic).toBe(true);
    expect(c.state.artists[5].formerNames).toBeUndefined();
  });

  it('matches by id before name: a swap of names keeps each artist with its id', () => {
    const list = api(60);
    [list[1].name, list[2].name] = [list[2].name, list[1].name];
    const r = mergeLineup(seed(), list, '2026-12-01');
    expect(r.added).toEqual([]);
    expect(r.state.artists[1]).toMatchObject({ n: 2, name: 'Artist 2', festival: { id: 'p1' } });
    expect(r.state.artists[2]).toMatchObject({ n: 3, name: 'Artist 1', festival: { id: 'p2' } });
  });

  it('a new id under an existing name is matched by name; a new performer under a renamed record\'s old name is new', () => {
    const list = api(60);
    list[7] = { ...list[7], apiId: 'pNEW', festival: { id: 'pNEW', links: {} } };
    const r = mergeLineup(seed(), list, '2026-12-01');
    expect(r.added).toEqual([]);
    expect(r.state.artists[7].festival.id).toBe('pNEW');
    const list2 = api(60);
    list2[7] = { ...list2[7], name: 'Renamed Seven' };
    list2.push({ name: 'Artist 7', apiId: 'pOTHER', festival: { id: 'pOTHER', links: {} } });
    const r2 = mergeLineup(seed(), list2, '2026-12-01');
    expect(r2.added).toEqual(['Artist 7']);
    expect(r2.state.artists[7]).toMatchObject({ n: 8, name: 'Renamed Seven' });
    expect(r2.state.artists[60]).toMatchObject({ n: 61, name: 'Artist 7' });
  });

  it('keeps the safety checks: too few names, and too many removals', () => {
    expect(() => mergeLineup(seed(), api(49), '2026-12-01')).toThrow(/at least 50/);
    expect(() => mergeLineup(seed(), api(60).slice(0, 29).concat(Array.from({ length: 31 }, (_, i) => ({ name: `Other ${i}`, apiId: `o${i}`, festival: { id: `o${i}`, links: {} } }))), '2026-12-01')).toThrow(/would remove 31 of 60/);
  });

  it('removed performers are marked and reported, never deleted; they restore by id', () => {
    const r = mergeLineup(seed(), api(60).slice(1), '2026-12-01');
    expect(r.removed).toEqual(['Artist 0']);
    expect(r.state.artists[0]).toMatchObject({ n: 1, removed: '2026-12-01' });
    const back = mergeLineup(r.state, api(60), '2026-12-05');
    expect(back.restored).toEqual(['Artist 0']);
    expect(back.state.artists[0].removed).toBeUndefined();
  });

  it('unchanged API data changes nothing, on the same day or a later one', () => {
    const first = seed();
    const again = mergeLineup(first, api(60), '2026-11-13');
    expect(again.state).toEqual(first);
    // the first quiet day after the 60 additions replaces the change list once; after that nothing changes
    const settled = mergeLineup(first, api(60), '2026-11-14').state;
    expect(settled.lastScrape).toEqual({ date: '2026-11-14', added: [], removed: [] });
    const later = mergeLineup(settled, api(60), '2026-11-20');
    expect(later.state).toEqual(settled);
    expect(later.festivalChanged).toBe(0);
  });

  it('changed festival data (a new link) is applied and bumps lastUpdated', () => {
    const first = seed();
    const list = api(60);
    list[2] = { ...list[2], festival: { id: 'p2', hometown: 'X', links: { bandcamp: 'https://x.bandcamp.com/' } } };
    const r = mergeLineup(first, list, '2026-12-01');
    expect(r.festivalChanged).toBe(1);
    expect(r.state.lastUpdated).toBe('2026-12-01');
    expect(r.state.artists[2].festival.links.bandcamp).toBe('https://x.bandcamp.com/');
  });
});
