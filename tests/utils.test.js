import { describe, it, expect } from 'vitest';
import { escapeHtml, statesMatch, formatDate, AUTH_PURPOSES, stateWithPurpose, purposeFromState } from '../src/utils.js';

describe('escapeHtml', () => {
  it('escapes & < > " and \'', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('makes attribute breakouts inert', () => {
    expect(escapeHtml('" onmouseover="x')).not.toContain('"');
  });
  it('handles null and numbers', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(5)).toBe('5');
  });
});

describe('statesMatch (OAuth state check)', () => {
  it('accepts equal non-empty states', () => expect(statesMatch('abc', 'abc')).toBe(true));
  it('rejects a mismatch', () => expect(statesMatch('abc', 'abd')).toBe(false));
  it('rejects a missing returned state', () => {
    expect(statesMatch('abc', null)).toBe(false);
    expect(statesMatch('abc', '')).toBe(false);
  });
  it('rejects when nothing was stored (even if returned is also missing)', () => {
    expect(statesMatch(null, null)).toBe(false);
    expect(statesMatch(null, 'abc')).toBe(false);
    expect(statesMatch('', '')).toBe(false);
  });
});

describe('formatDate', () => {
  it('renders a YYYY-MM-DD string as that calendar date', () => {
    expect(formatDate('2026-11-13')).toBe('November 13, 2026');
    expect(formatDate('2027-01-01')).toBe('January 1, 2027');
    expect(formatDate('2026-12-31')).toBe('December 31, 2026');
  });
  it('is timezone independent: stays correct under a negative UTC offset', () => {
    // The old new Date('2026-11-13').toLocaleDateString() gave "November 12, 2026" at UTC-8.
    // Node reads TZ lazily, so setting it here exercises the code under America/Los_Angeles.
    const prev = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(new Date('2026-11-13').getDate()).toBe(12); // proves the old approach breaks in this zone
      expect(formatDate('2026-11-13')).toBe('November 13, 2026');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
  it('returns malformed input unchanged', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
    expect(formatDate('2026-02-30')).toBe('2026-02-30');
    expect(formatDate('')).toBe('');
    expect(formatDate(undefined)).toBe('');
  });
});

describe('login purpose in the OAuth state', () => {
  it('lists the two purposes', () => expect(AUTH_PURPOSES).toEqual(['library', 'playlist']));
  it('round-trips each purpose, including a random part that contains dots', () => {
    for (const purpose of AUTH_PURPOSES) {
      expect(stateWithPurpose('abc', purpose)).toBe(`abc.${purpose}`);
      expect(purposeFromState(stateWithPurpose('abc', purpose))).toBe(purpose);
      expect(purposeFromState(stateWithPurpose('a.b.c~-_', purpose))).toBe(purpose);
      expect(purposeFromState(stateWithPurpose('a.playlist.', purpose))).toBe(purpose);
    }
  });
  it('treats an old-format state (no purpose) as a library login', () => {
    expect(purposeFromState('AbCdEfGh0123456789AbCdEfGh012345')).toBe('library');
    expect(purposeFromState('ab.cd')).toBe('library');
    expect(purposeFromState('abc.')).toBe('library');
    expect(purposeFromState('playlist')).toBe('library');
  });
  it('only exactly "playlist" after the last dot means playlist', () => {
    expect(purposeFromState('abc.Playlist')).toBe('library');
    expect(purposeFromState('abc.playlist ')).toBe('library');
    expect(purposeFromState('abc.playlists')).toBe('library');
    expect(purposeFromState('abc.playlist.x')).toBe('library');
    expect(purposeFromState('abc.xplaylist')).toBe('library');
  });
  it('tolerates junk', () => {
    for (const v of [null, undefined, 42, {}, [], '', '.']) expect(purposeFromState(v)).toBe('library');
    expect(purposeFromState('.playlist')).toBe('playlist');
  });
});
