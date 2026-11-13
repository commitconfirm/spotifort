import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import { formatCompactLines } from '../scripts/lib/json-format.js';
import {
  buildReverseIndex,
  fitReverseIndex,
  combineSignals,
  computeLineupSimilarity,
  cosine,
  dominantSignal,
  idfWeights,
  similarVector,
  tagVector,
} from '../scripts/lib/similarity.js';

const V = (o) => new Map(Object.entries(o));
const close = (a, b, p = 4) => expect(a).toBeCloseTo(b, p);

describe('similarVector', () => {
  it('normalises names, keeps the higher match on collisions, drops own names', () => {
    const v = similarVector([['Foo & Bar', 0.4], ['Foo and Bar', 0.9], ['The Self', 1], ['Other', 0.2]], ['self']);
    expect([...v]).toEqual([['foo and bar', 0.9], ['other', 0.2]]);
  });
});

describe('cosine', () => {
  it('is 0.5 for two unit-weight vectors sharing one of two keys', () => {
    close(cosine(V({ x: 1, y: 1 }), V({ x: 1, z: 1 })), 0.5);
  });
  it('is weighted by match: 0.5 / sqrt(1.25) for {x:.5,y:1} vs {x:1}', () => {
    close(cosine(V({ x: 0.5, y: 1 }), V({ x: 1 })), 0.5 / Math.sqrt(1.25));
  });
  it('is 1 for identical direction and 0 for disjoint or empty vectors', () => {
    close(cosine(V({ x: 2, y: 4 }), V({ x: 1, y: 2 })), 1);
    expect(cosine(V({ x: 1 }), V({ y: 1 }))).toBe(0);
    expect(cosine(V({}), V({ y: 1 }))).toBe(0);
  });
});

describe('idfWeights / tagVector', () => {
  const lists = [[['a', 100], ['b', 100]], [['a', 50]], [['c', 100]]];
  it('is ln(1 + N/df): common tags weigh less than rare ones', () => {
    const idf = idfWeights(lists);
    close(idf.get('a'), Math.log(2.5)); // N=3, df=2
    close(idf.get('b'), Math.log(4)); // df=1
    expect(idf.get('b')).toBeGreaterThan(idf.get('a'));
  });
  it('weights each tag by count/100 * idf', () => {
    const idf = idfWeights(lists);
    const v = tagVector([['a', 50]], idf);
    close(v.get('a'), 0.5 * Math.log(2.5));
  });
  it('gives tag cosine 1/sqrt(2) when one artist has two equal-idf tags and the other has one', () => {
    const l = [[['indie', 100], ['rare', 100]], [['indie', 100]], [['rare', 100]]]; // df 2 and 2
    const idf = idfWeights(l);
    close(cosine(tagVector(l[0], idf), tagVector(l[1], idf)), Math.SQRT1_2);
  });
});

describe('combineSignals', () => {
  it('is 1 - (1-d)(1-wN*g)(1-wT*t): hand-computed 1 - 0.5*0.65*0.92 = 0.701', () => {
    close(combineSignals(0.5, 0.5, 0.2, 0.7, 0.4), 0.701);
  });
  it('is 0 with no signal and 1 with a perfect direct link', () => {
    expect(combineSignals(0, 0, 0)).toBe(0);
    expect(combineSignals(1, 0, 0)).toBe(1);
  });
  it('lets many weak signals add up without exceeding 1', () => {
    expect(combineSignals(0.3, 1, 1)).toBeLessThan(1);
    expect(combineSignals(0.3, 1, 1)).toBeGreaterThan(combineSignals(0.3, 0, 0));
  });
});

describe('dominantSignal', () => {
  it('picks the largest weighted contribution', () => {
    expect(dominantSignal(0.6, 0.5, 0, 0.7, 0.4)).toBe('direct'); // 0.6 vs 0.35
    expect(dominantSignal(0.1, 0.9, 0.5, 0.7, 0.4)).toBe('neighbours'); // 0.63 vs 0.2
    expect(dominantSignal(0, 0.1, 0.9, 0.7, 0.4)).toBe('tags'); // 0.07 vs 0.36
  });
  it('breaks ties direct > neighbours > tags', () => {
    expect(dominantSignal(0.4, 0.4 / 0.7, 1, 0.7, 0.4)).toBe('direct');
    expect(dominantSignal(0, 0.4 / 0.7, 1, 0.7, 0.4)).toBe('neighbours');
  });
});

describe('computeLineupSimilarity', () => {
  const art = (n, key, similar, tags = []) => ({ n, name: key, keys: [key], similar, tags });

  it('combines direct and neighbour signals (hand computed)', () => {
    const artists = [
      art(1, 'alpha', [['Beta', 0.6], ['X', 1]]),
      art(2, 'beta', [['X', 1], ['Y', 1]]),
      art(3, 'gamma', [['Z', 1]]),
    ];
    const r = computeLineupSimilarity(artists, { wN: 0.7, wT: 0.4, min: 0.08, limit: 12 });
    // d = 0.6 (alpha lists beta); g = (1) / (sqrt(0.36 + 1) * sqrt(2)) = 0.6063; t = 0
    const g = 1 / (Math.sqrt(1.36) * Math.SQRT2);
    const s = 1 - (1 - 0.6) * (1 - 0.7 * g);
    expect(r.get(1)).toHaveLength(1);
    expect(r.get(1)[0].n).toBe(2);
    close(r.get(1)[0].d, 0.6);
    close(r.get(1)[0].g, g);
    close(r.get(1)[0].s, s);
    expect(r.get(1)[0].signal).toBe('direct');
    expect(r.get(2)[0].n).toBe(1); // symmetric
    expect(r.get(3)).toEqual([]);
  });

  it('uses the higher of A->B and B->A for the direct signal', () => {
    const r = computeLineupSimilarity(
      [art(1, 'a', [['b', 0.2]]), art(2, 'b', [['a', 0.9]])],
      { wN: 0.7, wT: 0.4 }
    );
    close(r.get(1)[0].d, 0.9);
  });

  it('finds a link from tags alone and labels it tags', () => {
    const artists = [
      art(1, 'a', [], [['indie', 100], ['rare', 100]]),
      art(2, 'b', [], [['indie', 100]]),
      art(3, 'c', [], [['rare', 100]]),
    ];
    const r = computeLineupSimilarity(artists, { wN: 0.7, wT: 0.4, min: 0.08 });
    const ab = r.get(1).find((x) => x.n === 2);
    close(ab.t, Math.SQRT1_2);
    close(ab.s, 0.4 * Math.SQRT1_2); // only tags contribute
    expect(ab.signal).toBe('tags');
  });

  it('drops links below the minimum and keeps the best `limit`, ties broken by lower n', () => {
    const artists = [
      art(1, 'a', [['b', 0.5], ['c', 0.5], ['d', 0.5], ['e', 0.01]]),
      art(2, 'b', []), art(3, 'c', []), art(4, 'd', []), art(5, 'e', []),
    ];
    const r = computeLineupSimilarity(artists, { wN: 0.7, wT: 0.4, min: 0.08, limit: 2 });
    expect(r.get(1).map((x) => x.n)).toEqual([2, 3]);
    const all = computeLineupSimilarity(artists, { wN: 0.7, wT: 0.4, min: 0.08, limit: 12 });
    expect(all.get(1).map((x) => x.n)).toEqual([2, 3, 4]); // 'e' at 0.01 is below 0.08
  });

  it('recognises an artist by any of its keys (festival name and Last.fm name)', () => {
    const artists = [
      { n: 1, name: 'Ratboys', keys: ['ratboys', 'ratboy'], similar: [], tags: [] },
      art(2, 'b', [['Ratboy', 0.7]]),
    ];
    close(computeLineupSimilarity(artists).get(2)[0].d, 0.7);
  });
});

describe('buildReverseIndex', () => {
  const art = (n, key, similar) => ({ n, name: key, keys: [key], similar, tags: [] });

  it('excludes lineup artists, drops self references and applies the cutoff', () => {
    const artists = [
      art(1, 'alpha', [['Alpha', 1], ['Beta', 0.9], ['Outside', 0.5], ['Weak', 0.09]]),
      art(2, 'beta', [['Outside', 0.3]]),
    ];
    const r = buildReverseIndex(artists, { minMatch: 0.1 });
    expect(r.keys).toEqual(['outside']);
    expect(r.names).toEqual(['Outside']);
    expect(r.edges).toEqual([[1, 50, 2, 30]]);
  });

  it('merges names that collide after normalisation, keeping the higher score and its spelling', () => {
    const artists = [
      art(1, 'alpha', [['Foo & Bar', 0.4]]),
      art(2, 'beta', [['Foo and Bar', 0.7], ['foo and bar', 0.2]]),
    ];
    const r = buildReverseIndex(artists);
    expect(r.keys).toEqual(['foo and bar']);
    expect(r.names).toEqual(['Foo and Bar']);
    expect(r.edges).toEqual([[2, 70, 1, 40]]);
  });

  it('keeps the higher score when one lineup artist lists the same outside artist twice', () => {
    const r = buildReverseIndex([art(1, 'a', [['X', 0.3], ['x', 0.6]])]);
    expect(r.edges).toEqual([[1, 60]]);
  });

  it('sorts keys by code point and keeps names, keys and edges the same length', () => {
    const r = buildReverseIndex([art(1, 'a', [['Zed', 0.5], ['Äpfel', 0.5], ['Mid', 0.5], ['100 gecs', 0.5]])]);
    expect(r.keys).toEqual(['100 gecs', 'apfel', 'mid', 'zed']);
    expect(r.names).toHaveLength(4);
    expect(r.edges).toHaveLength(4);
  });

  it('treats an alias key (Last.fm name) of a lineup artist as a lineup artist', () => {
    const artists = [{ n: 1, name: 'Ratboys', keys: ['ratboys', 'ratboy'], similar: [], tags: [] }, art(2, 'b', [['Ratboy', 0.8]])];
    expect(buildReverseIndex(artists).keys).toEqual([]);
  });
});

describe('fitReverseIndex (adaptive cutoff ladder)', () => {
  // Deterministic, hard-to-compress names so size tracks the number of entries.
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed.toString(36) + seed.toString(36).split('').reverse().join(''); };
  const synthetic = () => {
    seed = 7;
    const similar = Array.from({ length: 3000 }, (_, i) => [`${noise()} ${i}`, [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.5][i % 7]]);
    return [{ n: 1, name: 'lineup', keys: ['lineup'], similar, tags: [] }];
  };
  const ladder = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3];
  const sizeAt = (artists, m) => fitReverseIndex(artists, { ladder: [m], budget: Infinity }).raw;

  it('uses the first step when it fits', () => {
    const artists = synthetic();
    const r = fitReverseIndex(artists, { ladder, budget: sizeAt(artists, 0.1) });
    expect(r.minMatch).toBe(0.1);
    expect(Object.keys(r.similarity)).toEqual(['minMatch', 'names', 'edges']);
    expect(r.similarity.minMatch).toBe(0.1);
  });

  it('steps up to the first cutoff that fits, no further', () => {
    const artists = synthetic();
    const sizes = ladder.map((m) => sizeAt(artists, m));
    expect(sizes[0]).toBeGreaterThan(sizes[2]);
    const r = fitReverseIndex(artists, { ladder, budget: sizes[2] });
    expect(r.minMatch).toBe(0.15);
    expect(r.raw).toBe(sizes[2]);
    expect(r.similarity.names.length).toBeLessThan(3000);
  });

  it('measures the UTF-8 byte length of the serialised file', () => {
    const artists = synthetic();
    const r = fitReverseIndex(artists, { ladder, budget: Infinity });
    expect(r.raw).toBe(Buffer.byteLength(formatCompactLines(r.similarity)));
  });

  it('is reproducible', () => {
    const artists = synthetic();
    const a = fitReverseIndex(artists, { ladder, budget: 60000 });
    const b = fitReverseIndex(artists, { ladder, budget: 60000 });
    expect(a.minMatch).toBe(b.minMatch);
    expect(a.raw).toBe(b.raw);
  });

  it('does not depend on gzip: the choice is the same when zlib is stubbed to a wild size', () => {
    const artists = synthetic();
    const budget = sizeAt(artists, 0.15);
    const before = fitReverseIndex(artists, { ladder, budget });
    const spy = vi.spyOn(zlib, 'gzipSync').mockImplementation(() => Buffer.alloc(10 ** 9));
    try {
      const during = fitReverseIndex(artists, { ladder, budget });
      expect(during.minMatch).toBe(before.minMatch);
      expect(formatCompactLines(during.similarity)).toBe(formatCompactLines(before.similarity));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('throws a clear error when even the last step does not fit', () => {
    expect(() => fitReverseIndex(synthetic(), { ladder, budget: 10 })).toThrow(/does not fit its 10 byte \(raw\) budget even at the highest cutoff \(0\.3/);
  });
});
