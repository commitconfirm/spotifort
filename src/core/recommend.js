// Pool x lineup x similarity -> ranked recommendations with reasons. docs/ARCHITECTURE.md, "Pool to lineup
// recommendations". Also the tag fallback for artists the index does not know. Pure, no DOM.

import { matchEntry } from './match.js';

export const MAX_RECOMMENDATIONS = 30;
export const MIN_SCORE = 0.1;
export const BAND_STRONG = 0.5;
export const BAND_GOOD = 0.25;
export const MAX_REASONS = 3;
export const MAX_TAG_RESULTS = 30;
const EPSILON = 1e-9;

/**
 * @param {number} score
 * @returns {'strong'|'good'|'worth-a-listen'}
 */
export function bandFor(score) {
  return score >= BAND_STRONG ? 'strong' : score >= BAND_GOOD ? 'good' : 'worth-a-listen';
}

const byKeyOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rank lineup artists for a pool: score(L) = 1 - product over pool artists U of (1 - weight(U) * m(U, L)),
 * where m is the reverse-index score for an outside artist, or the lineup-to-lineup score for a pool artist that
 * is itself on the lineup. Lineup artists the visitor already matched are excluded.
 * @param {{ entries: object[] }} pool
 * @param {ReturnType<import('./lineup-index.js').prepareLineup>} lineup
 * @param {ReturnType<import('./similarity-index.js').prepareSimilarity>} similarity
 * @returns {{
 *   recommendations: { n: number, name: string, score: number, band: string,
 *     reasons: { name: string, contribution: number, kind: 'outside'|'lineup', signal?: string }[] }[],
 *   noData: { key: string, name: string }[],
 * }} noData: pool artists not on the lineup that the index has nothing for
 */
export function recommend(pool, lineup, similarity) {
  const matchedN = new Set();
  /** @type {Map<number, { remain: number, parts: object[] }>} */
  const acc = new Map();
  const noData = [];

  const contribute = (n, entry, m, kind, signal) => {
    const c = entry.weight * m;
    if (!(c > 0)) return;
    let slot = acc.get(n);
    if (!slot) acc.set(n, (slot = { remain: 1, parts: [] }));
    slot.remain *= 1 - Math.min(c, 1);
    slot.parts.push(kind === 'lineup' ? { name: entry.name, contribution: c, kind, signal } : { name: entry.name, contribution: c, kind });
  };

  for (const entry of pool.entries) {
    const found = matchEntry(entry, lineup);
    if (found) {
      matchedN.add(found.artist.n);
      for (const nb of lineup.neighbours(found.artist.n)) contribute(nb.n, entry, nb.score, 'lineup', nb.signal);
    } else {
      const edges = similarity.edgesFor(entry.key);
      if (!edges.length) noData.push({ key: entry.key, name: entry.name });
      for (const e of edges) contribute(e.n, entry, e.score, 'outside');
    }
  }

  const recommendations = [];
  for (const [n, slot] of acc) {
    if (matchedN.has(n)) continue;
    const artist = lineup.byN(n);
    if (!artist) continue;
    const score = 1 - slot.remain;
    if (score < MIN_SCORE - EPSILON) continue; // scores are in hundredths; keep 0.10 despite float error
    const reasons = slot.parts.sort((a, b) => b.contribution - a.contribution || byKeyOrder(a.name, b.name)).slice(0, MAX_REASONS);
    recommendations.push({ n, name: artist.name, score, band: bandFor(score), reasons });
  }
  recommendations.sort((a, b) => b.score - a.score || byKeyOrder(a.name, b.name) || a.n - b.n);
  return { recommendations: recommendations.slice(0, MAX_RECOMMENDATIONS), noData };
}

// --- tags ---------------------------------------------------------------------------------------

/**
 * Tags in the lineup with how many artists carry each, most common first (for the tag picker).
 * @param {ReturnType<import('./lineup-index.js').prepareLineup>} lineup
 * @returns {{ tag: string, count: number }[]}
 */
export function listTags(lineup) {
  return lineup.tags.slice();
}

/**
 * Loose fallback for an artist the index does not know: lineup artists ranked by the IDF-weighted share of the
 * chosen tags they carry. A tag nearly every artist has counts for little. idf(t) = ln(1 + N / df(t)).
 * @param {string[]} tags tags the visitor chose
 * @param {ReturnType<import('./lineup-index.js').prepareLineup>} lineup
 * @returns {{ n: number, name: string, score: number, matched: string[] }[]} at most MAX_TAG_RESULTS, score > 0
 */
export function recommendByTags(tags, lineup) {
  const chosen = [...new Set((Array.isArray(tags) ? tags : []).filter((t) => typeof t === 'string'))];
  const counts = new Map(lineup.tags.map((t) => [t.tag, t.count]));
  const N = lineup.artists.length || 1;
  const idf = (t) => Math.log(1 + N / (counts.get(t) ?? 1));
  const known = chosen.filter((t) => counts.has(t));
  const total = known.reduce((s, t) => s + idf(t), 0);
  if (!total) return [];

  const out = [];
  for (const a of lineup.artists) {
    const have = new Set(lineup.tagsOf(a.n));
    const matched = known.filter((t) => have.has(t));
    if (!matched.length) continue;
    out.push({ n: a.n, name: a.name, score: matched.reduce((s, t) => s + idf(t), 0) / total, matched });
  }
  out.sort((a, b) => b.score - a.score || byKeyOrder(a.name, b.name) || a.n - b.n);
  return out.slice(0, MAX_TAG_RESULTS);
}
