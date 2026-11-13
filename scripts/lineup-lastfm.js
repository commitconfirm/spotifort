#!/usr/bin/env node
/**
 * Stage 4: Last.fm by artist name (with autocorrect): resolved name, listeners, similar artists (250), tags.
 * Overrides can change the name asked for (`lastfmName`) or skip Last.fm for an artist (`lastfmName: null`).
 * At most 4 requests per second. Answers are cached in .cache/lastfm, so a rerun is free.
 * Needs LASTFM_API_KEY in .env.local; the key is never written to the cache, logs or errors.
 *
 * Usage: node scripts/lineup-lastfm.js [--refresh]   (--refresh: ignore cached answers)
 */
import { loadEnv, loadOverrides, loadState, paths, saveState, today } from './lib/store.js';
import { indexOverrides, overrideFor } from './lib/overrides.js';
import { lastfmQueryName, needsLastfm } from './lib/state.js';
import { NOT_FOUND, buildLastfmRecord, parseInfo, skippedLastfmRecord } from './lib/lastfm.js';
import { createClient, lastfmClassify } from './lib/http.js';
import { processItems, progressLine } from './lib/stage.js';
import { LASTFM_MIN_INTERVAL_MS, LASTFM_SIMILAR_LIMIT } from './lib/constants.js';

async function main() {
  loadEnv();
  const state = loadState();
  const index = indexOverrides(loadOverrides());
  const ov = (r) => overrideFor(index, r.name);
  const todo = state.artists.filter((r) => needsLastfm(r, ov(r)));
  console.log(`Last.fm: ${todo.length} artist(s) to look up`);
  if (todo.length === 0) return;

  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey && todo.some((r) => lastfmQueryName(r, ov(r)) !== null)) {
    throw new Error('LASTFM_API_KEY is not set in .env.local');
  }

  const client = createClient({
    cacheDir: paths.cache('lastfm'),
    useCache: !process.argv.includes('--refresh'),
    minIntervalMs: LASTFM_MIN_INTERVAL_MS,
    log: console.log,
  });

  // The cache key is the request without the api key.
  async function call(method, params) {
    const query = new URLSearchParams(Object.entries(params).sort()).toString();
    const key = `${method}?${query}`;
    const url = `https://ws.audioscrobbler.com/2.0/?method=${method}&${query}&api_key=${apiKey}&format=json`;
    return (await client.getJson(url, { cacheKey: key, classify: lastfmClassify })).body;
  }

  let changed = false;
  const result = await processItems(
    todo,
    async (record) => {
      const queried = lastfmQueryName(record, ov(record));
      if (queried === null) {
        record.lastfm = skippedLastfmRecord();
        changed = true;
        return;
      }
      const params = { artist: queried, autocorrect: 1 };
      const info = await call('artist.getInfo', params);
      if (parseInfo(info) === NOT_FOUND) {
        record.lastfm = buildLastfmRecord(queried, { info });
      } else {
        const similar = await call('artist.getSimilar', { ...params, limit: LASTFM_SIMILAR_LIMIT });
        const tags = await call('artist.getTopTags', params);
        record.lastfm = buildLastfmRecord(queried, { info, similar, tags });
      }
      changed = true;
    },
    {
      save: () => {
        if (changed) state.lastUpdated = today();
        saveState(state);
      },
      onItem: progressLine(),
      onError: (r, err) => console.log(`\n  ${r.name}: ${err.message}`),
    }
  );

  console.log(`\n  done ${result.ok}, failed ${result.failed.length}, network requests ${client.stats.network}, from cache ${client.stats.cached}`);
  const done = todo.filter((r) => r.lastfm);
  for (const r of done.filter((x) => x.lastfm.nameChanged === 'different')) {
    console.log(`  check: Last.fm autocorrected ${r.name} -> ${r.lastfm.resolvedName} (a different artist; data will not be used until you add an override)`);
  }
  for (const r of done.filter((x) => x.lastfm.notFound)) console.log(`  not found on Last.fm: ${r.name}`);
  if (result.aborted || result.failed.length) {
    console.error(`\n${result.failed.length} failed${result.aborted ? `; stopped: ${result.aborted}` : ''}. ${result.notReached.length} not reached. Run again to continue.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
