import { describe, it, expect } from 'vitest';
import { matchLineupArtists } from '../src/match-core.js';

const entry = (over = {}) => ({
  name: 'Duo', spotifyId: 'p1', spotifyUrl: 'https://open.spotify.com/artist/p1',
  notOnSpotify: false, genres: [], ...over,
});

describe('matchLineupArtists', () => {
  it('matches on the primary ID', () => {
    const e = entry({ additionalSpotifyIds: ['s1'] });
    expect(matchLineupArtists(new Set(['p1']), [e])).toEqual([e]);
  });
  it('matches on an additional ID only, keeping the primary key', () => {
    const e = entry({ additionalSpotifyIds: ['s1', 's2'] });
    const res = matchLineupArtists(new Set(['s2']), [e]);
    expect(res).toHaveLength(1);
    expect(res[0].spotifyId).toBe('p1');
    expect(res[0].spotifyUrl).toBe(e.spotifyUrl);
  });
  it('returns one result when several IDs match', () => {
    const e = entry({ additionalSpotifyIds: ['s1'] });
    expect(matchLineupArtists(new Set(['p1', 's1']), [e])).toHaveLength(1);
  });
  it('behaves as before without the field', () => {
    const e = entry();
    expect(matchLineupArtists(new Set(['p1']), [e])).toEqual([e]);
    expect(matchLineupArtists(new Set(['zzz']), [e])).toEqual([]);
  });
  it('never matches notOnSpotify or null-ID entries', () => {
    const a = entry({ notOnSpotify: true, additionalSpotifyIds: ['s1'] });
    const b = entry({ spotifyId: null, additionalSpotifyIds: ['s1'] });
    expect(matchLineupArtists(new Set(['p1', 's1']), [a, b])).toEqual([]);
  });
  it('tolerates a non-array or missing additionalSpotifyIds', () => {
    const list = [
      entry({ additionalSpotifyIds: 's1' }),
      entry({ spotifyId: 'p2', additionalSpotifyIds: null }),
      entry({ spotifyId: 'p3', additionalSpotifyIds: {} }),
      entry({ spotifyId: 'p4' }),
    ];
    expect(matchLineupArtists(new Set(['s1']), list)).toEqual([]);
    expect(matchLineupArtists(new Set(['p2', 'p4']), list)).toHaveLength(2);
  });
});
