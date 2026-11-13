#!/usr/bin/env node
/**
 * Stage 1: the lineup. Merges the festival's performers into data/<year>/state.json.
 *
 *   Primary   the festival app vendor's documented public API (festival.config.js `api`): performers (names,
 *             Spotify and other platform links, hometown), plus venues, tags and events for the schedule section.
 *   Fallback  when the API request fails, answers with something other than a JSON array, or yields fewer than
 *             MIN_SCRAPED_NAMES performers: scrape the festival's lineup page for names, then read the festival's
 *             own performer feed for links (scripts/lineup-festival.js). Reported loudly, and in review.md.
 *
 * New names get the next artist number; renamed performers keep theirs (matched by API id first); performers
 * gone from the source are marked `removed` (never deleted). Fails loudly, changing nothing, when too few
 * performers come back or too much of the lineup would go. Venues, tags and events never fail the stage.
 *
 * Usage: node scripts/lineup-source.js [--print]   (--print: list the names, write nothing)
 * Env:   SPOTIFORT_LINEUP_SOURCE=fallback  skip the API (to test or exercise the fallback)
 *        SPOTIFORT_LINEUP_SOURCE=api       never fall back: fail when the API cannot supply the lineup
 */
import { FESTIVAL, loadEnv, loadOverrides, loadState, saveState, today } from './lib/store.js';
import { parseLineupCards, parseRetryAfter } from './lib/lineup-pipeline.js';
import { mergeLineup } from './lib/state.js';
import { indexOverrides } from './lib/overrides.js';
import { cleanSlug } from './lib/festival.js';
import { buildSchedule, fetchDionysus, numberByApiId, scheduleSummary } from './lib/dionysus.js';
import { createClient } from './lib/http.js';
import { API_MAX_ATTEMPTS, API_MIN_INTERVAL_MS, API_TIMEOUT_MS, FESTIVAL_CLIENT_NAME, MIN_SCRAPED_NAMES } from './lib/constants.js';
import { fetchFestivalLinks } from './lineup-festival.js';

async function fetchPage(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': FESTIVAL_CLIENT_NAME }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60, parseRetryAfter(res.headers.get('retry-after')) ?? 2 ** attempt);
      console.log(`  HTTP ${res.status}; waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Lineup page returned HTTP ${res.status}`);
    return res.text();
  }
  throw new Error('Lineup page kept rate limiting us');
}

async function scrapeCards() {
  console.log(`  scraping ${FESTIVAL.lineupUrl}`);
  const cards = parseLineupCards(await fetchPage(FESTIVAL.lineupUrl)).map((c) => ({ name: c.name, slug: cleanSlug(c.slug) }));
  if (cards.length < MIN_SCRAPED_NAMES) {
    throw new Error(
      `Only found ${cards.length} artist names (expected at least ${MIN_SCRAPED_NAMES}). ` +
      'The page markup has probably changed (looking for <h3 class="lineup-artist-name">). State not changed.'
    );
  }
  return cards;
}

/** Put `source` and `schedule` after `lastScrape` so the large artists array stays last in state.json. */
function withSections(state, { source, schedule }) {
  const { year, lastUpdated, lastScrape, source: _s, schedule: _c, artists, ...rest } = state;
  return { year, lastUpdated, lastScrape, ...(source && { source }), ...(schedule && { schedule }), ...rest, artists };
}

function newSchedule(api, state) {
  const prev = state.schedule ?? null;
  const notes = [];
  const gotVenues = api.venues.ok;
  const gotEvents = api.events.ok;
  for (const [what, r] of [['venues', api.venues], ['tags', api.tags], ['events', api.events]]) {
    if (!r.ok) notes.push(`${what}: ${r.reason}`);
  }
  if (!gotVenues && !gotEvents) return { schedule: prev, notes };
  const venues = gotVenues ? api.venues.value : (prev?.venues ?? []);
  const schedule = gotEvents
    ? buildSchedule({ venues, events: api.events.value, numberByApiId: numberByApiId(state.artists) })
    : { venues, events: prev?.events ?? [], unknownPerformerIds: prev?.unknownPerformerIds ?? 0 };
  return { schedule, notes };
}

async function main() {
  loadEnv(); // only for SPOTIFORT_CACHE_DIR; nothing here needs a credential
  const mode = (process.env.SPOTIFORT_LINEUP_SOURCE ?? 'auto').toLowerCase();
  if (!['auto', 'api', 'fallback'].includes(mode)) throw new Error(`SPOTIFORT_LINEUP_SOURCE must be auto, api or fallback (got "${mode}")`);
  const print = process.argv.includes('--print');
  const date = today();
  const state = loadState();
  const overrideIndex = indexOverrides(loadOverrides());
  console.log(`${FESTIVAL.name} ${FESTIVAL.year}: lineup source`);

  let api = null;
  let fallbackReason = null;
  if (mode === 'fallback') {
    fallbackReason = 'forced by SPOTIFORT_LINEUP_SOURCE=fallback';
  } else {
    console.log(`  vendor API ${FESTIVAL.api.baseUrl}/festivals/${FESTIVAL.api.festivalId}`);
    const client = createClient({
      cacheDir: null, // the lineup must always be live
      minIntervalMs: API_MIN_INTERVAL_MS,
      maxAttempts: API_MAX_ATTEMPTS,
      timeoutMs: API_TIMEOUT_MS,
      headers: { 'User-Agent': FESTIVAL_CLIENT_NAME },
      log: console.log,
    });
    api = await fetchDionysus(client, FESTIVAL.api);
    if (!api.performers.ok) {
      if (mode === 'api') throw new Error(`The vendor API could not supply the lineup: ${api.performers.reason}. State not changed.`);
      fallbackReason = api.performers.reason;
    }
  }

  if (fallbackReason) {
    console.warn('\n' + '='.repeat(78));
    console.warn(`WARNING: FALLING BACK to the page scrape: ${fallbackReason}`);
    console.warn('The lineup comes from the festival web page and its undocumented performer feed this run.');
    console.warn('='.repeat(78) + '\n');
    const cards = await scrapeCards();
    if (print) {
      cards.forEach((c) => console.log(c.name));
      return;
    }
    const merged = mergeLineup(state, cards, date, { overrideIndex });
    const next = withSections(merged.state, { source: { kind: 'fallback', reason: fallbackReason }, schedule: merged.state.schedule });
    saveState(next);
    report(merged, next, cards.length);
    console.log(`  cards with a festival slug: ${cards.filter((c) => c.slug).length} of ${cards.length}`);
    try {
      await fetchFestivalLinks();
    } catch (err) {
      console.warn(`\nWARNING: festival links stage did not complete: ${err.message}`);
    }
    return;
  }

  const { performers } = api;
  console.log(`  performers in the answer: ${performers.total}; included ${performers.included.length}`);
  const ex = performers.excluded;
  const byStatus = Object.entries(ex.byStatus).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`  excluded by status: ${byStatus || 'none'}; by tag: ${ex.byTag.length}; unusable entries: ${ex.invalid}`);
  for (const t of ex.byTag) console.log(`    - ${t.name} (${t.tags.join(', ')}): not a music tag`);
  if (print) {
    performers.included.forEach((p) => console.log(p.name));
    return;
  }
  const entries = performers.included.map((p) => ({ name: p.name, apiId: p.apiId, festival: p.festival }));
  const merged = mergeLineup(state, entries, date, { overrideIndex });
  const source = {
    kind: 'api',
    performers: performers.included.length,
    excluded: { byStatus: ex.byStatus, byTag: ex.byTag, ...(ex.invalid > 0 && { unusable: ex.invalid }) },
    ...((performers.duplicates.length > 0 || merged.duplicates.length > 0) && { duplicateNames: [...new Set([...performers.duplicates, ...merged.duplicates])] }),
  };
  if (api.tags.ok) {
    const known = new Set(api.tags.value.map((t) => t.toLowerCase()));
    const missing = FESTIVAL.api.musicTags.filter((t) => !known.has(t.toLowerCase()));
    if (missing.length) source.musicTagsNotInTagList = missing;
  }
  const { schedule, notes } = newSchedule(api, merged.state);
  const next = withSections(merged.state, { source, schedule });
  saveState(next);
  report(merged, next, performers.included.length);
  if (source.musicTagsNotInTagList) console.warn(`  WARNING: musicTags ${JSON.stringify(source.musicTagsNotInTagList)} is not in the festival's tag list; check festival.config.js`);
  const s = scheduleSummary(next.schedule);
  console.log(`  schedule: ${s.venues} venue(s), ${s.events} event(s)${s.first ? `, ${s.first} to ${s.last}` : ''}${s.unknownPerformerIds ? `, ${s.unknownPerformerIds} unknown performer id(s)` : ''}`);
  for (const n of notes) console.warn(`  schedule note: ${n} (never fails the stage)`);
}

function report(m, state, names) {
  const liveRecords = state.artists.filter((a) => !a.removed).length;
  console.log(`  names in the source: ${names}; records: ${state.artists.length} (${liveRecords} active)`);
  console.log(`  added ${m.added.length}, removed ${m.removed.length}, restored ${m.restored.length}, renamed ${m.renamed.length}; festival data changed for ${m.festivalChanged}`);
  for (const n of m.added) console.log(`    + ${n}`);
  for (const n of m.removed) console.log(`    - ${n} (marked removed; excluded from outputs)`);
  for (const n of m.restored) console.log(`    ~ ${n} (back on the lineup)`);
  for (const r of m.renames) {
    const rec = state.artists.find((a) => a.n === r.n);
    const rekey = !r.cosmetic && rec?.formerNames?.includes(r.from);
    console.log(`    ~ ${r.from} -> ${r.to} (n=${r.n})${rekey ? `  OVERRIDE KEYED "${r.from}" STILL APPLIES; re-key it to "${r.to}" in overrides.json` : ''}`);
  }
  for (const d of m.duplicates) console.log(`    ! "${d}" shares a normalised name with an earlier entry and was skipped`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
