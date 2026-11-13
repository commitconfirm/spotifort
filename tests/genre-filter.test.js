import { describe, it, expect } from 'vitest';
import { filterGenres, cleanLineupGenres, isNonGenreTag } from '../scripts/lib/genre-filter.js';

describe('filterGenres', () => {
  it('removes place, nationality and meta tags case-insensitively', () => {
    expect(filterGenres(['indie rock', 'USA', 'American', 'United States', 'Seen Live', 'Favourites', 'Idaho']))
      .toEqual(['indie rock']);
  });
  it('keeps real genres that merely contain or resemble a place', () => {
    const keep = ['britpop', 'post-britpop', 'k-pop', 'euskal rock', 'chanson française', 'chanson francaise',
      'americana', 'latin', 'afrobeat', 'american primitivism', 'canterbury scene', 'goa trance', 'cumbia'];
    expect(filterGenres(keep)).toEqual(keep);
  });
  it('drops a tag equal to the artist name', () => {
    expect(filterGenres(['Slench', 'noise'], 'slench')).toEqual(['noise']);
    expect(isNonGenreTag('noise', 'Other')).toBe(false);
  });
  it('preserves order', () => {
    expect(filterGenres(['b', 'usa', 'a'])).toEqual(['b', 'a']);
  });
});

describe('cleanLineupGenres', () => {
  it('only changes genres and reports removals and emptied artists', () => {
    const lineup = {
      lastUpdated: '2026-11-13',
      artists: [
        { name: 'A', spotifyId: '1', manual: true, additionalSpotifyIds: ['x'], spotifyName: 'A!', enriched: true, genres: ['usa', 'folk'] },
        { name: 'B', spotifyId: null, genres: ['american'] },
        { name: 'C', genres: [] },
      ],
    };
    const snapshot = JSON.stringify(lineup);
    const { lineup: out, removed, emptied } = cleanLineupGenres(lineup);
    expect(JSON.stringify(lineup)).toBe(snapshot); // input not mutated
    expect(out.artists[0]).toEqual({ ...lineup.artists[0], genres: ['folk'] });
    expect(out.artists[1]).toEqual({ name: 'B', spotifyId: null, genres: [] });
    expect(out.artists[2]).toEqual(lineup.artists[2]);
    expect(out.lastUpdated).toBe('2026-11-13');
    expect(removed).toEqual({ usa: 1, american: 1 });
    expect(emptied).toEqual(['B']);
  });
});
