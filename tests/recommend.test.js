import { describe, it, expect } from 'vitest';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { emptyPool, addTyped, addPicked, addBatch } from '../src/core/pool.js';
import { recommend, recommendByTags, listTags, bandFor, MAX_RECOMMENDATIONS, MIN_SCORE } from '../src/core/recommend.js';
import { realLineup, realSimilarity } from './helpers/real-data.js';

const lineup = prepareLineup({
  year: 2030,
  artists: [
    { n: 1, name: 'Alpha', tags: ['rock', 'indie'], similar: [[2, 0.6, 'direct'], [3, 0.3, 'tags']] },
    { n: 2, name: 'Beta', tags: ['rock'], similar: [[1, 0.6, 'direct']] },
    { n: 3, name: 'Gamma', tags: ['indie', 'folk'], similar: [] },
    { n: 4, name: 'Delta', tags: ['rock', 'indie', 'folk'], similar: [] },
    { n: 5, name: 'Echo', tags: [], similar: [] },
  ],
});
const sim = prepareSimilarity({
  minMatch: 0.1,
  names: ['Outsider One', 'Outsider Two', 'Nobody Close'],
  edges: [[1, 50, 2, 20], [1, 50, 4, 10], []],
});

describe('bandFor', () => {
  it('splits at 0.5 and 0.25', () => {
    expect([0.5, 0.49, 0.25, 0.24, 0.1].map(bandFor)).toEqual(['strong', 'good', 'good', 'worth-a-listen', 'worth-a-listen']);
  });
});

describe('recommend', () => {
  it('applies score = 1 - product(1 - weight * m) across outside artists', () => {
    const pool = addTyped(addTyped(emptyPool(), 'Outsider One'), 'Outsider Two');
    const { recommendations } = recommend(pool, lineup, sim);
    const alpha = recommendations.find((r) => r.name === 'Alpha');
    expect(alpha.score).toBeCloseTo(1 - (1 - 0.5) * (1 - 0.5));
    expect(alpha.band).toBe('strong');
    expect(alpha.reasons.map((r) => [r.name, r.kind])).toEqual([['Outsider One', 'outside'], ['Outsider Two', 'outside']]);
    expect(recommendations.find((r) => r.name === 'Beta').score).toBeCloseTo(0.2);
    // Delta: 0.1 is at the cutoff
    expect(recommendations.find((r) => r.name === 'Delta').score).toBeCloseTo(0.1);
  });
  it('scales a link by the pool weight', () => {
    const pool = addBatch(emptyPool(), 'spotify:liked', [{ name: 'Outsider One', weight: 0.6 }]);
    expect(recommend(pool, lineup, sim).recommendations.find((r) => r.name === 'Alpha').score).toBeCloseTo(0.3);
  });
  it('a pool artist on the lineup contributes through lineup neighbours, and is itself excluded', () => {
    const pool = addPicked(emptyPool(), { n: 1, name: 'Alpha' });
    const { recommendations, noData } = recommend(pool, lineup, sim);
    expect(recommendations.map((r) => r.name)).toEqual(['Beta', 'Gamma']);
    expect(recommendations.map((r) => r.score)).toEqual([expect.closeTo(0.6), expect.closeTo(0.3)]);
    expect(recommendations[0].reasons[0]).toEqual({ name: 'Alpha', contribution: 0.6, kind: 'lineup', signal: 'direct' });
    expect(noData).toEqual([]);
  });
  it('excludes lineup artists the visitor already has, including by name', () => {
    const pool = addTyped(addTyped(emptyPool(), 'Outsider One'), 'beta');
    const names = recommend(pool, lineup, sim).recommendations.map((r) => r.name);
    expect(names).not.toContain('Beta');
    expect(names).toContain('Alpha');
  });
  it('reports pool artists with no data in noData, but not lineup artists', () => {
    const pool = addTyped(addTyped(addTyped(emptyPool(), 'Nobody Close'), 'Metallica'), 'Echo');
    const { recommendations, noData } = recommend(pool, lineup, sim);
    expect(recommendations).toEqual([]);
    expect(noData.map((e) => e.name)).toEqual(['Nobody Close', 'Metallica']);
  });
  it('keeps at most three reasons, strongest first', () => {
    const outsiders = ['A1', 'A2', 'A3', 'A4'];
    const s = prepareSimilarity({ names: outsiders, edges: [[1, 20], [1, 40], [1, 30], [1, 10]] });
    let pool = emptyPool();
    for (const n of outsiders) pool = addTyped(pool, n);
    const [r] = recommend(pool, lineup, s).recommendations;
    expect(r.reasons.map((x) => x.name)).toEqual(['A2', 'A3', 'A1']);
  });
  it('drops scores under the cutoff and caps the list', () => {
    const weak = recommend(addBatch(emptyPool(), 's', [{ name: 'Outsider One', weight: 0.1 }]), lineup, sim);
    expect(weak.recommendations).toEqual([]);
    const names = Array.from({ length: 80 }, (_, i) => `Target ${i}`);
    const artists = names.map((name, i) => ({ n: i + 1, name, similar: [] }));
    const big = prepareLineup({ year: 1, artists });
    const s = prepareSimilarity({ names: ['Src'], edges: [artists.flatMap((a, i) => [a.n, 40 + (i % 50)])] });
    const out = recommend(addTyped(emptyPool(), 'Src'), big, s).recommendations;
    expect(out).toHaveLength(MAX_RECOMMENDATIONS);
    expect(out.every((r) => r.score >= MIN_SCORE)).toBe(true);
  });
  it('orders deterministically: score desc, then name', () => {
    const l = prepareLineup({ year: 1, artists: [{ n: 1, name: 'Zed' }, { n: 2, name: 'Abe' }, { n: 3, name: 'Mid' }] });
    const s = prepareSimilarity({ names: ['Src'], edges: [[1, 50, 2, 50, 3, 60]] });
    const names = recommend(addTyped(emptyPool(), 'Src'), l, s).recommendations.map((r) => r.name);
    expect(names).toEqual(['Mid', 'Abe', 'Zed']);
  });
  it('is real-data sane: Phoebe Bridgers has strong lineup neighbours', () => {
    const { recommendations } = recommend(addTyped(emptyPool(), 'Phoebe Bridgers'), realLineup, realSimilarity);
    expect(recommendations.length).toBeGreaterThan(5);
    expect(recommendations[0].reasons[0].name).toBe('Phoebe Bridgers');
  });
  it('handles a 1,500-entry pool in well under 50 ms', () => {
    // deterministic synthetic pool drawn from the real index
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pickedNames = new Set();
    const allNames = [];
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') for (const h of realSimilarity.search(letter + 'a', { limit: 200 })) if (!pickedNames.has(h.key)) (pickedNames.add(h.key), allNames.push(h.name));
    let pool = emptyPool();
    while (pool.entries.length < 1500 && allNames.length) pool = addBatch(pool, 'spotify:liked', [{ name: allNames.splice(Math.floor(rand() * allNames.length), 1)[0], weight: 0.4 + rand() * 0.6 }]);
    expect(pool.entries.length).toBeGreaterThan(1000);
    recommend(pool, realLineup, realSimilarity); // warm up
    const t = performance.now();
    const runs = 5;
    for (let i = 0; i < runs; i++) recommend(pool, realLineup, realSimilarity);
    const per = (performance.now() - t) / runs;
    console.log(`recommend: ${pool.entries.length}-entry pool, ${per.toFixed(2)} ms per call`);
    expect(per).toBeLessThan(50);
  });
});

describe('tags', () => {
  it('lists tags with artist counts, most common first', () => {
    expect(listTags(lineup)).toEqual([{ tag: 'indie', count: 3 }, { tag: 'rock', count: 3 }, { tag: 'folk', count: 2 }]);
  });
  it('ranks by IDF-weighted overlap with the chosen tags', () => {
    const r = recommendByTags(['folk', 'indie'], lineup);
    expect(r.map((x) => x.name)).toEqual(['Delta', 'Gamma', 'Alpha']);
    expect(r[0].score).toBeCloseTo(1);
    expect(r[1].score).toBeCloseTo(1);
    expect(r[0].matched.sort()).toEqual(['folk', 'indie']);
    // the rarer tag counts for more than the common one
    const solo = recommendByTags(['folk', 'rock'], lineup);
    expect(solo[0].name).toBe('Delta');
  });
  it('ignores unknown tags and junk input', () => {
    expect(recommendByTags(['nonsense'], lineup)).toEqual([]);
    expect(recommendByTags([], lineup)).toEqual([]);
    expect(recommendByTags(null, lineup)).toEqual([]);
    expect(recommendByTags([5, null, 'folk'], lineup).map((x) => x.name)).toEqual(['Delta', 'Gamma']);
  });
  it('works on the real lineup', () => {
    const tags = listTags(realLineup);
    expect(tags.length).toBeGreaterThan(20);
    const r = recommendByTags([tags[3].tag, tags[10].tag], realLineup);
    expect(r.length).toBeGreaterThan(0);
  });
});
