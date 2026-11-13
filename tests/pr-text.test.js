import { describe, it, expect } from 'vitest';
import { diffArtists, reviewSections, sanitize, summarize } from '../scripts/lib/pr-text.js';

const art = (n, name, extra = {}) => ({ n, id: name.toLowerCase(), name, ...extra });
const state = (artists, events = 0) => ({ year: 2027, artists, schedule: { events: Array.from({ length: events }, (_, i) => ({ id: i })) } });
const review = `# Lineup review, 2027

## Lineup source
Source this run: the vendor API.

## Spotify ids by source
override 4

## Added (lineup update of 2026-11-13): 1
- X

## Spotify: inexact matches, top hit used (0)
- none

## Spotify: owner-accepted unconfirmed matches, flagged unverified (1)
- PLAYDEAD -> https://example.com @someone <b>x</b>

## Schedule (groundwork)
68 venues, 5 events.
`;

describe('diffArtists', () => {
  it('finds added, removed and renamed by number; ignores removed records', () => {
    const a = state([art(1, 'A'), art(2, 'B'), art(3, 'C', { removed: '2026-01-01' })]);
    const b = state([art(1, 'A2'), art(4, 'D'), art(3, 'C')]);
    expect(diffArtists(a, b)).toEqual({ added: ['D', 'C'], removed: ['B'], renamed: [{ from: 'A', to: 'A2' }] });
  });
});

describe('reviewSections', () => {
  it('keeps the source and non-empty sections, drops covered and empty ones', () => {
    const heads = reviewSections(review).map((s) => s.split('\n')[0]);
    expect(heads).toEqual(['## Lineup source', '## Spotify: owner-accepted unconfirmed matches, flagged unverified (1)']);
  });
  it('handles a missing report', () => expect(reviewSections('')).toEqual([]));
});

describe('sanitize', () => {
  it('defuses mentions and html', () => {
    expect(sanitize('@bob <img src=x>')).toBe('@\u200bbob &lt;img src=x>');
  });
});

describe('summarize', () => {
  it('reports no artist changes for identical input', () => {
    const s = state([art(1, 'A')]);
    const { title, body } = summarize({ oldState: s, newState: s, review });
    expect(title).toBe('Lineup update 2027: data refreshed, no artist changes');
    expect(body).toContain('both required checks');
  });
  it('builds a title from the facts', () => {
    const { title, body } = summarize({
      oldState: state([art(1, 'A'), art(2, 'B')]),
      newState: state([art(1, 'A2'), art(3, 'C')], 5),
      oldLineup: { artists: [] },
      newLineup: { artists: [{ unverified: true }] },
      review,
    });
    expect(title).toBe('Lineup update 2027: +1 artist, -1 artist, 1 renamed, unverified 0 -> 1, schedule published (5 events)');
    expect(body).toContain('- A -> A2');
    expect(body).toContain('overrides.json');
    expect(body).not.toContain('<b>');
    expect(body).not.toMatch(/@(?!​)/);
  });
  it('copes with no old state', () => {
    expect(summarize({ newState: state([art(1, 'A')]) }).title).toContain('+1 artist');
  });
});
