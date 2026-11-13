// Autocomplete over a fixed list of names. Keys (normalised names) are computed once by the caller;
// a search is one linear pass of cheap string tests, fine for ~25,000 names per keystroke.
// Pure, no DOM, no Node APIs.

export const MIN_QUERY_LENGTH = 2;
export const DEFAULT_SEARCH_LIMIT = 8;

/**
 * Build a searcher over parallel arrays of normalised keys and display names.
 * Order of results: prefix matches, then word-prefix matches, then substring matches; within each tier
 * shorter names first, then alphabetical by key. Empty or one-character (normalised) queries return nothing.
 * @param {string[]} keys normalised names (the caller normalises once, up front)
 * @param {(query: string) => string} normalize the same normaliser used for the keys
 * @param {{ compare?: (a: number, b: number) => number }} [options] optional tie-break over indices, applied within a
 *   tier before the default (shorter name, then alphabetical); negative means `a` ranks first. Precompute anything
 *   expensive; it runs inside a sort.
 * @returns {(query: unknown, options?: { limit?: number }) => number[]} indices into `keys`, best first
 */
export function createSearcher(keys, normalize, { compare } = {}) {
  const byLengthThenKey = (a, b) => (compare ? compare(a, b) : 0) || keys[a].length - keys[b].length || (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0);

  return function search(query, { limit = DEFAULT_SEARCH_LIMIT } = {}) {
    const q = normalize(query);
    if (q.length < MIN_QUERY_LENGTH || !(limit > 0)) return [];
    const wordQ = ` ${q}`;
    const tiers = [[], [], []];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.startsWith(q)) tiers[0].push(i);
      else if (k.includes(wordQ)) tiers[1].push(i);
      else if (k.includes(q)) tiers[2].push(i);
    }
    const out = [];
    for (const tier of tiers) {
      if (out.length >= limit) break;
      tier.sort(byLengthThenKey);
      for (const i of tier) {
        out.push(i);
        if (out.length >= limit) break;
      }
    }
    return out;
  };
}
