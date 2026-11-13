import { describe, it, expect } from 'vitest';
import {
  parseLineupHtml,
  decodeEntities,
  pickMatch,
  mergeLineup,
  isEnriched,
  parseRetryAfter,
} from '../scripts/lib/lineup-pipeline.js';

const card = (name, cls = 'lineup-artist-name') => `<div class="card"><h3 class="${cls}">${name}</h3></div>`;

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('Beyond &amp; Back &#8211; &#x2019;s &quot;x&quot; &lt;3')).toBe('Beyond & Back – ’s "x" <3');
  });
  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&bogus; &#99999999999;')).toBe('&bogus; &#99999999999;');
  });
});

describe('parseLineupHtml', () => {
  const html = [
    '<h3 class="elementor-heading">Not an artist</h3>',
    card('Modest Mouse'),
    card('Beyond &amp; Back'),
    '<h3 class="x lineup-artist-name y"><span>Nested</span> <b>Tags</b></h3>',
    card('modest mouse'),
    card('  Spaced \n  Out  '),
    card('   '),
  ].join('\n');

  it('extracts only artist cards, decoded, in page order', () => {
    expect(parseLineupHtml(html)).toEqual(['Modest Mouse', 'Beyond & Back', 'Nested Tags', 'Spaced Out']);
  });
  it('de-duplicates case-insensitively keeping the first spelling', () => {
    expect(parseLineupHtml(html)).not.toContain('modest mouse');
  });
  it('returns an empty list for unrelated markup', () => {
    expect(parseLineupHtml('<h3>Hello</h3>')).toEqual([]);
  });
});

describe('mergeLineup', () => {
  const resolved = { name: 'A', spotifyId: 'id1', spotifyUrl: 'u', notOnSpotify: false, genres: [] };
  const notFound = { name: 'B', spotifyId: null, spotifyUrl: null, notOnSpotify: true, genres: [] };
  const unresolved = { name: 'C', spotifyId: null, spotifyUrl: null, notOnSpotify: false, genres: [] };
  const gone = { name: 'Gone', spotifyId: 'id9', spotifyUrl: 'u', notOnSpotify: false, genres: [] };

  it('classifies every case', () => {
    const { kept, toLookup, removed } = mergeLineup([resolved, notFound, unresolved, gone], ['A', 'B', 'C', 'New']);
    expect(kept).toEqual([resolved, notFound]);
    expect(toLookup).toEqual(['C', 'New']);
    expect(removed).toEqual([gone]);
  });
  it('matches names case-insensitively', () => {
    expect(mergeLineup([resolved], ['a']).kept).toEqual([resolved]);
  });
  it('handles no existing file', () => {
    expect(mergeLineup(undefined, ['X'])).toEqual({ kept: [], toLookup: ['X'], removed: [] });
  });
});

describe('isEnriched', () => {
  it('is false while any record is unresolved', () => {
    expect(isEnriched([{ spotifyId: 'a', notOnSpotify: false }, { spotifyId: null, notOnSpotify: false }])).toBe(false);
  });
  it('is true when all are resolved or confirmed not on Spotify', () => {
    expect(isEnriched([{ spotifyId: 'a', notOnSpotify: false }, { spotifyId: null, notOnSpotify: true }])).toBe(true);
  });
});

describe('pickMatch', () => {
  const item = (id, name) => ({ id, name, genres: ['rock'], external_urls: { spotify: `https://open.spotify.com/artist/${id}` } });

  it('returns null for no results', () => {
    expect(pickMatch('X', [])).toBeNull();
    expect(pickMatch('X', undefined)).toBeNull();
  });
  it('prefers an exact case-insensitive match over the top hit', () => {
    const m = pickMatch('Death', [item('1', 'Death Cab'), item('2', 'DEATH')]);
    expect(m.spotifyId).toBe('2');
    expect(m.spotifyName).toBeUndefined();
  });
  it('falls back to the top hit and records spotifyName', () => {
    const m = pickMatch('Porcelain Tongue', [item('1', 'Porcelain Tongues'), item('2', 'Other')]);
    expect(m.spotifyId).toBe('1');
    expect(m.spotifyName).toBe('Porcelain Tongues');
  });
  it('counts exact-name candidates and takes the first', () => {
    const m = pickMatch('Barbara', [item('1', 'Barbara'), item('2', 'barbara'), item('3', 'Barbara Lewis')]);
    expect(m.exactCount).toBe(2);
    expect(m.spotifyId).toBe('1');
  });
  it('exactCount is 1 for a unique exact match and 0 for a fallback', () => {
    expect(pickMatch('Death', [item('1', 'Death Cab'), item('2', 'DEATH')]).exactCount).toBe(1);
    expect(pickMatch('Porcelain Tongue', [item('1', 'Porcelain Tongues')]).exactCount).toBe(0);
  });
  it('builds a URL when external_urls is missing', () => {
    expect(pickMatch('A', [{ id: 'z', name: 'A' }]).spotifyUrl).toBe('https://open.spotify.com/artist/z');
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds', () => expect(parseRetryAfter('7')).toBe(7));
  it('parses HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30);
  });
  it('returns null when absent or invalid', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('mergeLineup preserves hand-corrected records', () => {
  const duo = {
    name: 'Mabe Fratti & Bill Orcutt', spotifyId: 'a', spotifyUrl: 'https://open.spotify.com/artist/a',
    notOnSpotify: false, genres: ['x'], additionalSpotifyIds: ['b'], spotifyName: 'Mabe Fratti', manual: true,
  };
  const manualNone = { name: 'Ghost Act', spotifyId: null, spotifyUrl: null, notOnSpotify: true, genres: [], manual: true, note: 'n' };
  const manualUnresolved = { name: 'Odd', spotifyId: null, spotifyUrl: null, notOnSpotify: false, genres: [], manual: true };

  it('keeps extra fields byte-for-byte and never looks them up', () => {
    const before = JSON.stringify([duo, manualNone, manualUnresolved]);
    const { kept, toLookup } = mergeLineup([duo, manualNone, manualUnresolved], [duo.name, 'Ghost Act', 'Odd']);
    expect(toLookup).toEqual([]);
    expect(JSON.stringify(kept)).toBe(before);
    expect(kept[0]).toBe(duo);
    expect(kept[1]).toBe(manualNone);
  });
});
