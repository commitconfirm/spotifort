// Everything about the main page that can be decided without a DOM: pool -> matches -> recommendations -> what each
// list shows, the wording of reasons, band grouping, autocomplete suggestions, example validation, share picks and
// dev diagnostics. Pure functions over plain data, unit tested in tests/app-state.test.js. The UI modules in src/ui/
// only render what these return.

import { normalizeName } from '../core/normalize.js';
import { addPicked, addTyped, SOURCE_PICKED, SOURCE_TYPED } from '../core/pool.js';
import { matchPool } from '../core/match.js';
import { recommend, BAND_GOOD, BAND_STRONG } from '../core/recommend.js';
import { listenLinks } from '../core/links.js';
import { decodeShare, encodeShare } from '../core/share.js';

/** Sources the visitor adds one artist at a time; everything else is a library import shown as one summary chip. */
export const MANUAL_SOURCES = [SOURCE_TYPED, SOURCE_PICKED];
export const LIBRARY_LABELS = { spotify: 'Spotify library' };

/**
 * Large libraries saturate the absolute bands (docs/evaluation-2.5.md): with this many pool artists or more, and
 * more than RELATIVE_STRONG results in the strong band, the bands are assigned by rank instead.
 */
export const LARGE_POOL = 100;
export const RELATIVE_STRONG = 10;
export const RELATIVE_GOOD = 10;

export const BAND_LABELS = { strong: 'Strong match', good: 'Good match', 'worth-a-listen': 'Worth a listen' };
const BAND_ORDER = ['strong', 'good', 'worth-a-listen'];

const EMPTY_SIMILARITY = Object.freeze({
  size: 0,
  has: () => false,
  edgesFor: () => [],
  nameFor: () => null,
  search: () => [],
});

const isManual = (entry) => entry.sources.some((s) => MANUAL_SOURCES.includes(s));

/** "1,341" — fixed locale so output does not depend on the visitor's settings or the test machine. */
export const formatCount = (n) => Number(n).toLocaleString('en-US');

/** "Spotify library · 1,341 artists" */
export function libraryChipText(label, count) {
  return `${label} · ${formatCount(count)} artist${count === 1 ? '' : 's'}`;
}

/** Pool entries that came from one library source: the number the chip shows. */
export function libraryCount(pool, sourceId) {
  return pool.entries.filter((e) => e.sources.includes(sourceId)).length;
}

/**
 * The status line after a library import. `count` must be the pool's own count for the source (libraryCount), so it
 * matches the chip; the imported item count can be higher because artists that share a normalised name merge.
 * @param {{ count: number, songs: number, missing?: string[] }} p missing: optional parts that failed, e.g. 'top artists'
 * @returns {string}
 */
export function importSummaryText({ count, songs, missing = [] }) {
  if (!count) return 'Your Spotify library had no artists to add.';
  const parts = [`${formatCount(songs)} liked song${songs === 1 ? '' : 's'}`];
  if (!missing.includes('top artists')) parts.push('your top artists');
  if (!missing.includes('followed artists')) parts.push('the artists you follow');
  let text = `Imported ${formatCount(count)} artist${count === 1 ? '' : 's'} from ${joinNames(parts)}.`;
  if (missing.length) text += ` Your ${missing.join(' and ')} could not be read, so they were left out.`;
  return text;
}

/**
 * What the "My artists" area shows: one chip per hand-added artist, and one summary chip per library source.
 * @param {{ entries: object[] }} pool
 * @returns {{ manual: { key: string, name: string }[], libraries: { sourceId: string, label: string, count: number, text: string }[] }}
 */
export function poolChips(pool) {
  const manual = [];
  const counts = new Map();
  for (const e of pool.entries) {
    if (isManual(e)) manual.push({ key: e.key, name: e.name });
    for (const s of e.sources) if (!MANUAL_SOURCES.includes(s)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const libraries = [...counts].map(([sourceId, count]) => {
    const label = LIBRARY_LABELS[sourceId] ?? sourceId;
    return { sourceId, label, count, text: libraryChipText(label, count) };
  });
  return { manual, libraries };
}

/**
 * How a name the visitor typed or tapped resolves. `pending` means the similarity index is not loaded yet.
 * @returns {{ kind: 'lineup', artist: object } | { kind: 'outside', name: string } | { kind: 'unknown' } | { kind: 'pending' }}
 */
export function resolveName(name, lineup, similarity) {
  const key = normalizeName(name);
  if (!key) return { kind: 'unknown' };
  const artist = lineup.byKey(key);
  if (artist) return { kind: 'lineup', artist };
  if (!similarity) return { kind: 'pending' };
  return similarity.has(key) ? { kind: 'outside', name: similarity.nameFor(key) } : { kind: 'unknown' };
}

/**
 * Add an artist by name (typed and submitted, or an example chip). Unknown names are not added.
 * @returns {{ pool: object, outcome: 'added'|'already'|'unknown'|'pending', name: string }}
 */
export function addByName(pool, name, lineup, similarity) {
  const r = resolveName(name, lineup, similarity);
  if (r.kind === 'unknown' || r.kind === 'pending') return { pool, outcome: r.kind, name: String(name ?? '').trim() };
  return r.kind === 'lineup' ? addSuggestion(pool, { kind: 'lineup', n: r.artist.n, name: r.artist.name }) : addSuggestion(pool, { kind: 'outside', name: r.name });
}

/**
 * Add an autocomplete suggestion.
 * @param {{ entries: object[] }} pool
 * @param {{ kind: 'lineup'|'outside', name: string, n?: number }} suggestion
 * @returns {{ pool: object, outcome: 'added'|'already', name: string }}
 */
export function addSuggestion(pool, suggestion) {
  const key = normalizeName(suggestion.name);
  const existing = pool.entries.find((e) => e.key === key);
  if (existing && isManual(existing)) return { pool, outcome: 'already', name: existing.name };
  const next = suggestion.kind === 'lineup' ? addPicked(pool, { n: suggestion.n, name: suggestion.name }) : addTyped(pool, suggestion.name);
  return { pool: next, outcome: 'added', name: suggestion.name };
}

/**
 * Example chips that resolve to something. Before the similarity index loads, names that are not on the lineup
 * are kept (they are re-checked once it loads).
 * @param {string[]} names
 * @returns {string[]}
 */
export function validExamples(names, lineup, similarity) {
  return (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && resolveName(n, lineup, similarity).kind !== 'unknown');
}

/**
 * Autocomplete over both indexes: lineup artists first (marked as playing), then outside artists.
 * @returns {{ id: string, kind: 'lineup'|'outside', name: string, n?: number }[]}
 */
export function suggestions(query, lineup, similarity, { limit = 8, lineupMax = 4 } = {}) {
  const out = [];
  for (const hit of lineup.search(query, { limit: lineupMax })) out.push({ id: `l${hit.n}`, kind: 'lineup', name: hit.name, n: hit.n });
  if (similarity && out.length < limit) {
    const seen = new Set(out.map((s) => normalizeName(s.name)));
    for (const hit of similarity.search(query, { limit: limit - out.length + lineupMax })) {
      if (out.length >= limit) break;
      if (seen.has(hit.key)) continue;
      out.push({ id: `o${hit.key}`, kind: 'outside', name: hit.name });
    }
  }
  return out;
}

/**
 * Matches and recommendations for a pool. Without the similarity index (still loading) outside artists contribute
 * nothing and nothing is reported as "no data".
 * @returns {{ matches: object[], recommendations: object[], noData: { key: string, name: string }[], stats: object }}
 *   noData lists only artists the visitor added by hand (never library imports).
 */
export function computeResults(pool, lineup, similarity) {
  const matches = matchPool(pool, lineup);
  const r = recommend(pool, lineup, similarity ?? EMPTY_SIMILARITY);
  const manualKeys = new Set(pool.entries.filter(isManual).map((e) => e.key));
  const noData = similarity ? r.noData.filter((e) => manualKeys.has(e.key)) : [];
  return { matches, recommendations: r.recommendations, noData, stats: r.stats };
}

/** "A", "A and B", "A, B and C" */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The reason line under a recommendation.
 * @param {{ reasons: { name: string, kind: 'outside'|'lineup' }[] }} rec
 * @returns {string} e.g. "because you like Loathe, Deftones and Jawbox"
 */
export function reasonText(rec) {
  const reasons = Array.isArray(rec?.reasons) ? rec.reasons : [];
  if (!reasons.length) return '';
  if (reasons.length === 1 && reasons[0].kind === 'lineup') return `because you like ${reasons[0].name}, who is also playing`;
  return `because you like ${joinNames(reasons.map((r) => r.name))}`;
}

/** Whether a pool this large has saturated the absolute bands, so bands should go by rank. */
export function useRelativeBands(poolSize, recommendations) {
  return poolSize >= LARGE_POOL && recommendations.filter((r) => r.score >= BAND_STRONG).length > RELATIVE_STRONG;
}

/**
 * Group recommendations under band headings, in score order; empty groups are left out.
 * @param {{ score: number, band: string }[]} recommendations sorted best first
 * @param {{ relative?: boolean }} [options] rank-based bands: the first RELATIVE_STRONG strong, the next RELATIVE_GOOD good
 * @returns {{ band: string, label: string, items: object[] }[]}
 */
export function groupByBand(recommendations, { relative = false } = {}) {
  const groups = new Map(BAND_ORDER.map((b) => [b, []]));
  recommendations.forEach((r, i) => {
    let band = r.band;
    if (relative) band = i < RELATIVE_STRONG ? 'strong' : i < RELATIVE_STRONG + RELATIVE_GOOD ? 'good' : 'worth-a-listen';
    (groups.get(band) ?? groups.get('worth-a-listen')).push(r);
  });
  return BAND_ORDER.filter((b) => groups.get(b).length).map((b) => ({ band: b, label: BAND_LABELS[b], items: groups.get(b) }));
}

/**
 * The listen link for the chosen service, and the others for the "more" control.
 * @param {{ name: string, links?: object }} artist
 * @param {string} service one of LISTEN_PLATFORMS
 * @returns {{ primary: { platform: string, label: string, url: string, kind: string, text: string }|null, others: object[] }}
 *   text: "Listen" for a verified link, "Search on Tidal" for a generated search
 */
export function listenFor(artist, service) {
  const all = listenLinks(artist).map((l) => ({ ...l, text: l.kind === 'verified' ? `Listen on ${l.label}` : `Search on ${l.label}` }));
  const primary = all.find((l) => l.platform === service) ?? all[0] ?? null;
  if (primary) primary.text = primary.kind === 'verified' ? 'Listen' : `Search on ${primary.label}`;
  return { primary, others: all.filter((l) => l !== primary) };
}

/** Label for the signal that linked two lineup artists in the [+] expansion. */
export function signalLabel(signal) {
  return signal === 'tags' ? 'similar tags' : 'similar listeners';
}

/**
 * Lineup artists similar to one lineup artist, for its [+] expansion.
 * @returns {{ n: number, name: string, artist: object, label: string }[]}
 */
export function similarFor(n, lineup) {
  return lineup.neighbours(n).flatMap((nb) => {
    const artist = lineup.byN(nb.n);
    return artist ? [{ n: nb.n, name: artist.name, artist, label: signalLabel(nb.signal) }] : [];
  });
}

/** Lineup numbers in the visitor's two lists (Treefort picks only, never the pool), ascending. */
export function sharePicks(matches, recommendations) {
  return [...new Set([...matches.map((m) => m.n), ...recommendations.map((r) => r.n)])].sort((a, b) => a - b);
}

/** The full share URL for the picks, or null if there are none. */
export function shareUrl(origin, year, picks) {
  if (!picks.length) return null;
  return `${origin}/#${encodeShare({ year, picks })}`;
}

/**
 * The shared-picks view for a location hash, or null when the fragment is not a valid share with at least one
 * artist this lineup knows (such fragments are ignored).
 * @returns {{ artists: object[] }|null} lineup artists, sorted by name
 */
export function sharedFromHash(hash, lineup) {
  const decoded = decodeShare(hash, lineup);
  if (!decoded || !decoded.picks.length) return null;
  const artists = decoded.picks.map((n) => lineup.byN(n)).filter(Boolean);
  artists.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { artists };
}

/**
 * Dev-only numbers logged after each recompute (read from the console when testing a real library).
 * @returns {{ poolSize: number, contributors: number, candidates: number, min: number|null, median: number|null,
 *   max: number|null, bands: { strong: number, good: number, worth: number }, relative: boolean }}
 */
export function diagnostics(pool, results) {
  const scores = results.stats?.scores ?? [];
  const sorted = [...scores].sort((a, b) => a - b);
  const round = (x) => (x === undefined ? null : Math.round(x * 1000) / 1000);
  return {
    poolSize: pool.entries.length,
    contributors: results.stats?.contributors ?? 0,
    candidates: scores.length,
    min: round(sorted[0]),
    median: round(sorted[Math.floor(sorted.length / 2)]),
    max: round(sorted[sorted.length - 1]),
    bands: {
      strong: scores.filter((s) => s >= BAND_STRONG).length,
      good: scores.filter((s) => s < BAND_STRONG && s >= BAND_GOOD).length,
      worth: scores.filter((s) => s < BAND_GOOD).length,
    },
    relative: useRelativeBands(pool.entries.length, results.recommendations),
  };
}

