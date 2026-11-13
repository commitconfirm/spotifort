import { describe, it, expect } from 'vitest';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { addBatch, addTyped, addPicked, emptyPool } from '../src/core/pool.js';
import { decodeShare } from '../src/core/share.js';
import {
  addByName, addSuggestion, computeResults, diagnostics, groupByBand, importSummaryText, joinNames, libraryChipText, libraryCount, listenFor, poolChips,
  reasonText, resolveName, sharePicks, shareUrl, sharedFromHash, signalLabel, similarFor, suggestions,
  useRelativeBands, validExamples, LARGE_POOL, RELATIVE_STRONG,
} from '../src/app/state.js';

const lineup = prepareLineup({
  year: 2030,
  artists: [
    { n: 1, name: 'Alpha', spotifyIds: ['sp1'], links: { spotify: 'https://open.spotify.com/artist/sp1', tidal: 'https://tidal.com/artist/9' }, tags: ['rock'], similar: [[2, 0.6, 'direct'], [3, 0.3, 'tags']] },
    { n: 2, name: 'Beta', tags: ['rock'], similar: [[1, 0.6, 'neighbours']] },
    { n: 3, name: 'Gamma Ray', tags: [], similar: [], unverified: true },
  ],
});
const sim = prepareSimilarity({ minMatch: 0.1, names: ['Gamma Rays Tribute', 'Outsider'], edges: [[3, 40], [1, 50, 2, 20]] });

describe('resolveName / addByName', () => {
  it('resolves lineup names first, then the index, else unknown; pending without the index', () => {
    expect(resolveName('alpha', lineup, sim)).toMatchObject({ kind: 'lineup', artist: { n: 1 } });
    expect(resolveName('OUTSIDER', lineup, sim)).toEqual({ kind: 'outside', name: 'Outsider' });
    expect(resolveName('Metallica', lineup, sim)).toEqual({ kind: 'unknown' });
    expect(resolveName('Outsider', lineup, null)).toEqual({ kind: 'pending' });
    expect(resolveName('   ', lineup, sim)).toEqual({ kind: 'unknown' });
  });
  it('adds a lineup artist as a pick and an outside artist under its canonical name; never adds unknown names', () => {
    let r = addByName(emptyPool(), 'alpha', lineup, sim);
    expect(r.outcome).toBe('added');
    expect(r.pool.entries[0]).toMatchObject({ name: 'Alpha', n: 1, sources: ['picked'] });
    r = addByName(r.pool, 'outsider', lineup, sim);
    expect(r.pool.entries.map((e) => e.name)).toEqual(['Alpha', 'Outsider']);
    const u = addByName(r.pool, 'Metallica', lineup, sim);
    expect(u.outcome).toBe('unknown');
    expect(u.pool).toBe(r.pool);
  });
  it('reports an artist the visitor already added', () => {
    const pool = addTyped(emptyPool(), 'Outsider');
    expect(addSuggestion(pool, { kind: 'outside', name: 'Outsider' })).toMatchObject({ outcome: 'already', pool });
  });
  it('adding by hand an artist that only a library holds is not "already"', () => {
    const pool = addBatch(emptyPool(), 'spotify', [{ name: 'Outsider', weight: 0.5 }]);
    const r = addSuggestion(pool, { kind: 'outside', name: 'Outsider' });
    expect(r.outcome).toBe('added');
    expect(r.pool.entries[0].sources.sort()).toEqual(['spotify', 'typed']);
  });
});

describe('suggestions', () => {
  it('lists lineup artists first, then outside artists, with stable ids', () => {
    const s = suggestions('gamma', lineup, sim);
    expect(s).toEqual([
      { id: 'l3', kind: 'lineup', name: 'Gamma Ray', n: 3 },
      { id: 'ogamma rays tribute', kind: 'outside', name: 'Gamma Rays Tribute' },
    ]);
  });
  it('works on the lineup alone before the index loads, and respects the limit', () => {
    expect(suggestions('gamma', lineup, null)).toHaveLength(1);
    expect(suggestions('a', lineup, sim)).toEqual([]); // one character is too short
    expect(suggestions('gamma', lineup, sim, { limit: 1 })).toHaveLength(1);
  });
});

describe('validExamples', () => {
  it('keeps names on the lineup or in the index, drops unknown ones, keeps unresolved ones while the index loads', () => {
    expect(validExamples(['Alpha', 'Outsider', 'Nope'], lineup, sim)).toEqual(['Alpha', 'Outsider']);
    expect(validExamples(['Alpha', 'Outsider', 'Nope'], lineup, null)).toEqual(['Alpha', 'Outsider', 'Nope']);
    expect(validExamples(undefined, lineup, sim)).toEqual([]);
  });
});

describe('poolChips', () => {
  it('shows hand-added artists as chips and each library as one summary chip', () => {
    let pool = addPicked(addTyped(emptyPool(), 'Outsider'), { n: 1, name: 'Alpha' });
    pool = addBatch(pool, 'spotify', Array.from({ length: 1341 }, (_, i) => ({ name: `Lib ${i}`, weight: 0.5 })).concat([{ name: 'Alpha', weight: 0.4 }]));
    const chips = poolChips(pool);
    expect(chips.manual.map((c) => c.name)).toEqual(['Outsider', 'Alpha']);
    expect(chips.libraries).toEqual([{ sourceId: 'spotify', label: 'Spotify library', count: 1342, text: 'Spotify library · 1,342 artists' }]);
  });
  it('formats the summary for one artist', () => {
    expect(libraryChipText('Spotify library', 1)).toBe('Spotify library · 1 artist');
  });
});

describe('computeResults', () => {
  it('matches and recommends; "no data" only for hand-added artists', () => {
    let pool = addTyped(emptyPool(), 'Outsider');
    pool = addBatch(pool, 'spotify', [{ name: 'Unknown Library Act', weight: 0.8 }]);
    pool = addTyped(pool, 'Typed Nobody');
    const r = computeResults(pool, lineup, sim);
    expect(r.recommendations.map((x) => x.name)).toEqual(['Alpha', 'Beta']);
    expect(r.noData.map((e) => e.name)).toEqual(['Typed Nobody']);
    expect(r.stats.contributors).toBe(1);
  });
  it('without the index: lineup matches still work, nothing is reported as no data', () => {
    const pool = addTyped(addPicked(emptyPool(), { n: 1, name: 'Alpha' }), 'Outsider');
    const r = computeResults(pool, lineup, null);
    expect(r.matches.map((m) => m.name)).toEqual(['Alpha']);
    expect(r.recommendations.map((x) => x.name)).toEqual(['Beta', 'Gamma Ray']);
    expect(r.noData).toEqual([]);
  });
});

describe('reason wording', () => {
  it('joins names naturally', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
  it('words outside and lineup reasons', () => {
    expect(reasonText({ reasons: [{ name: 'Dry Cleaning', kind: 'outside' }] })).toBe('because you like Dry Cleaning');
    expect(reasonText({ reasons: [{ name: 'Loathe', kind: 'outside' }, { name: 'Deftones', kind: 'outside' }, { name: 'Jawbox', kind: 'lineup' }] })).toBe(
      'because you like Loathe, Deftones and Jawbox'
    );
    expect(reasonText({ reasons: [{ name: 'Bully', kind: 'lineup' }] })).toBe('because you like Bully, who is also playing');
    expect(reasonText({ reasons: [] })).toBe('');
    expect(reasonText(null)).toBe('');
  });
});

describe('bands', () => {
  const recs = (scores) => scores.map((score, i) => ({ n: i + 1, score, band: score >= 0.5 ? 'strong' : score >= 0.25 ? 'good' : 'worth-a-listen' }));
  it('groups by absolute band in order, leaving out empty groups', () => {
    const g = groupByBand(recs([0.9, 0.3, 0.12]));
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Strong match', 1], ['Good match', 1], ['Worth a listen', 1]]);
    expect(groupByBand(recs([0.3, 0.26])).map((x) => x.band)).toEqual(['good']);
  });
  it('switches to rank bands only for a large, saturated pool', () => {
    const saturated = recs(Array.from({ length: 30 }, () => 0.9));
    expect(useRelativeBands(LARGE_POOL - 1, saturated)).toBe(false);
    expect(useRelativeBands(LARGE_POOL, saturated)).toBe(true);
    expect(useRelativeBands(5000, recs([0.9, 0.9, 0.3]))).toBe(false);
    const g = groupByBand(saturated, { relative: true });
    expect(g.map((x) => x.items.length)).toEqual([RELATIVE_STRONG, 10, 10]);
  });
});

describe('listen links', () => {
  it('uses the chosen service: "Listen" when verified, "Search on X" otherwise; the rest go under more', () => {
    const a = lineup.byN(1);
    const sp = listenFor(a, 'spotify');
    expect(sp.primary).toMatchObject({ platform: 'spotify', kind: 'verified', text: 'Listen', url: 'https://open.spotify.com/artist/sp1' });
    expect(sp.others.map((l) => l.text)).toEqual(['Search on Apple Music', 'Listen on Tidal', 'Search on Bandcamp']);
    const bc = listenFor(a, 'bandcamp');
    expect(bc.primary).toMatchObject({ kind: 'search', text: 'Search on Bandcamp' });
    expect(bc.primary.url).toBe('https://bandcamp.com/search?q=Alpha&item_type=b');
  });
});

describe('similar lineup artists', () => {
  it('labels the signal', () => {
    expect(signalLabel('direct')).toBe('similar listeners');
    expect(signalLabel('neighbours')).toBe('similar listeners');
    expect(signalLabel('tags')).toBe('similar tags');
    expect(similarFor(1, lineup).map((s) => [s.name, s.label])).toEqual([['Beta', 'similar listeners'], ['Gamma Ray', 'similar tags']]);
  });
});

describe('share', () => {
  it('shares lineup picks from both lists only, never the pool', () => {
    const picks = sharePicks([{ n: 3 }, { n: 1 }], [{ n: 2 }, { n: 1 }]);
    expect(picks).toEqual([1, 2, 3]);
    const url = shareUrl('https://spotifort.com', 2030, picks);
    expect(url).toMatch(/^https:\/\/spotifort\.com\/#s=2030\./);
    expect(decodeShare(url.slice(url.indexOf('#')), lineup).picks).toEqual([1, 2, 3]);
    expect(shareUrl('https://spotifort.com', 2030, [])).toBeNull();
  });
  it('reads a valid fragment into lineup artists sorted by name; ignores invalid or empty ones', () => {
    const hash = new URL(shareUrl('https://x.test', 2030, [3, 2])).hash;
    expect(sharedFromHash(hash, lineup).artists.map((a) => a.name)).toEqual(['Beta', 'Gamma Ray']);
    expect(sharedFromHash('#s=2029.Bg', lineup)).toBeNull(); // wrong year
    expect(sharedFromHash('#s=2030.!!', lineup)).toBeNull();
    expect(sharedFromHash('#s=2030.', lineup)).toBeNull(); // valid but empty
    expect(sharedFromHash('', lineup)).toBeNull();
  });
});

describe('diagnostics', () => {
  it('summarises pool size, contributors and the score distribution', () => {
    const pool = addTyped(addTyped(emptyPool(), 'Outsider'), 'Gamma Rays Tribute');
    const d = diagnostics(pool, computeResults(pool, lineup, sim));
    expect(d).toMatchObject({ poolSize: 2, contributors: 2, candidates: 3, max: 0.5, bands: { strong: 1, good: 1, worth: 1 }, relative: false });
    expect(d.min).toBeCloseTo(0.2);
    expect(diagnostics(emptyPool(), { recommendations: [], stats: { scores: [], contributors: 0 } })).toMatchObject({ min: null, median: null, max: null });
  });
});

describe('import summary', () => {
  it('counts pool entries from the source, not imported items (artists sharing a name merge)', () => {
    const items = [
      { name: 'Same Name', ids: { spotify: 'aaaaaaaaaaaaaaaaaaaaaa' }, weight: 0.4 },
      { name: 'same name', ids: { spotify: 'bbbbbbbbbbbbbbbbbbbbbb' }, weight: 0.5 },
      { name: 'Other', ids: { spotify: 'cccccccccccccccccccccc' }, weight: 0.4 },
    ];
    const pool = addBatch(emptyPool(), 'spotify', items);
    expect(libraryCount(pool, 'spotify')).toBe(2);
    expect(libraryCount(pool, 'tidal')).toBe(0);
    expect(poolChips(pool).libraries[0].count).toBe(libraryCount(pool, 'spotify'));
  });
  it('names only the parts that were read', () => {
    expect(importSummaryText({ count: 1406, songs: 2998 })).toBe('Imported 1,406 artists from 2,998 liked songs, your top artists and the artists you follow.');
    expect(importSummaryText({ count: 5, songs: 1, missing: ['top artists'] })).toBe(
      'Imported 5 artists from 1 liked song and the artists you follow. Your top artists could not be read, so they were left out.');
    expect(importSummaryText({ count: 1, songs: 10, missing: ['top artists', 'followed artists'] })).toBe(
      'Imported 1 artist from 10 liked songs. Your top artists and followed artists could not be read, so they were left out.');
    expect(importSummaryText({ count: 0, songs: 0 })).toBe('Your Spotify library had no artists to add.');
  });
});
