#!/usr/bin/env node
/**
 * Stage 3: Spotify id -> MusicBrainz id -> verified links to other platforms and platform ids.
 * One request per second, as MusicBrainz asks. Answers are cached in <cache dir>/musicbrainz (~/.cache/spotifort, or $SPOTIFORT_CACHE_DIR), so a rerun is free.
 *
 * Usage: node scripts/lineup-musicbrainz.js [--refresh]   (--refresh: ignore cached answers)
 */
import { loadEnv, loadOverrides, loadState, paths, saveState, today } from './lib/store.js';
import { indexOverrides, overrideFor } from './lib/overrides.js';
import { effectiveMbid, needsMbLinks, needsMbid, primarySpotifyId } from './lib/state.js';
import { extractLinks, parseUrlLookup } from './lib/musicbrainz.js';
import { createClient, musicbrainzClassify } from './lib/http.js';
import { processItems, progressLine } from './lib/stage.js';
import { MUSICBRAINZ_MIN_INTERVAL_MS, MUSICBRAINZ_USER_AGENT } from './lib/constants.js';

async function main() {
  loadEnv(); // only for SPOTIFORT_CACHE_DIR; MusicBrainz needs no key
  const state = loadState();
  const index = indexOverrides(loadOverrides());
  const ov = (r) => overrideFor(index, r);
  const todo = state.artists.filter((r) => needsMbid(r, ov(r)) || needsMbLinks(r, ov(r)));
  console.log(`MusicBrainz: ${todo.length} artist(s) to look up (about ${Math.ceil((todo.length * 2 * MUSICBRAINZ_MIN_INTERVAL_MS) / 60000)} min at most)`);
  if (todo.length === 0) return;

  const client = createClient({
    cacheDir: paths.cache('musicbrainz'),
    useCache: !process.argv.includes('--refresh'),
    minIntervalMs: MUSICBRAINZ_MIN_INTERVAL_MS,
    headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT },
    log: console.log,
  });
  const get = (path) => client.getJson(`https://musicbrainz.org/ws/2/${path}`, { cacheKey: path, classify: musicbrainzClassify });

  let changed = false;
  const result = await processItems(
    todo,
    async (record) => {
      const override = ov(record);
      if (needsMbid(record, override)) {
        const spotifyId = primarySpotifyId(record, override);
        const resource = encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`);
        const { status, body } = await get(`url?resource=${resource}&inc=artist-rels&fmt=json`);
        const found = parseUrlLookup(status, body);
        record.mbid = found.kind === 'found' ? found.mbid : null;
        record.mbFor = spotifyId;
        if (found.kind === 'none') {
          delete record.mbFetched;
          delete record.mbName;
          delete record.links;
          delete record.ids;
        }
        changed = true;
      }
      if (needsMbLinks(record, override)) {
        const mbid = effectiveMbid(record, override);
        const { body } = await get(`artist/${mbid}?inc=url-rels+tags+genres&fmt=json`);
        if (!body || !Array.isArray(body.relations)) throw new Error(`unexpected MusicBrainz response for ${record.name}`);
        const { links, ids } = extractLinks(body.relations);
        record.links = links;
        record.ids = ids;
        record.mbFetched = mbid;
        if (typeof body.name === 'string') record.mbName = body.name;
        else delete record.mbName;
        changed = true;
      }
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
  if (result.aborted || result.failed.length) {
    console.error(`\n${result.failed.length} failed${result.aborted ? `; stopped: ${result.aborted}` : ''}. ${result.notReached.length} not reached. Run again to continue.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
