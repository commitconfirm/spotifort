/**
 * Build stage logic: state + overrides -> public outputs. A pure function of its inputs (no clock, no network,
 * no file I/O), so unchanged inputs give byte-identical outputs.
 */
import { normalizeName } from '../../src/core/normalize.js';
import { PLATFORMS, cleanPlatformUrl } from '../../src/core/links.js';
import { indexOverrides, overrideFor, unusedOverrides } from './overrides.js';
import { effectiveSpotify, lastfmQueryName } from './state.js';
import { computeLineupSimilarity, fitReverseIndex, roundTo } from './similarity.js';
import { TAGS_IN_OUTPUT } from './constants.js';
import { formatReview, formatSanity } from './report.js';

/**
 * One record with overrides applied and untrusted Last.fm data removed.
 * Last.fm data is used only when it is for the name we asked for, was found, and was not autocorrected
 * to a different artist.
 */
/**
 * A Spotify match is confirmed when the chosen id resolved to a MusicBrainz artist (from that very Spotify URL)
 * whose name equals the festival name after normalisation. An override that sets the MBID by hand does not count.
 */
export function mbConfirms(record, override, spotifyId) {
  if ('mbid' in override || !spotifyId || !record.mbid) return false;
  if (record.mbFor !== spotifyId || record.mbFetched !== record.mbid || typeof record.mbName !== 'string') return false;
  return normalizeName(record.mbName) === normalizeName(record.name);
}

export function resolveRecord(record, override) {
  const sp = effectiveSpotify(record, override);
  const lf = record.lastfm ?? null;
  const stale = lf && lf.queriedName !== lastfmQueryName(record, override);
  const usable = Boolean(lf) && !stale && !lf.skipped && !lf.notFound && lf.nameChanged !== 'different';
  let lastfmWhy = null;
  if (!lf) lastfmWhy = 'not fetched';
  else if (stale) lastfmWhy = 'stale (override changed the name)';
  else if (lf.skipped) lastfmWhy = 'skipped by override';
  else if (lf.notFound) lastfmWhy = 'not found on Last.fm';
  else if (lf.nameChanged === 'different') lastfmWhy = `autocorrected to a different artist (${lf.resolvedName})`;

  const keys = [normalizeName(record.name)];
  if (usable) {
    const k = normalizeName(lf.resolvedName);
    if (k && !keys.includes(k)) keys.push(k);
  }

  const similar = usable ? lf.similar : [];
  const tags = Array.isArray(override.tags) ? override.tags.map((t) => [t.toLowerCase(), 100]) : usable ? lf.tags : [];

  const rawLinks = { ...(record.links ?? {}) };
  if (sp.ids[0]) rawLinks.spotify = `https://open.spotify.com/artist/${sp.ids[0]}`;
  if (!rawLinks.lastfm && usable && lf.url) rawLinks.lastfm = lf.url;
  Object.assign(rawLinks, override.links ?? {});
  const links = {};
  for (const p of PLATFORMS) {
    const url = rawLinks[p] == null ? null : cleanPlatformUrl(p, rawLinks[p]);
    if (url) links[p] = url;
  }

  const ids = {};
  for (const [p, v] of Object.entries({ ...(record.ids ?? {}), ...(override.ids ?? {}) })) {
    if (v != null) ids[p] = v;
  }
  const idOrder = ['tidal', 'appleMusic', 'deezer'];
  const orderedIds = Object.fromEntries(idOrder.filter((p) => ids[p]).map((p) => [p, ids[p]]));

  const mbConfirmed = mbConfirms(record, override, sp.ids[0]);
  const doubtful = sp.confidence === 'inexact' || sp.confidence === 'ambiguous' || override.unverified === true;
  const unverified = doubtful && !mbConfirmed;

  return {
    n: record.n,
    id: record.id,
    name: record.name,
    spotifyIds: sp.ids,
    confidence: sp.confidence,
    matchedName: sp.matchedName,
    spotifyResolved: sp.resolved,
    mbConfirmed,
    confirmedByMb: doubtful && mbConfirmed,
    unverified,
    mbid: 'mbid' in override ? override.mbid : (record.mbid ?? null),
    links,
    ids: orderedIds,
    lastfm: lf,
    lastfmUsable: usable,
    lastfmWhy,
    keys,
    similar,
    tags,
    note: override.note ?? null,
    hasOverride: Object.keys(override).length > 0,
  };
}

/**
 * @param {object} args
 * @param {object} args.state
 * @param {Record<string, object>} args.overrides
 * @returns {{lineup: object, similarity: object, legacy: object, review: string, sanity: string, stats: object, warnings: string[]}}
 */
export function buildOutputs({ state, overrides }) {
  const index = indexOverrides(overrides);
  const warnings = [];
  for (const name of unusedOverrides(index, state.artists)) warnings.push(`override "${name}" matches no artist in the state`);

  const active = state.artists.filter((a) => !a.removed).sort((a, b) => a.n - b.n);
  const artists = active.map((r) => resolveRecord(r, overrideFor(index, r.name)));

  const seen = new Map();
  for (const a of artists) {
    for (const k of a.keys) {
      if (seen.has(k) && seen.get(k) !== a.n) warnings.push(`"${a.name}" and artist n=${seen.get(k)} share the normalised name "${k}"`);
      else seen.set(k, a.n);
    }
  }

  const neighbours = computeLineupSimilarity(artists);
  const fit = fitReverseIndex(artists);
  const reverse = fit.reverse;

  const lineup = {
    year: state.year,
    lastUpdated: state.lastUpdated,
    artists: artists.map((a) => {
      const out = {
        n: a.n,
        id: a.id,
        name: a.name,
        spotifyIds: a.spotifyIds,
        ids: a.ids,
        links: a.links,
        tags: a.tags.slice(0, TAGS_IN_OUTPUT).map(([t]) => t),
        similar: neighbours.get(a.n).map((x) => [x.n, roundTo(x.s, 2), x.signal]),
      };
      if (a.unverified) out.unverified = true;
      return out;
    }),
  };

  const similarity = fit.similarity;

  const notOnSpotify = (a) => a.spotifyResolved && a.spotifyIds.length === 0;
  const legacyArtists = artists
    .map((a) => {
      const out = {
        name: a.name,
        spotifyId: a.spotifyIds[0] ?? null,
        spotifyUrl: a.spotifyIds[0] ? `https://open.spotify.com/artist/${a.spotifyIds[0]}` : null,
        notOnSpotify: notOnSpotify(a),
        genres: a.tags.slice(0, TAGS_IN_OUTPUT).map(([t]) => t),
      };
      if (a.spotifyIds.length > 1) out.additionalSpotifyIds = a.spotifyIds.slice(1);
      return out;
    })
    .sort((x, y) => x.name.localeCompare(y.name));
  const legacy = {
    lastUpdated: state.lastUpdated,
    enriched: artists.length > 0 && artists.every((a) => a.spotifyResolved),
    artists: legacyArtists,
  };

  const counts = { zero: 0, oneTwo: 0, threeSeven: 0, eightPlus: 0 };
  const signals = { direct: 0, neighbours: 0, tags: 0 };
  for (const list of neighbours.values()) {
    if (list.length === 0) counts.zero++;
    else if (list.length <= 2) counts.oneTwo++;
    else if (list.length <= 7) counts.threeSeven++;
    else counts.eightPlus++;
    for (const x of list) signals[x.signal]++;
  }
  const stats = {
    records: state.artists.length,
    active: artists.length,
    removed: state.artists.length - artists.length,
    confidence: Object.fromEntries(
      ['exact', 'inexact', 'ambiguous', 'manual', 'none', 'unresolved'].map((c) => [
        c,
        artists.filter((a) => (a.confidence ?? 'unresolved') === c).length,
      ])
    ),
    mbids: artists.filter((a) => a.mbid).length,
    linksPerPlatform: Object.fromEntries(PLATFORMS.map((p) => [p, artists.filter((a) => a.links[p]).length])),
    idsPerPlatform: Object.fromEntries(['tidal', 'appleMusic', 'deezer'].map((p) => [p, artists.filter((a) => a.ids[p]).length])),
    withSimilar: artists.filter((a) => a.similar.length > 0).length,
    withTags: artists.filter((a) => a.tags.length > 0).length,
    neighbourCounts: counts,
    neighbourSignals: signals,
    unverified: artists.filter((a) => a.unverified).length,
    confirmedByMusicbrainz: artists.filter((a) => a.confirmedByMb).length,
    reverseMinMatch: fit.minMatch,
    similarityGzip: fit.gzip,
    similarityRaw: fit.raw,
    reverseNames: reverse.names.length,
    reversePairs: reverse.edges.reduce((s, e) => s + e.length / 2, 0),
  };

  const review = formatReview({ state, artists, warnings, stats });
  const sanity = formatSanity({ artists, neighbours, similarity, stats });
  return { lineup, similarity, legacy, review, sanity, stats, warnings };
}
