import { describe, it, expect } from 'vitest';
import { filterGenres, isNonGenreTag } from '../scripts/lib/genre-filter.js';

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
