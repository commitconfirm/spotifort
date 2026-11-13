// Prepares public/data/<year>/similarity.json for lookups: outside artist (by normalised key) -> the lineup
// artists it is similar to, plus autocomplete over the outside names. Pure, no DOM, no fetch.
//
// File shape (docs/ARCHITECTURE.md, "Public outputs"): { minMatch, names: [...], edges: [[n, score*100, ...], ...] }.
// There is no keys array; keys are derived once here with the shared normaliser.

import { normalizeName } from './normalize.js';
import { createSearcher } from './search.js';

/**
 * @typedef {{ n: number, score: number }} Edge score is 0..1
 * @typedef {{ key: string, name: string }} NameHit
 * @typedef {{
 *   minMatch: number,
 *   size: number,
 *   has: (key: string) => boolean,
 *   edgesFor: (key: string) => Edge[],
 *   nameFor: (key: string) => string|null,
 *   search: (query: unknown, options?: { limit?: number }) => NameHit[],
 * }} SimilarityIndex
 */

/**
 * @param {{ minMatch?: number, names: string[], edges: number[][] }} json
 * @returns {SimilarityIndex}
 * @throws {TypeError} when the file is structurally wrong (names and edges must be parallel arrays)
 */
export function prepareSimilarity(json) {
  if (!json || !Array.isArray(json.names) || !Array.isArray(json.edges) || json.names.length !== json.edges.length) {
    throw new TypeError('similarity data: names and edges must be arrays of the same length');
  }
  const names = json.names;
  const edges = json.edges;
  const keys = new Array(names.length);
  /** @type {Map<string, number>} */
  const indexByKey = new Map();
  for (let i = 0; i < names.length; i++) {
    keys[i] = normalizeName(names[i]);
    if (!indexByKey.has(keys[i])) indexByKey.set(keys[i], i); // build guarantees unique keys; first wins if not
  }
  const searcher = createSearcher(keys, normalizeName);

  return {
    minMatch: typeof json.minMatch === 'number' ? json.minMatch : 0,
    size: names.length,
    has: (key) => indexByKey.has(key),
    edgesFor(key) {
      const i = indexByKey.get(key);
      if (i === undefined) return [];
      const flat = edges[i];
      const out = [];
      if (!Array.isArray(flat)) return out;
      for (let j = 0; j + 1 < flat.length; j += 2) out.push({ n: flat[j], score: flat[j + 1] / 100 });
      return out;
    },
    nameFor(key) {
      const i = indexByKey.get(key);
      return i === undefined ? null : names[i];
    },
    search(query, options) {
      return searcher(query, options).map((i) => ({ key: keys[i], name: names[i] }));
    },
  };
}
