// Everything about the main page that can be decided without a DOM: pool -> matches -> recommendations -> what each
// list shows, the wording of reasons, band grouping, autocomplete suggestions, example validation, share picks, the
// wording of the playlist panel (before, during and after making a playlist) and dev diagnostics. Pure functions over plain data, unit tested in tests/app-state.test.js. The UI modules in src/ui/
// only render what these return.

import { normalizeName } from '../core/normalize.js';
import { addPicked, addTyped, SOURCE_PICKED, SOURCE_TYPED } from '../core/pool.js';
import { matchPool } from '../core/match.js';
import { recommend, BAND_GOOD, BAND_STRONG } from '../core/recommend.js';
import { listenLinks } from '../core/links.js';
import { decodeShare, encodeShare } from '../core/share.js';
import { LEFT_OUT, MAX_PLAYLIST_ARTISTS, TRACKS_PER_ARTIST, planEstimate } from '../core/playlist.js';

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


// --- playlist ------------------------------------------------------------------------------------
// Wording for the "Make a Spotify playlist" panel. The engine is src/sources/spotify-playlist.js. Two rules hold for
// every string here (tested): an outcome where a playlist may already exist ('incomplete', 'unconfirmed') never says to
// try again, and nothing calls what Spotifort makes a "private playlist" (the API cannot make one).

/** Shown after a playlist was made: what Spotify does with its visibility, and how to change it. */
export const PLAYLIST_VISIBILITY_NOTE = 'Spotify labels this playlist “Public Playlist”, and anyone who has its link can open it. It is not shown on your profile. To change that, open it in Spotify, open its ••• menu and choose Make private.';

const plural = (n, one, many) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** How many picks were beyond the cap, from a plan's `beyondCap`; junk counts as none. */
const picksBeyondCap = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

/**
 * What the outcome says about picks beyond the cap, or null. They are not "left out": nothing is wrong with them, so
 * they get a count and no list of names.
 * @param {unknown} beyondCap from playlistPlan
 * @returns {string|null}
 */
export function beyondCapText(beyondCap) {
  const n = picksBeyondCap(beyondCap);
  if (!n) return null;
  return `A playlist takes tracks from ${formatCount(MAX_PLAYLIST_ARTISTS)} picks at most. ${formatCount(n)} of your picks ${n === 1 ? 'was' : 'were'} further down your lists and ${n === 1 ? 'is' : 'are'} not in it.`;
}

/**
 * The panel before anything is made.
 * @param {{ artists: object[], leftOut: object[], beyondCap?: number }} plan from playlistPlan
 * @param {{ tokenReady?: boolean, madeBefore?: boolean }} [options] tokenReady: a playlist login is in memory (no
 *   redirect needed); madeBefore: a playlist was made (or may have been) in this visit
 * @returns {{ status: 'none'|'ready', summary: string, notes: string[], buttonText: string }}
 */
export function playlistIntro(plan, { tokenReady = false, madeBefore = false } = {}) {
  const { artists, tracks } = planEstimate(plan);
  const leftOut = Array.isArray(plan?.leftOut) ? plan.leftOut.length : 0;
  const buttonText = tokenReady ? 'Make the playlist' : 'Continue to Spotify';
  if (!artists) {
    const summary = leftOut
      ? 'None of your Treefort picks has a Spotify page we are sure of, so there is nothing to put in a playlist.'
      : 'Nothing to make a playlist from yet. Add artists until something appears in your lists.';
    return { status: 'none', summary, notes: [], buttonText };
  }
  const beyond = picksBeyondCap(plan?.beyondCap);
  // Capped: say so in the first sentence. "The first 100 of your N" counts every pick, as the lists do.
  const from = beyond
    ? `the first ${formatCount(artists)} of your ${formatCount(artists + leftOut + beyond)} Treefort picks`
    : `${formatCount(artists)} of your Treefort picks`;
  const summary = `Spotifort will make one new playlist in your Spotify account, with about ${formatCount(tracks)} tracks: up to ${TRACKS_PER_ARTIST} each from ${from}, in the order they are listed. Nothing else in your account is changed.`;
  const notes = [];
  if (beyond) notes.push(`A playlist takes tracks from ${formatCount(MAX_PLAYLIST_ARTISTS)} picks at most, so the ${formatCount(beyond)} further down your lists ${beyond === 1 ? 'is' : 'are'} not included.`);
  if (leftOut) notes.push(`${formatCount(leftOut)} of your picks ${leftOut === 1 ? 'has' : 'have'} no Spotify page we are sure of and will be left out. You will see which afterwards.`);
  if (madeBefore) notes.push('You already made a playlist in this visit. This makes another one; it does not replace the first.');
  return { status: 'ready', summary, notes, buttonText };
}

/**
 * The visible progress line while a playlist is made.
 * @param {{ phase?: string, done?: number, total?: number }} p a progress event from createPlaylist
 * @returns {string}
 */
export function playlistProgressText(p) {
  const done = formatCount(p?.done ?? 0);
  const total = formatCount(p?.total ?? 0);
  if (p?.phase === 'lookup') return `Looking up tracks… ${done} of ${total} artists`;
  if (p?.phase === 'create') return 'Creating the playlist…';
  if (p?.phase === 'add') return `Adding tracks… ${done} of ${total}`;
  return 'Getting your picks ready…';
}

const LEFT_OUT_LABELS = [
  [LEFT_OUT.UNVERIFIED, 'We are not sure which Spotify artist this is, so we did not guess:'],
  [LEFT_OUT.NO_SPOTIFY, 'No Spotify page that we know of:'],
  [LEFT_OUT.NO_TRACKS, 'No tracks of their own found on Spotify:'],
  [LEFT_OUT.QUOTA, 'Spotify stopped answering lookups before we got to them:'],
  [LEFT_OUT.LOOKUP_FAILED, 'The lookup failed for them:'],
];

/**
 * Left-out artists grouped by reason, in a fixed order; empty groups are omitted, artists keep the order given.
 * @param {unknown} leftOut [{ n, name, reason }] from createPlaylist
 * @returns {{ reason: string, label: string, artists: { n: number, name: string }[] }[]}
 */
export function leftOutGroups(leftOut) {
  const known = new Map(LEFT_OUT_LABELS.map(([reason]) => [reason, []]));
  const other = [];
  for (const a of Array.isArray(leftOut) ? leftOut : []) {
    if (!a || typeof a !== 'object') continue;
    const item = { n: a.n, name: typeof a.name === 'string' ? a.name : '' };
    (known.get(a.reason) ?? other).push(item);
  }
  const groups = LEFT_OUT_LABELS.filter(([reason]) => known.get(reason).length).map(([reason, label]) => ({ reason, label, artists: known.get(reason) }));
  if (other.length) groups.push({ reason: 'other', label: 'Left out:', artists: other });
  return groups;
}

const SEARCH_STOP_TEXT = {
  quota: 'Spotify’s daily search limit for your Client ID was reached part-way through, so for the remaining artists we looked at their newest releases instead. The limit can take up to a day to clear.',
  rate: 'Spotify started refusing searches part-way through (too many requests), so for the remaining artists we looked at their newest releases instead. If that was a daily limit, it can take up to a day to clear.',
  errors: 'Spotify’s search kept failing part-way through, so for the remaining artists we looked at their newest releases instead.',
  network: 'A search got no answer part-way through, so for the remaining artists we looked at their newest releases instead.',
};

const RELEASES_STOP_TEXT = {
  quota: 'Spotify’s daily limit for your Client ID was reached while we were looking at newest releases, so the artists not yet looked up were left out. The limit can take up to a day to clear.',
  rate: 'Spotify started refusing requests (too many requests) while we were looking at newest releases, so the artists not yet looked up were left out. If that was a daily limit, it can take up to a day to clear.',
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const own = (table, key) => (typeof key === 'string' && hasOwn(table, key) ? table[key] : null);

/** Why search was switched off part-way (createPlaylist's searchStopReason), or null. */
export function searchStopText(reason) {
  return own(SEARCH_STOP_TEXT, reason);
}

/** Why the newest-releases route stopped (createPlaylist's releasesStopReason), or null. */
export function releasesStopText(reason) {
  return own(RELEASES_STOP_TEXT, reason);
}

const nonNegative = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * What the panel says after createPlaylist resolved. Reads `status` first and never `error`.
 * @param {object} result from createPlaylist
 * @param {{ beyondCap?: number }} [options] the plan's count of picks beyond the cap
 * @returns {{ status: string, heading: string, lines: string[], link: { url: string, text: string, label: string }|null,
 *   visibility: boolean, notes: string[], capNote: string|null, newest: { label: string, names: string[] }|null,
 *   leftOut: { reason: string, label: string, artists: { n: number, name: string }[] }[], announce: string }}
 */
export function playlistOutcome(result, { beyondCap = 0 } = {}) {
  const status = result?.status;
  const name = typeof result?.name === 'string' && result.name ? result.name : '';
  const quoted = name ? `“${name}”` : 'the playlist';
  if (status !== 'created' && status !== 'incomplete' && status !== 'empty') {
    const look = `Look in your Spotify library for ${name ? quoted : 'it'} before you make another one.`;
    return {
      status: 'unconfirmed',
      heading: 'We cannot tell whether your playlist was made',
      lines: [
        `Spotify did not confirm it. ${look}`,
        'If it is there, it is empty: no tracks were added, and you can delete it in Spotify. If it is not there, nothing was created.',
      ],
      link: null,
      visibility: false,
      notes: [],
      capNote: null,
      newest: null,
      leftOut: [],
      announce: 'Spotify did not confirm that the playlist was made. Look in your Spotify library before making another.',
    };
  }
  const notes = [searchStopText(result.searchStopReason), releasesStopText(result.releasesStopReason)].filter(Boolean);
  const leftOut = leftOutGroups(result.leftOut);
  const capNote = beyondCapText(beyondCap);
  if (status === 'empty') {
    return {
      status,
      heading: 'No playlist was made',
      lines: ['No tracks were found on Spotify for your picks, so nothing was created in your account.'],
      link: null,
      visibility: false,
      notes,
      capNote,
      newest: null,
      leftOut,
      announce: 'No playlist was made: no tracks were found.',
    };
  }
  const trackCount = nonNegative(result.trackCount);
  const artistCount = nonNegative(result.artistCount);
  const plannedTracks = nonNegative(result.plannedTracks);
  const url = typeof result.url === 'string' ? result.url : null;
  const link = url ? { url, text: 'Open Spotify', label: 'Open Spotify to see your playlist' } : null;
  const names = (Array.isArray(result.newestReleases) ? result.newestReleases : []).map((a) => (typeof a?.name === 'string' ? a.name : '')).filter(Boolean);
  const newest = names.length ? { label: 'Tracks from newest releases were used for:', names } : null;
  const tracks = plural(trackCount, 'track', 'tracks');
  const artists = plural(artistCount, 'artist', 'artists');
  if (status === 'incomplete') {
    return {
      status,
      heading: 'Your playlist was made, but it is not complete',
      lines: [
        trackCount > 0
          ? `Spotify stopped accepting tracks part-way. At least ${formatCount(trackCount)} of ${formatCount(plannedTracks)} tracks are in ${quoted}.`
          : `Spotify stopped accepting tracks before any were confirmed, so ${quoted} may be empty.`,
        'Open it in Spotify to see what it holds. Making a playlist again would create a second one; it would not finish this one.',
      ],
      link,
      visibility: true,
      notes,
      capNote,
      newest,
      leftOut,
      announce: 'Your playlist was made, but not every track was added.',
    };
  }
  return {
    status,
    heading: 'Your playlist is ready',
    lines: [`${tracks} from ${artists} ${trackCount === 1 ? 'is' : 'are'} in ${quoted}.`],
    link,
    visibility: true,
    notes,
    capNote,
    newest,
    leftOut,
    announce: `Your playlist is ready: ${tracks} from ${artists}.`,
  };
}

const FAILURE_TEXT = {
  auth: 'Your Spotify login had expired before anything was created. Log in again to make the playlist.',
  forbidden: 'Spotify refused the request, so nothing was created. Check that you approved the playlist permission, and that you logged in with the Spotify account your Client ID belongs to.',
  quota: 'Spotify’s daily limit for your Client ID has been reached, so nothing was created. It can take up to a day to clear.',
  rate: 'Spotify is refusing requests right now (too many requests), so nothing was created. Wait a while before trying again; if it is a daily limit, it can take up to a day to clear.',
  http: 'Spotify returned an error, so nothing was created. You can try again.',
  network: 'Spotify could not be reached, so nothing was created. Check your connection and try again.',
  data: 'We could not load the artist data, so nothing was created. You can try again.',
};
FAILURE_TEXT.scope = FAILURE_TEXT.forbidden;

/**
 * What the panel says when createPlaylist rejected (nothing was created), or the run could not start.
 * @param {{ kind?: string }|null|undefined} err
 * @returns {{ kind: string, heading: string, text: string, announce: string }}
 */
export function playlistFailure(err) {
  const kind = typeof err?.kind === 'string' && hasOwn(FAILURE_TEXT, err.kind) ? err.kind : 'other';
  const text = FAILURE_TEXT[kind] ?? 'Something went wrong before the playlist was made, so nothing was created. You can try again.';
  return { kind, heading: 'No playlist was made', text, announce: `No playlist was made. ${text}` };
}
