/**
 * Text reports written by the build stage. Pure: same inputs, same text (no dates except state's own).
 */
import { normalizeName } from '../../src/core/normalize.js';
import { scheduleSummary } from './dionysus.js';
import {
  MIN_SIMILARITY,
  NEIGHBOURS_PER_ARTIST,
  WEIGHT_NEIGHBOURS,
  WEIGHT_TAGS,
} from './constants.js';

export const SANITY_LINEUP = [
  'Modest Mouse', 'Courtney Barnett', 'Orville Peck', 'Bully', 'Ratboys', 'Wishy', 'Wild Pink', 'Narrow Head',
  'Truth Club', 'Drug Church', 'Black Lips', 'Surprise Chef', 'All Them Witches', 'Waylon Wyatt',
  'Thee Sacred Souls', 'Jesse Welles', 'Eartheater', 'Sleaford Mods', 'Iceage', 'Guitar Wolf',
];
export const SANITY_OUTSIDE = [
  'Phoebe Bridgers', 'Big Thief', 'Waxahatchee', 'Radiohead', 'Kendrick Lamar',
  'Zach Bryan', 'IDLES', 'Slowdive', 'Turnstile', 'Khruangbin',
];

const list = (items, fmt) => (items.length ? items.map((x) => `- ${fmt(x)}`).join('\n') : '- none');
const spotifyUrl = (id) => `https://open.spotify.com/artist/${id}`;

/**
 * The review report for the owner / the scheduled pull request.
 */
export function formatReview({ state, artists, warnings, stats }) {
  const scrape = state.lastScrape ?? { date: null, added: [], removed: [] };
  const inexact = artists.filter((a) => a.confidence === 'inexact');
  const ambiguous = artists.filter((a) => a.confidence === 'ambiguous');
  const ambiguousConfirmed = ambiguous.filter((a) => !a.unverified);
  const ambiguousOpen = ambiguous.filter((a) => a.unverified);
  const manualUnverified = artists.filter((a) => a.confidence === 'manual' && a.unverified);
  const manualConfirmed = artists.filter((a) => a.confidence === 'manual' && a.confirmedByMb);
  const different = artists.filter((a) => a.lastfm?.nameChanged === 'different' && !a.hasOverride);
  const noSimilar = artists.filter((a) => a.similar.length === 0);
  const unresolved = artists.filter((a) => !a.spotifyResolved);
  const src = stats.spotifySources;
  const nonArtistLinks = artists.filter((a) => a.festival?.spotify && a.festival.spotify.kind !== 'artist' && a.festival.spotify.kind !== 'album');
  const searchOnly = artists.filter((a) => a.spotifySource === 'search' && !a.festival?.spotify);
  const notFetched = artists.filter((a) => a.hasSlug && !a.festival);
  const noSlug = artists.filter((a) => !a.hasSlug && !a.festival);
  const changedByFestival = artists.filter((a) => a.supersedes);
  const renames = (scrape.renamed ?? []).map((r) => ({ ...r, rekey: Boolean(artists.find((a) => a.n === r.n)?.formerNames.includes(r.from)) }));
  const out = [];
  out.push(`# Lineup review, ${state.year}`);
  out.push('');
  out.push(`State last updated ${state.lastUpdated ?? 'never'}. ${artists.length} artists on the lineup.`);
  out.push('Fix anything below by adding an entry to `data/' + state.year + '/overrides.json`, then run `npm run lineup:build`.');
  out.push('');
  out.push(`similarity.json: reverse-index cutoff ${stats.reverseMinMatch} (lowest that fits the size budget), ${stats.reverseNames} names, ${(stats.similarityGzip / 1024).toFixed(1)} KB gzip.`);
  out.push('');
  out.push(...sourceSection(state.source));
  out.push('');
  out.push('## Spotify ids by source');
  out.push(`override ${src.override}, festival artist link ${src.festival}, festival album link ${src['festival-album']}, search ${src.search}, none ${src.none}${src.unresolved ? `, unresolved ${src.unresolved}` : ''}`);
  out.push('');
  out.push(`## Festival link differs from earlier search result (${changedByFestival.length})`);
  out.push('The festival link wins. Check the earlier result was wrong, not the festival link.');
  out.push(list(changedByFestival, (a) => `${a.name}: ${a.supersedes.ids.map(spotifyUrl).join(', ')}${a.supersedes.matchedName ? ` (${a.supersedes.matchedName}, ${a.supersedes.confidence})` : ` (${a.supersedes.confidence})`} -> ${a.spotifyIds.map(spotifyUrl).join(', ')}`));
  out.push('');
  out.push(`## Festival Spotify link is not an artist or album page (${nonArtistLinks.length})`);
  out.push(list(nonArtistLinks, (a) => `${a.name}: ${a.festival.spotify.kind}: ${a.festival.spotify.url} (resolved by ${a.spotifySource}${a.confidence ? `, ${a.confidence}` : ''})`));
  out.push('');
  out.push(`## No festival Spotify link, resolved by search: the weakest matches (${searchOnly.length})`);
  out.push(list(searchOnly, (a) => `${a.name} -> ${a.matchedName ?? '?'} ${spotifyUrl(a.spotifyIds[0])} (${a.confidence}${a.unverified ? ', unverified' : ''})`));
  out.push('');
  out.push(`## Fallback feed: not fetched (${notFetched.length}); artists with neither a slug nor festival data (${noSlug.length})`);
  out.push(list(notFetched, (a) => `${a.name} (retried next run)`));
  if (noSlug.length) out.push(`No slug on the lineup page and no API data: ${noSlug.map((a) => a.name).join(', ')}`);
  out.push('');
  out.push(`## Added (lineup update of ${scrape.date ?? 'n/a'}): ${scrape.added.length}`);
  out.push(list(scrape.added, (n) => n));
  out.push('');
  out.push(`## Removed from the festival lineup: ${scrape.removed.length}`);
  out.push(list(scrape.removed, (n) => n));
  out.push('');
  out.push(`## Renamed by the festival, number kept (${renames.length})`);
  out.push(list(renames, (r) => `${r.from} -> ${r.to} (n=${r.n})${r.rekey ? `. OVERRIDE KEYED "${r.from}" STILL APPLIES; RE-KEY IT to "${r.to}" in overrides.json` : r.cosmetic ? ' (spelling only)' : ''}`));
  out.push('');
  out.push(`## Spotify: inexact matches, top hit used (${inexact.length})`);
  out.push(list(inexact, (a) => `${a.name} -> ${a.matchedName} ${spotifyUrl(a.spotifyIds[0])}`));
  out.push('');
  out.push(`## Spotify: several artists share the exact name, first used (${ambiguous.length})`);
  out.push('');
  out.push(`### Confirmed by MusicBrainz, not flagged (${ambiguousConfirmed.length})`);
  out.push(ambiguousConfirmed.length ? ambiguousConfirmed.map((a) => a.name).join(', ') : 'none');
  out.push('');
  out.push(`### Needs a human look, flagged unverified (${ambiguousOpen.length})`);
  out.push(list(ambiguousOpen, (a) => `${a.name} -> ${spotifyUrl(a.spotifyIds[0])}`));
  out.push('');
  out.push(`## Spotify: owner-accepted unconfirmed matches, flagged unverified (${manualUnverified.length})`);
  out.push(list(manualUnverified, (a) => `${a.name} -> ${spotifyUrl(a.spotifyIds[0])}`));
  if (manualConfirmed.length) out.push(`Accepted by the owner and confirmed by MusicBrainz, not flagged: ${manualConfirmed.map((a) => a.name).join(', ')}`);
  out.push('');
  out.push(`## Last.fm autocorrected to a different artist, data not used (${different.length})`);
  out.push(list(different, (a) => `${a.name} -> ${a.lastfm.resolvedName} (${a.lastfm.listeners ?? '?'} listeners). Same artist? Set "lastfmName" to that name. Wrong artist? Set "lastfmName": null.`));
  out.push('');
  out.push(`## No Last.fm similar artists (${noSimilar.length})`);
  out.push(list(noSimilar, (a) => `${a.name}: ${a.lastfmWhy ?? `Last.fm returned an empty list (${a.lastfm?.listeners ?? '?'} listeners)`}`));
  out.push('');
  out.push(...scheduleSection(state.schedule));
  if (unresolved.length) {
    out.push('');
    out.push(`## Spotify not resolved yet (${unresolved.length})`);
    out.push(list(unresolved, (a) => a.name));
  }
  if (warnings.length) {
    out.push('');
    out.push('## Warnings');
    out.push(list(warnings, (w) => w));
  }
  out.push('');
  return out.join('\n');
}

function sourceSection(source) {
  const out = ['## Lineup source'];
  if (!source) {
    out.push('Not recorded (the state predates the vendor API source).');
  } else if (source.kind === 'fallback') {
    out.push('**Source this run: FALLBACK** (page scrape for names, the festival\'s undocumented performer feed for links).');
    out.push(`The vendor API was not used: ${source.reason}.`);
  } else {
    const ex = source.excluded ?? { byStatus: {}, byTag: [] };
    const statuses = Object.entries(ex.byStatus ?? {});
    const byTag = ex.byTag ?? [];
    out.push(`Source this run: the vendor API. ${source.performers} performers included.`);
    out.push(`Excluded by status (${statuses.reduce((n, [, v]) => n + v, 0)}): ${statuses.length ? statuses.map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}.`);
    out.push(`Excluded by tag, not matched against music services (${byTag.length}):`);
    out.push(list(byTag, (t) => `${t.name} (${t.tags.join(', ')})`));
    if (source.excluded?.unusable) out.push(`Entries with no id or name, skipped: ${source.excluded.unusable}.`);
    if (source.duplicateNames?.length) out.push(`Performers sharing a normalised name with another, skipped: ${source.duplicateNames.join(', ')}.`);
    if (source.musicTagsNotInTagList?.length) out.push(`WARNING: configured music tags not in the festival's tag list: ${source.musicTagsNotInTagList.join(', ')}.`);
  }
  return out;
}

function scheduleSection(schedule) {
  const s = scheduleSummary(schedule);
  const out = ['## Schedule (groundwork, not shown on the site)'];
  if (!schedule) {
    out.push('No schedule data fetched yet.');
    return out;
  }
  out.push(`${s.venues} venues, ${s.events} events${s.first ? `, ${s.first} to ${s.last}` : ''}${s.canceled ? `, ${s.canceled} canceled` : ''}.`);
  out.push(`Events with performers not on the lineup: ${s.withUnknownPerformers} (${s.unknownPerformerIds} distinct performer ids). Events with a venue not in the venue list: ${s.withUnknownVenue}. Events with no venue: ${s.withoutVenue}.`);
  if (s.events === 0) out.push('The festival has not published set times yet.');
  return out;
}

const find = (artists, name) => artists.find((a) => normalizeName(a.name) === normalizeName(name));
const f2 = (x) => x.toFixed(2);

/**
 * The sanity report: neighbours for hand-picked artists, distribution, signal mix, reverse-index targets.
 */
export function formatSanity({ artists, neighbours, similarity, stats }) {
  const keys = similarity.names.map(normalizeName); // the client derives keys the same way
  const byN = new Map(artists.map((a) => [a.n, a]));
  const out = [];
  out.push('# Sanity report');
  out.push('');
  out.push(`Weights: neighbours ${WEIGHT_NEIGHBOURS}, tags ${WEIGHT_TAGS}. Keep top ${NEIGHBOURS_PER_ARTIST} with s >= ${MIN_SIMILARITY}. Reverse index: match >= ${similarity.minMatch} (the lowest cutoff on the ladder that fits the size budget).`);
  out.push('Each neighbour: score [dominant signal] (d direct, g neighbours cosine, t tag cosine).');
  out.push('');
  out.push('## Lineup neighbours');
  for (const name of SANITY_LINEUP) {
    const a = find(artists, name);
    out.push('');
    if (!a) {
      out.push(`### ${name}\n(not on the lineup)`);
      continue;
    }
    out.push(`### ${a.name}`);
    out.push(`tags: ${a.tags.slice(0, 5).map(([t]) => t).join(', ') || '(none)'}; similar entries: ${a.similar.length}`);
    const list2 = neighbours.get(a.n);
    if (!list2.length) out.push('(no neighbours)');
    list2.forEach((x, i) => {
      out.push(`${i + 1}. ${byN.get(x.n).name}  ${f2(x.s)} [${x.signal}] (d ${f2(x.d)}, g ${f2(x.g)}, t ${f2(x.t)})`);
    });
  }
  const c = stats.neighbourCounts;
  const s = stats.neighbourSignals;
  const totalLinks = s.direct + s.neighbours + s.tags;
  const fewer = c.zero + c.oneTwo;
  out.push('');
  out.push('## Neighbour counts');
  out.push(`- 0 neighbours: ${c.zero}`);
  out.push(`- 1-2: ${c.oneTwo}`);
  out.push(`- 3-7: ${c.threeSeven}`);
  out.push(`- 8-12: ${c.eightPlus}`);
  out.push(`- artists with fewer than three neighbours: ${fewer}`);
  out.push('');
  out.push('## Dominant signal of all neighbour links');
  for (const k of ['direct', 'neighbours', 'tags']) out.push(`- ${k}: ${s[k]} (${totalLinks ? Math.round((100 * s[k]) / totalLinks) : 0}%)`);
  out.push('');
  out.push('## Reverse index targets (top 5 lineup artists)');
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  for (const name of SANITY_OUTSIDE) {
    const i = keyIndex.get(normalizeName(name));
    if (i === undefined) {
      out.push(`- ${name}: not in the index`);
      continue;
    }
    const e = similarity.edges[i];
    const parts = [];
    for (let j = 0; j < e.length && j < 10; j += 2) parts.push(`${byN.get(e[j])?.name ?? `n=${e[j]}`} ${e[j + 1]}`);
    out.push(`- ${similarity.names[i]} (${e.length / 2} targets): ${parts.join(', ')}`);
  }
  out.push('');
  return out.join('\n');
}
