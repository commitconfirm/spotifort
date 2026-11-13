import { describe, it, expect } from 'vitest';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { normalizeName } from '../src/core/normalize.js';
import { realLineup, realSimilarity, similarityJson } from './helpers/real-data.js';

const smallSim = prepareSimilarity({
  minMatch: 0.1,
  names: ['Big Thief', 'Bigger Than Life', 'Cabin Big', 'Sia', 'The Beatles', 'Tom Big Smith', 'Zebra'],
  edges: [[17, 70, 4, 22], [1, 11], [], [3, 50], [], [], [9, 100]],
});

describe('prepareSimilarity', () => {
  it('looks up edges by normalised key with scores back in 0..1', () => {
    expect(smallSim.edgesFor('big thief')).toEqual([{ n: 17, score: 0.7 }, { n: 4, score: 0.22 }]);
    expect(smallSim.edgesFor('nobody')).toEqual([]);
    expect(smallSim.has('beatles')).toBe(true); // leading "the" dropped by the shared normaliser
    expect(smallSim.nameFor('beatles')).toBe('The Beatles');
    expect(smallSim.nameFor('nobody')).toBeNull();
    expect(smallSim.minMatch).toBe(0.1);
    expect(smallSim.size).toBe(7);
  });
  it('searches prefix first (shorter, then alphabetical), then word-prefix, then substring', () => {
    expect(smallSim.search('big').map((h) => h.name)).toEqual(['Big Thief', 'Bigger Than Life', 'Cabin Big', 'Tom Big Smith']);
    expect(smallSim.search('BIG ').map((h) => h.key)[0]).toBe('big thief');
  });
  it('orders tiers: prefix, then word start, then inside a word', () => {
    const s = prepareSimilarity({ names: ['Xx Abba', 'Cabal', 'Ab', 'Abc', 'Zab Yy'], edges: [[], [], [], [], []] });
    expect(s.search('ab').map((h) => h.name)).toEqual(['Ab', 'Abc', 'Xx Abba', 'Cabal', 'Zab Yy']);
  });
  it('returns nothing for empty and one-character queries, and respects limit', () => {
    expect(smallSim.search('')).toEqual([]);
    expect(smallSim.search('b')).toEqual([]);
    expect(smallSim.search('  ')).toEqual([]);
    expect(smallSim.search(null)).toEqual([]);
    expect(smallSim.search('big', { limit: 2 })).toHaveLength(2);
    expect(smallSim.search('big', { limit: 0 })).toEqual([]);
  });
  it('rejects structurally wrong data', () => {
    expect(() => prepareSimilarity(null)).toThrow(TypeError);
    expect(() => prepareSimilarity({ names: ['a'], edges: [] })).toThrow(TypeError);
  });
  it('works on the real file: keys unique, search is fast', () => {
    expect(realSimilarity.size).toBe(similarityJson.names.length);
    const t = performance.now();
    for (const q of ['ph', 'zach', 'the', 'big th', 'mo', 'ñ']) realSimilarity.search(q, { limit: 8 });
    expect(performance.now() - t).toBeLessThan(200);
    expect(realSimilarity.search('phoebe b')[0].name).toBe('Phoebe Bridgers');
  });
  it('ranks by lineup connections within a tier: targets, then best score, then length, then alphabet', () => {
    const s = prepareSimilarity({
      names: ['Zed Few', 'Zed', 'Zed Best', 'Zed Many', 'Zed Tie B', 'Zed Tie A', 'Xx Zed Many', 'Aa Zedx'],
      edges: [[1, 90], [], [1, 99], [1, 10, 2, 10, 3, 10], [1, 50], [1, 50], [1, 10, 2, 10, 3, 10, 4, 10], []],
    });
    // tiers still win over rank: the heavily connected word-prefix hit stays behind every whole-name prefix hit
    expect(s.search('zed').map((h) => h.name)).toEqual(['Zed Many', 'Zed Best', 'Zed Few', 'Zed Tie A', 'Zed Tie B', 'Zed', 'Xx Zed Many', 'Aa Zedx']);
  });
  it('real data: the well-known artist comes first', () => {
    const first = (q) => realSimilarity.search(q, { limit: 8 })[0].name;
    expect(first('wax')).toBe('Waxahatchee');
    expect(first('big')).toBe('Big Thief');
    expect(first('phoebe')).toBe('Phoebe Bridgers');
  });
  it('stays fast for ~25,000 names', () => {
    const names = Array.from({ length: 25000 }, (_, i) => `Artist ${i.toString(36)} Band`);
    const big = prepareSimilarity({ names, edges: names.map(() => []) });
    const t = performance.now();
    for (let i = 0; i < 20; i++) big.search('art');
    expect((performance.now() - t) / 20).toBeLessThan(25);
  });
});

describe('prepareLineup', () => {
  const lineup = prepareLineup({
    year: 2030,
    artists: [
      { n: 1, name: 'Alpha', spotifyIds: ['sp1', 'sp1b'], ids: { tidal: 't1' }, tags: ['rock', 'indie'], similar: [[2, 0.5, 'direct'], [99, 0.4, 'tags']] },
      { n: 2, name: 'The Beta & Co', spotifyIds: [], tags: ['rock'], similar: [] },
      { n: 5, name: 'Alphabet Soup', tags: ['pop'] },
      { n: 'x', name: 'Broken' },
    ],
  });
  it('looks up by n, every Spotify id, platform id and normalised name', () => {
    expect(lineup.byN(1).name).toBe('Alpha');
    expect(lineup.bySpotifyId('sp1b').n).toBe(1);
    expect(lineup.bySpotifyId('nope')).toBeUndefined();
    expect(lineup.byPlatformId('tidal', 't1').n).toBe(1);
    expect(lineup.byPlatformId('tidal', 'zz')).toBeUndefined();
    expect(lineup.byKey(normalizeName('Beta and Co')).n).toBe(2);
    expect(lineup.keyOf(2)).toBe('beta and co');
    expect(lineup.artists).toHaveLength(3); // malformed record skipped
  });
  it('gives neighbours as { n, score, signal }, dropping unknown n', () => {
    expect(lineup.neighbours(1)).toEqual([{ n: 2, score: 0.5, signal: 'direct' }]);
    expect(lineup.neighbours(2)).toEqual([]);
    expect(lineup.neighbours(777)).toEqual([]);
  });
  it('searches with the same ordering rules', () => {
    expect(lineup.search('alp').map((h) => h.name)).toEqual(['Alpha', 'Alphabet Soup']);
    expect(lineup.search('a')).toEqual([]);
    expect(lineup.search('co')[0].name).toBe('The Beta & Co');
  });
  it('counts tags, most common first', () => {
    expect(lineup.tags).toEqual([{ tag: 'rock', count: 2 }, { tag: 'indie', count: 1 }, { tag: 'pop', count: 1 }]);
  });
  it('rejects data without artists', () => {
    expect(() => prepareLineup({})).toThrow(TypeError);
  });
  it('indexes the real lineup', () => {
    expect(realLineup.artists.length).toBeGreaterThan(150);
    const bully = realLineup.byKey('bully');
    expect(bully).toBeDefined();
    expect(realLineup.neighbours(bully.n).length).toBeGreaterThan(3);
    expect(realLineup.bySpotifyId(bully.spotifyIds[0]).n).toBe(bully.n);
  });
});
