import { describe, it, expect } from 'vitest';
import {
  NOT_FOUND,
  buildLastfmRecord,
  classifyNameChange,
  parseInfo,
  parseSimilar,
  parseTags,
  skippedLastfmRecord,
} from '../scripts/lib/lastfm.js';
import { lastfmClassify } from '../scripts/lib/http.js';

describe('parseInfo', () => {
  it('reads name, listeners and url', () => {
    expect(parseInfo({ artist: { name: 'Ratboy', url: 'https://www.last.fm/music/Ratboy', stats: { listeners: '2813' } } }))
      .toEqual({ resolvedName: 'Ratboy', listeners: 2813, url: 'https://www.last.fm/music/Ratboy' });
  });
  it('treats error 6 as not found and anything else odd as an exception', () => {
    expect(parseInfo({ error: 6, message: 'The artist you supplied could not be found' })).toBe(NOT_FOUND);
    expect(() => parseInfo({ error: 29 })).toThrow();
    expect(() => parseInfo({})).toThrow();
  });
});

describe('parseSimilar', () => {
  it('returns [name, match] rounded to 3 places in order', () => {
    expect(parseSimilar({ similarartists: { artist: [{ name: 'A', match: '1' }, { name: 'B', match: '0.699999988079071' }] } }))
      .toEqual([['A', 1], ['B', 0.7]]);
  });
  it('accepts the single-object form and the empty form', () => {
    expect(parseSimilar({ similarartists: { artist: { name: 'A', match: '0.5' } } })).toEqual([['A', 0.5]]);
    expect(parseSimilar({ similarartists: { '@attr': { artist: 'X' } } })).toEqual([]);
    expect(parseSimilar({ error: 6 })).toEqual([]);
  });
  it('skips malformed entries and keeps the higher match for a repeated name', () => {
    expect(parseSimilar({ similarartists: { artist: [{ name: 'A', match: '0.2' }, { name: 'A', match: '0.9' }, { match: '1' }, { name: 'B', match: 'x' }] } }))
      .toEqual([['A', 0.9]]);
  });
  it('limits to 250', () => {
    const artist = Array.from({ length: 300 }, (_, i) => ({ name: `a${i}`, match: '0.5' }));
    expect(parseSimilar({ similarartists: { artist } })).toHaveLength(250);
  });
});

describe('parseTags', () => {
  const body = { toptags: { tag: [
    { name: 'Indie Rock', count: 100 }, { name: 'USA', count: 50 }, { name: 'seen live', count: 40 },
    { name: 'shoegaze', count: 9 }, { name: 'Ratboys', count: 30 }, { name: 'indie rock', count: 20 }, { name: 'punk', count: 10 },
  ] } };
  it('keeps count >= 10, lowercases, removes non-genre tags and the artist name, dedupes', () => {
    expect(parseTags(body, ['Ratboys'])).toEqual([['indie rock', 100], ['punk', 10]]);
  });
  it('handles a single tag object and errors', () => {
    expect(parseTags({ toptags: { tag: { name: 'folk', count: 50 } } })).toEqual([['folk', 50]]);
    expect(parseTags({ error: 6 })).toEqual([]);
  });
});

describe('classifyNameChange', () => {
  it('no / cosmetic / different', () => {
    expect(classifyNameChange('Ratboys', 'Ratboys')).toBe('no');
    expect(classifyNameChange('PLAYDEAD', 'Playdead')).toBe('cosmetic');
    expect(classifyNameChange('Mo Lowda & The Humble', 'Mo Lowda and the Humble')).toBe('cosmetic');
    expect(classifyNameChange('The Notwist', 'Notwist')).toBe('cosmetic');
    expect(classifyNameChange('Ratboys', 'Ratboy')).toBe('different');
    expect(classifyNameChange('Sunbloc', 'Sunblock')).toBe('different');
    expect(classifyNameChange('PLAYDEAD', 'Play Dead')).toBe('different');
  });
});

describe('buildLastfmRecord', () => {
  const info = { artist: { name: 'Ratboy', url: 'https://www.last.fm/music/Ratboy', stats: { listeners: '10' } } };
  it('assembles the record and flags the name change', () => {
    const r = buildLastfmRecord('Ratboys', {
      info,
      similar: { similarartists: { artist: [{ name: 'Wild Pink', match: '0.8' }] } },
      tags: { toptags: { tag: [{ name: 'indie rock', count: 100 }] } },
    });
    expect(r).toMatchObject({ queriedName: 'Ratboys', resolvedName: 'Ratboy', nameChanged: 'different', listeners: 10, similar: [['Wild Pink', 0.8]], tags: [['indie rock', 100]] });
  });
  it('records not found without inventing data', () => {
    const r = buildLastfmRecord('Nobody', { info: { error: 6 } });
    expect(r).toMatchObject({ notFound: true, resolvedName: null, similar: [], tags: [] });
  });
  it('has a skipped form for overrides', () => {
    expect(skippedLastfmRecord()).toMatchObject({ skipped: true, queriedName: null, similar: [] });
  });
});

describe('lastfmClassify', () => {
  it('maps responses to ok / retry / fail', () => {
    expect(lastfmClassify(200, { artist: {} })).toBe('ok');
    expect(lastfmClassify(404, { error: 6 })).toBe('ok');
    expect(lastfmClassify(200, { error: 29 })).toBe('retry');
    expect(lastfmClassify(500, { error: 11 })).toBe('retry');
    expect(lastfmClassify(200, null)).toBe('retry');
    expect(lastfmClassify(403, { error: 10 })).toBe('fail');
  });
});
