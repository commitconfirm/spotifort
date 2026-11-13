// The "Try:" chips on the first screen must resolve against the committed data, or the app would silently drop them.
import { describe, it, expect } from 'vitest';
import festival from '../festival.config.js';
import { validExamples } from '../src/app/state.js';
import { realLineup, realSimilarity } from './helpers/real-data.js';

describe('festival.config.js exampleArtists', () => {
  it('has a short list', () => {
    expect(festival.exampleArtists.length).toBeGreaterThan(0);
    expect(festival.exampleArtists.length).toBeLessThanOrEqual(6);
  });
  it('every example is on the lineup or in the similarity index', () => {
    expect(validExamples(festival.exampleArtists, realLineup, realSimilarity)).toEqual(festival.exampleArtists);
  });
});
