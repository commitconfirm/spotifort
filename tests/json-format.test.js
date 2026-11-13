import { describe, it, expect } from 'vitest';
import { formatCompactLines, formatPretty } from '../scripts/lib/json-format.js';

describe('formatPretty', () => {
  const value = {
    a: 1, b: null, c: 'x, y', empty: [], none: {},
    list: ['p', 'q'], pairs: [['A', 0.5], ['B', 1]],
    nested: { k: [{ z: 1 }, { z: 2 }] }, skip: undefined,
  };
  it('round-trips', () => {
    expect(JSON.parse(formatPretty(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });
  it('keeps primitive arrays inline and puts pairs on their own lines', () => {
    const text = formatPretty(value);
    expect(text).toContain('"list": ["p", "q"]');
    expect(text).toContain('  ["A", 0.5],\n');
    expect(text.endsWith('\n')).toBe(true);
  });
  it('is deterministic', () => {
    expect(formatPretty(value)).toBe(formatPretty(JSON.parse(JSON.stringify(value))));
  });
});

describe('formatCompactLines', () => {
  const value = { year: 2027, artists: [{ n: 1 }, { n: 2 }], names: [], edges: [[1, 2], [3, 4]] };
  it('puts one element per line and round-trips', () => {
    const text = formatCompactLines(value);
    expect(JSON.parse(text)).toEqual(value);
    expect(text).toContain('{"n":1},\n{"n":2}');
    expect(text).toContain('[1,2],\n[3,4]');
  });
});
