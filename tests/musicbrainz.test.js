import { describe, it, expect } from 'vitest';
import { extractLinks, parseUrlLookup } from '../scripts/lib/musicbrainz.js';

const rel = (resource) => ({ url: { resource } });

describe('parseUrlLookup', () => {
  it('finds the artist behind a Spotify URL', () => {
    expect(parseUrlLookup(200, { relations: [{ artist: { id: 'abc', name: 'X' } }] })).toEqual({ kind: 'found', mbid: 'abc' });
  });
  it('treats 404 and an empty relation list as a real "not known"', () => {
    expect(parseUrlLookup(404, { error: 'Not Found' })).toEqual({ kind: 'none' });
    expect(parseUrlLookup(200, { relations: [] })).toEqual({ kind: 'none' });
    expect(parseUrlLookup(200, {})).toEqual({ kind: 'none' });
  });
});

describe('extractLinks', () => {
  it('picks links per platform and the platform ids that URLs carry', () => {
    const { links, ids } = extractLinks([
      rel('https://music.apple.com/us/artist/ratboys/997909855'),
      rel('https://tidal.com/artist/6824673'),
      rel('https://www.deezer.com/artist/7985936'),
      rel('https://ratboys.bandcamp.com/'),
      rel('https://www.youtube.com/channel/UCBRFx9wNwixjN__A-qDjjTQ'),
      rel('https://soundcloud.com/ratboys'),
      rel('https://www.last.fm/music/Ratboys'),
      rel('https://www.facebook.com/ratboys'),
    ]);
    expect(links).toEqual({
      appleMusic: 'https://music.apple.com/us/artist/ratboys/997909855',
      tidal: 'https://tidal.com/artist/6824673',
      deezer: 'https://www.deezer.com/artist/7985936',
      bandcamp: 'https://ratboys.bandcamp.com/',
      youtube: 'https://www.youtube.com/channel/UCBRFx9wNwixjN__A-qDjjTQ',
      soundcloud: 'https://soundcloud.com/ratboys',
      lastfm: 'https://www.last.fm/music/Ratboys',
    });
    expect(ids).toEqual({ appleMusic: '997909855', tidal: '6824673', deezer: '7985936' });
  });

  it('handles id-only paths and locale/browse segments', () => {
    const { ids } = extractLinks([rel('https://music.apple.com/gb/artist/413046961'), rel('https://tidal.com/browse/artist/3870678'), rel('https://www.deezer.com/en/artist/544334')]);
    expect(ids).toEqual({ appleMusic: '413046961', tidal: '3870678', deezer: '544334' });
  });

  it('keeps only https links on allow-listed hosts', () => {
    const { links } = extractLinks([
      rel('http://ratboys.bandcamp.com/'),
      rel('https://evil.example.com/ratboys.bandcamp.com/'),
      rel('https://bandcamp.com.evil.example/'),
      rel('https://user:pw@soundcloud.com/x'),
      rel('javascript:alert(1)'),
      rel('https://music.youtube.com/channel/UCx'),
      rel('https://itunes.apple.com/us/artist/x/123'),
    ]);
    expect(links).toEqual({});
  });

  it('skips platform pages that are not artist pages and takes the first valid one', () => {
    const { links, ids } = extractLinks([
      rel('https://tidal.com/album/123'),
      rel('https://music.apple.com/us/album/x/1'),
      rel('https://www.youtube.com/watch?v=abc'),
      rel('https://first.bandcamp.com/'),
      rel('https://second.bandcamp.com/'),
    ]);
    expect(links).toEqual({ bandcamp: 'https://first.bandcamp.com/' });
    expect(ids).toEqual({});
  });

  it('tolerates missing relations', () => {
    expect(extractLinks(undefined)).toEqual({ links: {}, ids: {} });
    expect(extractLinks([{}, { url: {} }])).toEqual({ links: {}, ids: {} });
  });
});
