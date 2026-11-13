#!/usr/bin/env node
/**
 * Fallback link fetcher: the festival's own performer feed. Used only when the vendor API (stage `source`) is
 * unavailable: `npm run lineup:source` calls it after a page scrape, and it can be run alone after that. For
 * each active artist with a slug (captured by the scrape), GET <restBase><slug> and keep the Spotify link the
 * festival chose, plus its other links and hometown. When the last source run used the API the records already
 * carry their links from it and this script does nothing (a record's links would be replaced by the feed's).
 *
 * The feed is undocumented (it is what the lineup page's own script calls), so this stage is defensive:
 * a performer that cannot be fetched or parsed is left as "not fetched" and retried next run, never recorded
 * as a fact about the artist; if more than half of the requests fail the stage stops with a warning and
 * exits 0, so the later stages still run on search alone.
 *
 * Usage: node scripts/lineup-festival.js [--refresh]   (--refresh: fetch every performer again, ignoring the cache,
 *                                                       for when the festival may have corrected links)
 */
import { pathToFileURL } from 'node:url';
import { FESTIVAL, loadEnv, loadState, paths, saveState, today } from './lib/store.js';
import { ApiError, createClient } from './lib/http.js';
import { processItems, progressLine } from './lib/stage.js';
import { cleanSlug, discoverRestBase, feedLooksBroken, needsFestival, parsePerformer, performerUrl, sameName } from './lib/festival.js';
import { FESTIVAL_CLIENT_NAME, FESTIVAL_MAX_ATTEMPTS, FESTIVAL_MIN_INTERVAL_MS, FESTIVAL_REST_BASE } from './lib/constants.js';

/** Only a performer the feed knows is a final answer; found:false and 4xx are failures for that performer, not cached. */
const classify = (status, body) => {
  if (body === null) return 'retry';
  if (status >= 500) return 'retry';
  return status === 200 && body && typeof body === 'object' && body.found === true ? 'ok' : 'fail';
};

async function discoverBase(headers) {
  try {
    const res = await fetch(FESTIVAL.lineupUrl, { headers });
    if (res.ok) return { base: discoverRestBase(await res.text()), fromPage: true };
  } catch {
    // use the constant
  }
  return { base: FESTIVAL_REST_BASE, fromPage: false };
}

export async function fetchFestivalLinks({ refresh = false } = {}) {
  loadEnv(); // only for SPOTIFORT_CACHE_DIR; the feed needs no key
  const state = loadState();
  if (state.source?.kind === 'api') {
    console.log('Festival feed: skipped. The last lineup source was the vendor API, which already supplied the links.');
    return;
  }
  const todo = state.artists.filter((r) => needsFestival(r, refresh));
  const noSlug = state.artists.filter((r) => !r.removed && !cleanSlug(r.slug)).length;
  console.log(`Festival feed: ${todo.length} performer(s) to fetch${refresh ? ' (refresh)' : ''}; ${noSlug} active artist(s) without a slug`);
  if (todo.length === 0) return;

  const headers = { 'User-Agent': FESTIVAL_CLIENT_NAME };
  const { base: restBase, fromPage } = await discoverBase(headers);
  console.log(`  feed: ${restBase} (${fromPage ? 'lineup page config, or the built-in default when the config is missing or not on the festival host' : 'built-in default; lineup page not readable'})`);
  const client = createClient({
    cacheDir: paths.cache('festival'),
    useCache: !refresh,
    minIntervalMs: FESTIVAL_MIN_INTERVAL_MS,
    maxAttempts: FESTIVAL_MAX_ATTEMPTS,
    headers,
    log: console.log,
  });

  const date = today();
  const counts = { attempted: 0, failed: 0 };
  let changed = false;
  let spotifyLinks = 0;
  const result = await processItems(
    todo,
    async (record) => {
      const slug = cleanSlug(record.slug);
      counts.attempted++;
      try {
        let body;
        try {
          ({ body } = await client.getJson(performerUrl(restBase, slug), { cacheKey: `performer/${slug}`, classify }));
        } catch (err) {
          if (err instanceof ApiError && err.status === 200) throw new Error('feed says the performer was not found');
          throw err;
        }
        const parsed = parsePerformer(body, slug, date);
        if (!parsed.ok) throw new Error(parsed.reason);
        if (typeof body.name === 'string' && !sameName(body.name, record.name)) console.log(`\n  note: slug "${slug}" is "${body.name}" in the feed, "${record.name}" on the lineup page`);
        record.festival = { ...(record.festival?.id && { id: record.festival.id }), ...parsed.festival };
        if (parsed.festival.spotify) spotifyLinks++;
        changed = true;
      } catch (err) {
        counts.failed++;
        // An abort (long rate limit) or a clearly broken feed ends the stage; other failures are per performer.
        if (err?.abort) throw err;
        if (feedLooksBroken(counts)) {
          throw new ApiError(`${counts.failed} of ${counts.attempted} performer requests failed (last: ${err?.message}); the feed has probably changed`, { abort: true });
        }
        throw err;
      }
    },
    {
      maxConsecutiveErrors: Infinity,
      save: () => {
        if (changed) state.lastUpdated = date;
        saveState(state);
      },
      onItem: progressLine(),
      onError: (r, err) => console.log(`\n  ${r.name}: ${err.message}`),
    }
  );
  console.log(`\n  fetched ${result.ok} (${spotifyLinks} with a Spotify link), failed ${result.failed.length}, not reached ${result.notReached.length}; network requests ${client.stats.network}, from cache ${client.stats.cached}`);
  if (result.aborted) {
    console.warn(`\nWARNING: festival stage stopped early: ${result.aborted}. Later stages continue with search; run again later to retry the rest.`);
  } else if (result.failed.length) {
    console.warn(`\nWARNING: ${result.failed.length} performer(s) could not be fetched; they are retried next run.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchFestivalLinks({ refresh: process.argv.includes('--refresh') }).catch((err) => {
    // Never fail the pipeline over this feed: later stages work from search.
    console.warn(`\nWARNING: festival stage did not complete: ${err.message}`);
  });
}
