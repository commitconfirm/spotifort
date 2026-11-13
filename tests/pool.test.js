import { describe, it, expect } from 'vitest';
import {
  emptyPool, addTyped, addPicked, addBatch, removeEntry, clearSource, serialise, deserialise,
  topArtistWeight, likedSongsWeight, followedWeight, MAX_POOL_ENTRIES,
} from '../src/core/pool.js';

describe('weights', () => {
  it('typed 1.0, followed 0.7', () => {
    expect(addTyped(emptyPool(), 'X').entries[0].weight).toBe(1);
    expect(followedWeight()).toBe(0.7);
  });
  it('top artists fall linearly from 1.0 to 0.6', () => {
    expect(topArtistWeight(0, 50)).toBe(1);
    expect(topArtistWeight(49, 50)).toBeCloseTo(0.6);
    expect(topArtistWeight(25, 51)).toBeCloseTo(0.8);
    expect(topArtistWeight(0, 1)).toBe(1);
    expect(topArtistWeight(999, 50)).toBeCloseTo(0.6);
  });
  it('liked songs: min(1, 0.4 + 0.2 log2(1 + count))', () => {
    expect(likedSongsWeight(1)).toBeCloseTo(0.6);
    expect(likedSongsWeight(3)).toBeCloseTo(0.8);
    expect(likedSongsWeight(7)).toBeCloseTo(1);
    expect(likedSongsWeight(500)).toBe(1);
    expect(likedSongsWeight(0)).toBeCloseTo(0.4);
    expect(likedSongsWeight(-5)).toBeCloseTo(0.4);
    expect(likedSongsWeight(NaN)).toBeCloseTo(0.4);
  });
});

describe('pool', () => {
  it('adds typed artists by display name, keyed by normalised name; blank names are ignored', () => {
    let p = addTyped(emptyPool(), '  The  Beatles ');
    expect(p.entries).toEqual([{ key: 'beatles', name: 'The Beatles', weight: 1, sources: ['typed'], sourceWeights: { typed: 1 }, ids: {} }]);
    expect(addTyped(p, '   ')).toBe(p);
    expect(addTyped(p, 'x'.repeat(500))).toBe(p);
    expect(addTyped(p, 42)).toBe(p);
  });
  it('does not mutate its input', () => {
    const p = emptyPool();
    addTyped(p, 'A');
    expect(p.entries).toEqual([]);
  });
  it('adds picked lineup artists by n', () => {
    const p = addPicked(emptyPool(), { n: 12, name: 'Bully' });
    expect(p.entries[0]).toMatchObject({ key: 'bully', n: 12, sources: ['picked'] });
    expect(addPicked(emptyPool(), { name: 'No n' }).entries).toEqual([]);
  });
  it('adds a library batch with ids and weights, skipping malformed items', () => {
    const p = addBatch(emptyPool(), 'spotify:liked', [
      { name: 'Wilco', ids: { spotify: '0abcDEF123' }, weight: 0.8 },
      { name: '', weight: 1 },
      { name: 'NoWeight' },
      { name: 'TooHeavy', weight: 7 },
      { name: 'Bad Id', ids: { spotify: 'a b!', bogus: 'x' }, weight: 0.5 },
      null,
    ]);
    expect(p.entries.map((e) => e.name)).toEqual(['Wilco', 'Bad Id']);
    expect(p.entries[0].ids).toEqual({ spotify: '0abcDEF123' });
    expect(p.entries[1].ids).toEqual({});
    expect(addBatch(p, 'spotify:liked', 'nope')).toBe(p);
    expect(addBatch(p, 'bad source!', [{ name: 'A', weight: 1 }]).entries).toHaveLength(2);
  });
  it('merges duplicates by key: all sources, highest weight, ids kept', () => {
    let p = addBatch(emptyPool(), 'spotify:liked', [{ name: 'Big Thief', ids: { spotify: 'abc' }, weight: 0.6 }]);
    p = addBatch(p, 'spotify:top', [{ name: 'big thief', weight: 0.9 }]);
    p = addTyped(p, 'BIG THIEF');
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ weight: 1, ids: { spotify: 'abc' }, name: 'Big Thief' });
    expect(p.entries[0].sources.sort()).toEqual(['spotify:liked', 'spotify:top', 'typed']);
  });
  it('a pick merging into a typed entry keeps n and takes the lineup spelling', () => {
    let p = addTyped(emptyPool(), 'bully');
    p = addPicked(p, { n: 12, name: 'Bully' });
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ n: 12, name: 'Bully' });
  });
  it('removes an entry and clears a source (re-weighting what remains)', () => {
    let p = addBatch(emptyPool(), 'spotify:liked', [{ name: 'A', weight: 0.6 }, { name: 'B', weight: 0.6 }]);
    p = addBatch(p, 'spotify:top', [{ name: 'A', weight: 0.9 }]);
    expect(removeEntry(p, 'b').entries.map((e) => e.name)).toEqual(['A']);
    const cleared = clearSource(p, 'spotify:top');
    expect(cleared.entries.map((e) => [e.name, e.weight, e.sources])).toEqual([['A', 0.6, ['spotify:liked']], ['B', 0.6, ['spotify:liked']]]);
    expect(clearSource(cleared, 'spotify:liked').entries).toEqual([]);
    expect(clearSource(p, 'nothing')).toEqual(p);
  });
  it('caps the pool, keeping the highest-weight library items', () => {
    const items = Array.from({ length: MAX_POOL_ENTRIES + 50 }, (_, i) => ({ name: `Artist ${i}`, weight: i < 10 ? 1 : 0.5 }));
    const p = addBatch(emptyPool(), 'spotify:liked', items);
    expect(p.entries).toHaveLength(MAX_POOL_ENTRIES);
    expect(p.entries.slice(0, 10).every((e) => e.weight === 1)).toBe(true);
    // merges still work at the cap
    expect(addTyped(p, 'Artist 3').entries).toHaveLength(MAX_POOL_ENTRIES);
    expect(addTyped(p, 'Brand New').entries).toHaveLength(MAX_POOL_ENTRIES);
  });
});

describe('serialise / deserialise', () => {
  it('round-trips', () => {
    let p = addBatch(emptyPool(), 'spotify:liked', [{ name: 'Wilco', ids: { spotify: 'abc123' }, weight: 0.8 }]);
    p = addTyped(p, 'Wilco');
    p = addPicked(p, { n: 12, name: 'Bully' });
    const text = serialise(p);
    expect(JSON.parse(text).v).toBe(1);
    expect(deserialise(text)).toEqual(p);
  });
  it('never throws and drops anything malformed', () => {
    for (const bad of [undefined, null, 5, '', 'not json', '{', '[]', '{"v":2,"entries":[]}', '{"v":1}', '{"v":1,"entries":5}', 'x'.repeat(3_000_000)]) {
      expect(deserialise(bad)).toEqual(emptyPool());
    }
    const text = JSON.stringify({
      v: 1,
      entries: [
        { name: 'Good', sw: { typed: 1 } },
        { name: '', sw: { typed: 1 } },
        { name: 'NoWeights' },
        { name: 'BadWeight', sw: { typed: 'heavy' } },
        { name: 'Negative', sw: { typed: -3 } },
        { name: 'BadSource', sw: { 'no good!': 1 } },
        { name: 'Ids', sw: { typed: 1 }, ids: { spotify: '<script>', tidal: '123' }, n: 'x' },
        { name: 'Proto', sw: { typed: 1 }, ids: { __proto__: { spotify: 'abc' } } },
        'string', null, 7,
        { name: 'Good', sw: { 'spotify:top': 0.7 } },
      ],
    });
    const p = deserialise(text);
    expect(p.entries.map((e) => e.name)).toEqual(['Good', 'Ids', 'Proto']);
    const good = p.entries.find((e) => e.name === 'Good');
    expect(good.sources.sort()).toEqual(['spotify:top', 'typed']);
    expect(good.weight).toBe(1);
    expect(p.entries.find((e) => e.name === 'Ids')).toMatchObject({ ids: { tidal: '123' } });
    expect(p.entries.find((e) => e.name === 'Ids').n).toBeUndefined();
    expect({}.spotify).toBeUndefined(); // prototype untouched
  });
  it('recomputes keys and does not trust a stored key or weight', () => {
    const p = deserialise(JSON.stringify({ v: 1, entries: [{ name: 'The Band', key: 'evil', weight: 99, sw: { typed: 0.5 } }] }));
    expect(p.entries[0]).toMatchObject({ key: 'band', weight: 0.5 });
  });
  it('caps entries on load', () => {
    const entries = Array.from({ length: MAX_POOL_ENTRIES + 100 }, (_, i) => ({ name: `A${i}`, sw: { typed: 1 } }));
    expect(deserialise(JSON.stringify({ v: 1, entries })).entries).toHaveLength(MAX_POOL_ENTRIES);
  });
});
