import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, MAX_SHARE_N } from '../src/core/share.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { realLineup } from './helpers/real-data.js';

const mk = (ns, year = 2027) => prepareLineup({ year, artists: ns.map((n) => ({ n, name: `A${n}` })) });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('share', () => {
  it('round-trips empty, single, sparse-large-n and everyone', () => {
    const lineup = mk([...range(1, 188), 5000, 23999, 24000]);
    for (const picks of [[], [1], [188], [5000], [3, 5000, 24000], range(1, 188), [24000]]) {
      const frag = encodeShare({ year: 2027, picks });
      expect(frag).toMatch(/^s=2027\.[A-Za-z0-9_-]*$/);
      expect(decodeShare(frag, lineup)).toEqual({ year: 2027, picks });
      expect(decodeShare(`#${frag}`, lineup)).toEqual({ year: 2027, picks });
    }
  });
  it('sorts and de-duplicates picks, ignoring invalid ones', () => {
    const lineup = mk(range(1, 30));
    const frag = encodeShare({ year: 2027, picks: [9, 3, 3, 0, -4, 2.5, NaN, 'x', 99999, 7] });
    expect(decodeShare(frag, lineup).picks).toEqual([3, 7, 9]);
    expect(encodeShare({ year: 2027, picks: 'nope' })).toBe('s=2027.');
  });
  it('drops unknown n on decode', () => {
    const frag = encodeShare({ year: 2027, picks: [1, 2, 3, 200] });
    expect(decodeShare(frag, mk([1, 3])).picks).toEqual([1, 3]);
  });
  it('returns null for the wrong year', () => {
    expect(decodeShare(encodeShare({ year: 2026, picks: [1] }), mk([1]))).toBeNull();
  });
  it('never throws and returns null on malformed input', () => {
    const lineup = mk([1, 2, 3]);
    for (const bad of [undefined, null, 5, {}, '', '#', 's=', 's=2027', 's=2027.!!!', 's=2027.A', 's=2027.AAAAA', 's=2027.AB=', 'x=2027.AA', 's=27.AA', 's=2027.' + 'A'.repeat(5000), 's=2027.AA\n', 's=2027.é']) {
      expect(decodeShare(bad, lineup), String(bad).slice(0, 20)).toBeNull();
    }
    expect(decodeShare('s=2027.AA', null)).toBeNull();
    expect(decodeShare('s=2027.AA', {})).toBeNull();
  });
  it('accepts the raw lineup JSON as well as the index', () => {
    const json = { year: 2027, artists: [{ n: 1 }, { n: 2 }] };
    expect(decodeShare(encodeShare({ year: 2027, picks: [1, 2] }), json).picks).toEqual([1, 2]);
  });
  it('rejects payloads wider than the supported n range', () => {
    const huge = 's=2027.' + 'A'.repeat(4000); // ~3000 bytes = 24000 bits, ok; one more byte is not
    expect(decodeShare(huge, mk([1]))).not.toBeNull();
    expect(decodeShare('s=2027.' + 'A'.repeat(4100), mk([1]))).toBeNull();
    expect(MAX_SHARE_N).toBe(24000);
  });
  it('fragment length for 30 picks on the real lineup', () => {
    const ns = realLineup.artists.map((a) => a.n);
    const picks = ns.filter((_, i) => i % 6 === 0).slice(0, 30);
    expect(picks).toHaveLength(30);
    const frag = encodeShare({ year: 2027, picks });
    console.log(`share fragment, 30 picks over n<=${Math.max(...ns)}: ${frag.length} chars (#${frag.length + 1} with the hash)`);
    expect(frag.length).toBeLessThan(50);
    expect(decodeShare(frag, realLineup).picks).toEqual(picks);
  });
});
