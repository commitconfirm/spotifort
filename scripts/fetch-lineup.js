#!/usr/bin/env node

/**
 * Fetch the Treefort lineup and enrich it with Spotify data
 *
 * Pipeline:
 *   1. Scrape artist names from the Treefort lineup page (ground truth)
 *   2. Keep records already resolved (or searched with no result) in public/lineups/<year>.json
 *   3. Search Spotify for artists that are new or still unresolved
 *   4. Write the result to public/lineups/<year>.json
 *
 * Record states:
 *   spotifyId set                         resolved
 *   spotifyId null, notOnSpotify true     searched successfully, no result (kept on later runs)
 *   spotifyId null, notOnSpotify false    unresolved: not looked up yet or the lookup failed (retried on every run)
 * An API error never produces notOnSpotify: true. The top-level `enriched` flag is true only
 * when no record is unresolved.
 *
 * The year and lineup URL come from festival.config.js. Pure logic lives in scripts/lib/lineup-pipeline.js.
 *
 * Usage:
 *   node scripts/fetch-lineup.js                # full run (needs a Spotify credential)
 *   node scripts/fetch-lineup.js --names-only   # scrape and print names, no Spotify, no file writes
 *   node scripts/fetch-lineup.js --names-only --write-placeholder
 *                                               # write/merge the year file without Spotify lookups
 *                                               # (new artists are added unresolved; resolved ones are kept)
 *
 * Credentials, in this order (set them in .env.local):
 *   SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET   client-credentials flow (preferred)
 *   SPOTIFY_ACCESS_TOKEN                        a user or app access token you already have
 *   otherwise you are prompted for an access token (input is not echoed)
 * Access tokens expire after about an hour. On 429 the script waits for Retry-After.
 */

import { createInterface } from 'readline';
import { Writable } from 'stream';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import festival from '../festival.config.js';
import {
  parseLineupHtml,
  pickMatch,
  mergeLineup,
  isEnriched,
  isUnresolved,
  parseRetryAfter,
} from './lib/lineup-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_PATH = join(ROOT, 'public', 'lineups', `${festival.year}.json`);
const ENV_PATH = join(ROOT, '.env.local');

if (existsSync(ENV_PATH)) {
  config({ path: ENV_PATH, quiet: true });
}

const API_BASE = 'https://api.spotify.com/v1';
const REQUEST_DELAY = 300; // ms between API calls
const MAX_RETRIES = 3;
const MAX_WAIT_SECONDS = 120; // longest Retry-After we are willing to wait out
const MAX_CONSECUTIVE_ERRORS = 3; // abort the lookup loop after this many API errors in a row
const MIN_ARTISTS = 50; // below this the scrape is assumed broken
const SEARCH_LIMIT = 5; // Spotify search max is 10

/**
 * Prompt for a secret without echoing what is typed
 * @param {string} question
 * @returns {Promise<string>}
 */
function promptHidden(question) {
  process.stdout.write(question);
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and rate limit handling
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      if (retryAfter !== null && retryAfter > MAX_WAIT_SECONDS) {
        console.log(`\n  Rate limited with Retry-After ${Math.ceil(retryAfter)}s (more than ${MAX_WAIT_SECONDS}s). Giving up for now.`);
        return response;
      }
      const wait = retryAfter !== null ? Math.max(1, Math.ceil(retryAfter)) : Math.min(30, Math.pow(2, attempt + 1));
      console.log(`\n  Rate limited. Waiting ${wait}s${retryAfter !== null ? ' (Retry-After)' : ''} before retry ${attempt}/${retries}...`);
      await sleep(wait * 1000);
      continue;
    }

    return response;
  }

  // All retries exhausted
  return { ok: false, status: 429, text: async () => 'Rate limit exceeded after retries' };
}

/**
 * Fetch artist names from the Treefort website.
 * Throws if fewer than MIN_ARTISTS names are found.
 */
async function fetchWebsiteLineup() {
  console.log(`Fetching lineup from ${festival.lineupUrl} ...`);
  const response = await fetchWithRetry(festival.lineupUrl, {
    headers: { 'User-Agent': 'Spotifort lineup script (https://spotifort.com)' },
  });
  if (!response.ok) {
    throw new Error(`Lineup page returned HTTP ${response.status}`);
  }
  const names = parseLineupHtml(await response.text());
  if (names.length < MIN_ARTISTS) {
    throw new Error(
      `Only found ${names.length} artist names on ${festival.lineupUrl} (expected at least ${MIN_ARTISTS}). ` +
      'The page markup has probably changed (looking for <h3 class="lineup-artist-name">). Refusing to write output.'
    );
  }
  return names;
}

/**
 * Get a Spotify access token (see the usage notes at the top of this file). Never logs the token.
 */
async function getAccessToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (id && secret) {
    console.log('Using SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (client credentials)...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      throw new Error(`Spotify token request failed (HTTP ${response.status}). Check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env.local.`);
    }
    return (await response.json()).access_token;
  }

  if (process.env.SPOTIFY_ACCESS_TOKEN) {
    console.log('Using SPOTIFY_ACCESS_TOKEN from .env.local...');
    return process.env.SPOTIFY_ACCESS_TOKEN.trim();
  }

  console.log('No SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET and no SPOTIFY_ACCESS_TOKEN found in .env.local.');
  console.log('Set one of them there, or paste an access token now (it expires after about an hour).');
  console.log('');
  return promptHidden('Access token (input hidden): ');
}


/**
 * Search Spotify for an artist by name.
 * @returns {Promise<
 *   {status:'found', spotifyId:string, spotifyUrl:string, genres:string[], spotifyName?:string} |
 *   {status:'none'} |
 *   {status:'error', httpStatus:number}>}
 * 'none' means the search worked and returned no artists. Any HTTP failure (401, 429 after
 * retries, 5xx, ...) or network error is 'error' and must never be recorded as "not on Spotify".
 * `genres` is deprecated by Spotify and may be absent; it is read if present.
 */
let firstErrorLogged = false;
async function searchSpotifyArtist(accessToken, artistName) {
  const url = `${API_BASE}/search?type=artist&q=${encodeURIComponent(artistName)}&limit=${SEARCH_LIMIT}`;

  let response;
  try {
    response = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    if (!firstErrorLogged) {
      console.log(`\n  ERROR: network failure: ${err.message}\n`);
      firstErrorLogged = true;
    }
    return { status: 'error', httpStatus: 0 };
  }

  if (!response.ok) {
    if (!firstErrorLogged) {
      console.log(`\n  ERROR: Search API returned ${response.status}`);
      console.log(`  Response: ${await response.text()}\n`);
      firstErrorLogged = true;
    }
    return { status: 'error', httpStatus: response.status };
  }

  const data = await response.json();
  const match = pickMatch(artistName, data.artists?.items);
  return match ? { status: 'found', ...match } : { status: 'none' };
}

/**
 * Build an unresolved record
 */
function unresolvedRecord(name) {
  return { name, spotifyId: null, spotifyUrl: null, notOnSpotify: false, genres: [] };
}

/**
 * Search Spotify for each of the given names.
 * Stops after MAX_CONSECUTIVE_ERRORS API errors in a row; names failed or not reached are
 * returned as unresolved records so the next run retries them.
 * @returns {Promise<{records: Object[], aborted: boolean, ambiguous: {name:string,count:number,spotifyUrl:string}[]}>}
 */
async function lookupArtists(accessToken, artistNames) {
  const records = [];
  const ambiguous = []; // several Spotify artists share the exact name; first one used
  const total = artistNames.length;
  let consecutiveErrors = 0;
  let aborted = false;

  console.log(`Looking up ${total} artists on Spotify...`);
  console.log('');

  for (let i = 0; i < total; i++) {
    const name = artistNames[i];

    if (aborted) {
      records.push(unresolvedRecord(name));
      continue;
    }

    process.stdout.write(`\r  Processing artist ${i + 1}/${total}: ${name.padEnd(50).slice(0, 50)}`);

    const result = await searchSpotifyArtist(accessToken, name);
    await sleep(REQUEST_DELAY);

    if (result.status === 'found') {
      consecutiveErrors = 0;
      const record = {
        name,
        spotifyId: result.spotifyId,
        spotifyUrl: result.spotifyUrl,
        notOnSpotify: false,
        genres: result.genres,
      };
      if (result.spotifyName) record.spotifyName = result.spotifyName;
      if (result.exactCount > 1) {
        ambiguous.push({ name, count: result.exactCount, spotifyUrl: result.spotifyUrl });
      }
      records.push(record);
    } else if (result.status === 'none') {
      consecutiveErrors = 0;
      records.push({ name, spotifyId: null, spotifyUrl: null, notOnSpotify: true, genres: [] });
    } else {
      consecutiveErrors++;
      records.push(unresolvedRecord(name));
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        aborted = true;
        console.log(`\n  ${consecutiveErrors} consecutive API errors (last: HTTP ${result.httpStatus}). Stopping the lookup.`);
      }
    }
  }

  console.log('');
  console.log('');

  return { records, aborted, ambiguous };
}

/**
 * Load the existing year file, or null if absent
 */
function loadExisting() {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    return Array.isArray(data.artists) ? data : null;
  } catch (err) {
    throw new Error(`Could not parse existing ${OUTPUT_PATH}: ${err.message}`);
  }
}

/**
 * Write the year file. `enriched` is derived from the records.
 */
function writeLineup(artists) {
  artists.sort((a, b) => a.name.localeCompare(b.name));
  const lineup = {
    lastUpdated: new Date().toISOString().split('T')[0],
    enriched: isEnriched(artists),
    artists,
  };
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(lineup, null, 2) + '\n');
  return lineup;
}

/**
 * Main function
 */
async function main() {
  const namesOnly = process.argv.includes('--names-only');

  console.log('');
  console.log(`${festival.name} ${festival.year} Lineup Fetcher`);
  console.log('========================================');
  console.log('');

  try {
    // Step 1: scrape website lineup
    const names = await fetchWebsiteLineup();
    console.log(`  Artists on website: ${names.length}`);
    console.log('');

    // Step 2: split into kept and needs-lookup
    const existing = loadExisting();
    const { kept, toLookup, removed } = mergeLineup(existing?.artists, names);

    if (namesOnly) {
      if (process.argv.includes('--write-placeholder')) {
        // No Spotify calls: resolved records are kept, everything else is written unresolved.
        const lineup = writeLineup([...kept, ...toLookup.map(unresolvedRecord)]);
        console.log(`Wrote ${lineup.artists.length} artists (${kept.length} kept, ${toLookup.length} unresolved, enriched: ${lineup.enriched}) to ${OUTPUT_PATH}`);
      } else {
        names.forEach((n) => console.log(n));
      }
      return;
    }

    console.log(`  Kept from existing file: ${kept.length}`);
    console.log(`  To look up on Spotify:   ${toLookup.length}`);
    console.log('');

    // Step 3: Spotify lookups (only if needed)
    let added = [];
    let aborted = false;
    let ambiguous = [];
    if (toLookup.length > 0) {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('No Spotify credential provided');
      }

      console.log('Testing Spotify API access...');
      const test = await searchSpotifyArtist(accessToken, 'Built to Spill');
      if (test.status !== 'found') {
        throw new Error('Spotify search is not working (the test search for a known artist failed). Check your credential; nothing was written.');
      }
      console.log('  Test passed.');
      console.log('');

      ({ records: added, aborted, ambiguous } = await lookupArtists(accessToken, toLookup));
    }

    // Step 4: write
    const artists = [...kept, ...added];
    const lineup = writeLineup(artists);

    // Summary
    const resolved = artists.filter((a) => a.spotifyId);
    const notFound = artists.filter((a) => a.notOnSpotify && !a.spotifyId);
    const unresolved = artists.filter(isUnresolved);
    const lowConfidence = artists.filter((a) => a.spotifyName);
    const withGenres = artists.filter((a) => a.genres && a.genres.length > 0);
    const allGenres = new Set(artists.flatMap((a) => a.genres || []));

    console.log('Summary');
    console.log('-------');
    console.log(`  Total artists:          ${artists.length}`);
    console.log(`  Newly looked up:        ${added.length - added.filter(isUnresolved).length}`);
    console.log(`  Found on Spotify:       ${resolved.length}`);
    console.log(`  Not found on Spotify:   ${notFound.length}`);
    console.log(`  Unresolved (retry):     ${unresolved.length}`);
    console.log(`  Artists with genres:    ${withGenres.length}`);
    console.log(`  Unique genres:          ${allGenres.size}`);
    console.log(`  enriched:               ${lineup.enriched}`);
    console.log('');
    console.log(`Written to: ${OUTPUT_PATH}`);

    if (removed.length > 0) {
      console.log('');
      console.log(`In the previous file but no longer on the website (dropped, ${removed.length}):`);
      removed.forEach((a) => console.log(`  - ${a.name}`));
    }

    if (notFound.length > 0) {
      console.log('');
      console.log('Artists not found on Spotify:');
      notFound.forEach((a) => console.log(`  - ${a.name}`));
    }

    if (lowConfidence.length > 0) {
      console.log('');
      console.log('Check these matches by hand (no exact name match, top Spotify hit used):');
      lowConfidence.forEach((a) => console.log(`  - ${a.name}  ->  ${a.spotifyName}`));
    }

    if (ambiguous.length > 0) {
      console.log('');
      console.log('Several Spotify artists share this exact name - first one used (check by hand):');
      ambiguous.forEach((a) => console.log(`  - ${a.name}  (${a.count} artists)  ->  ${a.spotifyUrl}`));
    }

    if (aborted || unresolved.length > 0) {
      console.error('');
      console.error(
        `${unresolved.length} artists are still unresolved (lookup failed or was stopped after repeated API errors). ` +
        'Fix the cause (expired token? rate limit?) and run the script again; only unresolved artists are retried.'
      );
      process.exit(1);
    }

    console.log('');
    console.log('Done!');
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
