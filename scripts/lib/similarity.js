/**
 * Scoring for the build stage. Pure functions, no file I/O. See docs/ARCHITECTURE.md, "Scoring".
 *
 * An "artist" here is the resolved view the build makes of a record:
 *   { n, name, keys: string[],            normalised names this artist is known by (festival name, Last.fm name)
 *     similar: [name, match][],           Last.fm similar list (already empty if the data is not trusted)
 *     tags: [tag, count][] }
 */
import { normalizeName } from '../../src/core/normalize.js';
import { formatCompactLines } from './json-format.js';
import { gzipSize } from './size.js';
import {
  BUDGET_SIMILARITY_GZIP,
  MIN_SIMILARITY,
  NEIGHBOURS_PER_ARTIST,
  REVERSE_MIN_MATCH,
  REVERSE_MIN_MATCH_LADDER,
  WEIGHT_NEIGHBOURS,
  WEIGHT_TAGS,
} from './constants.js';

export const SIGNALS = ['direct', 'neighbours', 'tags'];

/**
 * Sparse vector of an artist's Last.fm similar list: normalised name -> match.
 * Colliding names keep the higher match; the artist's own names are dropped.
 * @param {[string, number][]} similar
 * @param {string[]} ownKeys
 * @returns {Map<string, number>}
 */
export function similarVector(similar, ownKeys = []) {
  const own = new Set(ownKeys);
  const v = new Map();
  for (const [name, match] of similar) {
    const key = normalizeName(name);
    if (!key || own.has(key)) continue;
    if ((v.get(key) ?? -1) < match) v.set(key, match);
  }
  return v;
}

const norm = (v) => {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
};

/**
 * Cosine similarity of two sparse vectors.
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @param {number} [normA] precomputed length
 * @param {number} [normB]
 * @returns {number} in [0, 1] for non-negative vectors; 0 if either is empty
 */
export function cosine(a, b, normA = norm(a), normB = norm(b)) {
  if (!normA || !normB) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, x] of small) {
    const y = large.get(k);
    if (y !== undefined) dot += x * y;
  }
  return dot / (normA * normB);
}

/**
 * Inverse document frequency of each tag across the lineup: ln(1 + N / df).
 * Smoothed so a tag on every artist still counts a little (ln 2), and a rare tag counts a lot.
 * @param {[string, number][][]} tagLists one list per artist
 * @returns {Map<string, number>}
 */
export function idfWeights(tagLists) {
  const df = new Map();
  for (const tags of tagLists) for (const t of new Set(tags.map(([tag]) => tag))) df.set(t, (df.get(t) ?? 0) + 1);
  const n = tagLists.length;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
  return idf;
}

/**
 * Tag vector: tag -> (count / 100) * idf.
 * @param {[string, number][]} tags
 * @param {Map<string, number>} idf
 * @returns {Map<string, number>}
 */
export function tagVector(tags, idf) {
  const v = new Map();
  for (const [tag, count] of tags) v.set(tag, (count / 100) * (idf.get(tag) ?? 0));
  return v;
}

/**
 * Combined score s = 1 - (1 - d)(1 - wN * g)(1 - wT * t).
 * @returns {number} in [0, 1]
 */
export function combineSignals(d, g, t, wN = WEIGHT_NEIGHBOURS, wT = WEIGHT_TAGS) {
  return 1 - (1 - d) * (1 - wN * g) * (1 - wT * t);
}

/**
 * The signal that contributed most. Ties go to direct, then neighbours, then tags.
 * @returns {'direct'|'neighbours'|'tags'}
 */
export function dominantSignal(d, g, t, wN = WEIGHT_NEIGHBOURS, wT = WEIGHT_TAGS) {
  const parts = [d, wN * g, wT * t];
  let best = 0;
  for (let i = 1; i < 3; i++) if (parts[i] > parts[best]) best = i;
  return SIGNALS[best];
}

const roundTo = (x, places) => Number(x.toFixed(places));

/**
 * Lineup-to-lineup similarity.
 * @param {Array} artists see the module comment; n must be unique
 * @param {object} [opts]
 * @returns {Map<number, Array<{n: number, s: number, signal: string, d: number, g: number, t: number}>>}
 *   per artist, up to `limit` others with s >= `min`, best first (ties: lower n first). s is full precision.
 */
export function computeLineupSimilarity(artists, opts = {}) {
  const {
    limit = NEIGHBOURS_PER_ARTIST,
    min = MIN_SIMILARITY,
    wN = WEIGHT_NEIGHBOURS,
    wT = WEIGHT_TAGS,
  } = opts;

  const idf = idfWeights(artists.map((a) => a.tags));
  const nodes = artists.map((a) => {
    const sim = similarVector(a.similar, a.keys);
    const tags = tagVector(a.tags, idf);
    return { a, sim, simNorm: norm(sim), tags, tagNorm: norm(tags) };
  });

  const result = new Map(artists.map((a) => [a.n, []]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i];
      const B = nodes[j];
      let d = 0;
      for (const k of B.a.keys) d = Math.max(d, A.sim.get(k) ?? 0);
      for (const k of A.a.keys) d = Math.max(d, B.sim.get(k) ?? 0);
      const g = cosine(A.sim, B.sim, A.simNorm, B.simNorm);
      const t = cosine(A.tags, B.tags, A.tagNorm, B.tagNorm);
      const s = combineSignals(d, g, t, wN, wT);
      if (s < min) continue;
      const signal = dominantSignal(d, g, t, wN, wT);
      result.get(A.a.n).push({ n: B.a.n, s, signal, d, g, t });
      result.get(B.a.n).push({ n: A.a.n, s, signal, d, g, t });
    }
  }
  for (const [n, list] of result) {
    list.sort((x, y) => y.s - x.s || x.n - y.n);
    result.set(n, list.slice(0, limit));
  }
  return result;
}

/**
 * Reverse index: outside artist -> lineup artists they are similar to.
 * Built from each lineup artist's Last.fm similar list. Lineup artists are excluded (typing one matches by n),
 * self references are dropped, names that collide after normalisation merge keeping the higher score.
 * @param {Array} artists see the module comment
 * @param {object} [opts]
 * @param {number} [opts.minMatch]
 * @returns {{names: string[], keys: string[], edges: number[][]}} parallel arrays sorted by key (keys are for the build only).
 *   edges[i] is flat [n, score x 100, n, score x 100, ...], best first.
 */
export function buildReverseIndex(artists, opts = {}) {
  const { minMatch = REVERSE_MIN_MATCH } = opts;
  const lineupKeys = new Set(artists.flatMap((a) => a.keys));
  const byKey = new Map(); // key -> { best: {name, match}, targets: Map<n, match> }

  for (const a of artists) {
    const own = new Set(a.keys);
    for (const [name, match] of a.similar) {
      if (match < minMatch) continue;
      const key = normalizeName(name);
      if (!key || own.has(key) || lineupKeys.has(key)) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { name, best: match, targets: new Map() };
        byKey.set(key, entry);
      } else if (match > entry.best || (match === entry.best && name < entry.name)) {
        entry.name = name;
        entry.best = match;
      }
      if ((entry.targets.get(a.n) ?? -1) < match) entry.targets.set(a.n, match);
    }
  }

  const keys = [...byKey.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const names = [];
  const edges = [];
  for (const key of keys) {
    const { name, targets } = byKey.get(key);
    names.push(name);
    const pairs = [...targets].map(([n, m]) => [n, Math.round(m * 100)]).sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    edges.push(pairs.flat());
  }
  return { names, keys, edges };
}

/**
 * The public similarity.json object for a reverse index. `keys` is not shipped: the client derives them
 * from `names` with the shared normaliser (names are already sorted by that key and the keys are unique).
 */
export const publicSimilarity = (reverse, minMatch) => ({ minMatch, names: reverse.names, edges: reverse.edges });

/**
 * Build the reverse index at the lowest cutoff on the ladder whose gzipped public file fits the budget.
 * @param {Array} artists see the module comment
 * @param {object} [opts]
 * @param {number} [opts.budget] gzip bytes
 * @param {number[]} [opts.ladder] ascending cutoffs to try
 * @returns {{reverse: {names: string[], keys: string[], edges: number[][]}, similarity: object, minMatch: number, gzip: number, raw: number}}
 * @throws if even the last cutoff does not fit
 */
export function fitReverseIndex(artists, opts = {}) {
  const { budget = BUDGET_SIMILARITY_GZIP, ladder = REVERSE_MIN_MATCH_LADDER } = opts;
  let last = 0;
  for (const minMatch of ladder) {
    const reverse = buildReverseIndex(artists, { minMatch });
    const similarity = publicSimilarity(reverse, minMatch);
    const text = formatCompactLines(similarity);
    const gzip = gzipSize(text);
    if (gzip <= budget) return { reverse, similarity, minMatch, gzip, raw: Buffer.byteLength(text) };
    last = gzip;
  }
  throw new Error(
    `similarity.json does not fit its ${budget} byte gzip budget even at the highest cutoff ` +
    `(${ladder[ladder.length - 1]}: ${last} bytes). Raise the budget or shorten the Last.fm similar lists.`
  );
}

export { roundTo };
