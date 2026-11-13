import { describe, it, expect } from 'vitest';
import { indexOverrides, overrideFor, unusedOverrides, validateOverrides } from '../scripts/lib/overrides.js';

const ID = '6hhmxPotJ2kCsQjUGPtH14';

describe('validateOverrides', () => {
  it('accepts unverified only as true', () => {
    expect(validateOverrides({ A: { unverified: false } }).join()).toMatch(/unverified must be true/);
    expect(validateOverrides({ A: { unverified: 'yes' } }).join()).toMatch(/unverified must be true/);
  });
  it('accepts the documented fields', () => {
    expect(validateOverrides({
      Barbara: { spotifyIds: [ID], note: 'x' },
      PLAYDEAD: { spotifyIds: [ID], lastfmName: null, unverified: true, note: 'y' },
      X: { mbid: '12345678-1234-1234-1234-123456789abc', links: { bandcamp: 'https://x.bandcamp.com/', tidal: null }, ids: { tidal: '1' }, tags: ['punk'] },
    })).toEqual([]);
  });
  it('rejects unknown fields, bad ids, bad urls and wrong types', () => {
    const p = validateOverrides({
      A: { spotifyId: ID },
      B: { spotifyIds: ['short'] },
      C: { links: { bandcamp: 'http://x.bandcamp.com/' } },
      D: { links: { myspace: 'https://myspace.com/x' } },
      E: { lastfmName: '' },
      F: { mbid: 'nope' },
      G: 'string',
    }).join('\n');
    expect(p).toMatch(/A: unknown field "spotifyId"/);
    expect(p).toMatch(/B: spotifyIds/);
    expect(p).toMatch(/C: links.bandcamp/);
    expect(p).toMatch(/D: links: unknown platform/);
    expect(p).toMatch(/E: lastfmName/);
    expect(p).toMatch(/F: mbid/);
    expect(p).toMatch(/G: must be an object/);
  });
  it('flags two keys that are the same artist after normalisation', () => {
    expect(validateOverrides({ 'Foo & Bar': {}, 'the foo and bar': {} }).join()).toMatch(/duplicates/);
  });
});

describe('overrideFor / unusedOverrides', () => {
  const idx = indexOverrides({ 'Mabe Fratti & Bill Orcutt': { note: 'duo' }, Typo: { note: 'x' } });
  it('finds an override by exact or cosmetically different name', () => {
    expect(overrideFor(idx, 'Mabe Fratti & Bill Orcutt')).toEqual({ note: 'duo' });
    expect(overrideFor(idx, 'Mabe Fratti and Bill Orcutt')).toEqual({ note: 'duo' });
    expect(overrideFor(idx, 'Somebody')).toEqual({});
  });
  it('reports overrides that match no artist', () => {
    expect(unusedOverrides(idx, [{ name: 'Mabe Fratti & Bill Orcutt' }, { name: 'Other' }])).toEqual(['Typo']);
  });
});
