import { describe, it, expect } from 'vitest';
import { listenLinks, searchUrl, lastfmUrl, LISTEN_PLATFORMS, isAllowedUrlForAnyPlatform, cleanPlatformUrl } from '../src/core/links.js';
import { realLineup } from './helpers/real-data.js';

const HOSTILE = ['"><script>alert(1)</script>', 'javascript:alert(1)', 'Sigur Rós', '東京事変', 'Mabe Fratti & Bill Orcutt', 'C#', 'AC/DC', "Guns N' Roses", '100% (live)', 'a b+c?d=e', '../../etc', 'x\u0000y', 'é'.repeat(300)];

describe('listenLinks', () => {
  it('returns the four platforms in the fixed order', () => {
    expect(listenLinks({ name: 'X' }).map((l) => l.platform)).toEqual(['spotify', 'appleMusic', 'tidal', 'bandcamp']);
    expect(LISTEN_PLATFORMS).toEqual(['spotify', 'appleMusic', 'tidal', 'bandcamp']);
  });
  it('generates the specified search URLs, flagged as search', () => {
    const out = listenLinks({ name: 'Big Thief' });
    expect(out.map((l) => l.url)).toEqual([
      'https://open.spotify.com/search/Big%20Thief',
      'https://music.apple.com/us/search?term=Big%20Thief',
      'https://tidal.com/search?q=Big%20Thief',
      'https://bandcamp.com/search?q=Big%20Thief&item_type=b',
    ]);
    expect(out.every((l) => l.kind === 'search')).toBe(true);
  });
  it('prefers a verified link that is on the allow-list', () => {
    const out = listenLinks({
      name: 'Bully',
      links: { spotify: 'https://open.spotify.com/artist/abc', appleMusic: 'https://evil.example/artist/1', tidal: 'javascript:alert(1)', bandcamp: 'https://bully.bandcamp.com/' },
    });
    expect(out[0]).toMatchObject({ kind: 'verified', url: 'https://open.spotify.com/artist/abc' });
    expect(out[1]).toMatchObject({ kind: 'search' });
    expect(out[2]).toMatchObject({ kind: 'search' });
    expect(out[3]).toMatchObject({ kind: 'verified', url: 'https://bully.bandcamp.com/' });
  });
  it('encodes hostile names; every URL is https and on the allow-list', () => {
    for (const name of HOSTILE) {
      for (const l of listenLinks({ name })) {
        expect(l.url.startsWith('https://'), name).toBe(true);
        expect(isAllowedUrlForAnyPlatform(l.url), `${name} ${l.url}`).toBe(true);
        expect(l.url).not.toMatch(/[<>"\s\\]/);
      }
      expect(searchUrl('spotify', name)).toBe(`https://open.spotify.com/search/${encodeURIComponent(name)}`);
    }
    expect(searchUrl('spotify', '"><script>')).not.toContain('<');
  });
  it('does not let a name change the host or path', () => {
    const l = listenLinks({ name: 'evil.example/#@x' });
    for (const { url } of l) expect(['open.spotify.com', 'music.apple.com', 'tidal.com', 'bandcamp.com']).toContain(new URL(url).hostname);
  });
  it('gives no search link without a usable name, and tolerates junk', () => {
    expect(listenLinks({ name: '' })).toEqual([]);
    expect(listenLinks({})).toEqual([]);
    expect(listenLinks(null)).toEqual([]);
    expect(searchUrl('myspace', 'X')).toBeNull();
    expect(listenLinks({ name: 'X', links: 'nope' })).toHaveLength(4);
  });
  it('works for every real lineup artist', () => {
    for (const a of realLineup.artists) {
      const l = listenLinks(a);
      expect(l).toHaveLength(4);
      for (const { url } of l) expect(isAllowedUrlForAnyPlatform(url)).toBe(true);
    }
  });
});

describe('lastfmUrl', () => {
  it('returns the artist page when it passes the allow-list', () => {
    expect(lastfmUrl({ links: { lastfm: 'https://www.last.fm/music/Big+Thief' } })).toBe('https://www.last.fm/music/Big+Thief');
    expect(lastfmUrl({ links: { lastfm: 'https://evil.example/music/x' } })).toBeNull();
    expect(lastfmUrl({ links: {} })).toBeNull();
    expect(lastfmUrl(undefined)).toBeNull();
  });
});

describe('bandcamp.com root host', () => {
  it('is accepted only for /search', () => {
    expect(cleanPlatformUrl('bandcamp', 'https://bandcamp.com/search?q=x')).not.toBeNull();
    expect(cleanPlatformUrl('bandcamp', 'https://bandcamp.com/')).toBeNull();
    expect(cleanPlatformUrl('bandcamp', 'https://bandcamp.com/login')).toBeNull();
  });
});
