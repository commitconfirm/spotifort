#!/usr/bin/env node
/**
 * Stage 2: find each artist's Spotify id (search by name) for records with no result yet.
 * Skips artists whose Spotify ids are set in overrides.json. Needs no credential when there is nothing to look up.
 *
 * Credentials, in this order (.env.local):
 *   SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET   client-credentials flow (preferred)
 *   SPOTIFY_ACCESS_TOKEN                        a token you already have (expires in about an hour)
 *   otherwise, in a terminal, you are prompted for an access token (input hidden)
 * A failed lookup is never recorded as "not on Spotify"; it stays unresolved and is retried next run.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { loadEnv, loadOverrides, loadState, saveState, today } from './lib/store.js';
import { indexOverrides, overrideFor } from './lib/overrides.js';
import { needsSpotify, pickSpotifyMatch } from './lib/state.js';
import { ApiError, createClient } from './lib/http.js';
import { processItems, progressLine } from './lib/stage.js';

const SEARCH_LIMIT = 5; // Spotify's maximum is 10

function promptHidden(question) {
  process.stdout.write(question);
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function getAccessToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (id && secret) {
    console.log('Using SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (client credentials)');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Spotify token request failed (HTTP ${res.status}). Check SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env.local.`);
    return (await res.json()).access_token;
  }
  if (process.env.SPOTIFY_ACCESS_TOKEN) {
    console.log('Using SPOTIFY_ACCESS_TOKEN from .env.local');
    return process.env.SPOTIFY_ACCESS_TOKEN.trim();
  }
  if (!process.stdin.isTTY) {
    throw new Error('No Spotify credential: set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (or SPOTIFY_ACCESS_TOKEN) in .env.local.');
  }
  console.log('No SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET or SPOTIFY_ACCESS_TOKEN in .env.local. Paste an access token (hidden, expires in about an hour).');
  return promptHidden('Access token: ');
}

async function main() {
  loadEnv();
  const state = loadState();
  const index = indexOverrides(loadOverrides());
  const todo = state.artists.filter((a) => needsSpotify(a, overrideFor(index, a.name)));
  console.log(`Spotify: ${todo.length} artist(s) to look up`);
  if (todo.length === 0) return;

  const token = await getAccessToken();
  if (!token) throw new Error('No Spotify credential provided');
  const client = createClient({
    cacheDir: null,
    minIntervalMs: 300,
    headers: { Authorization: `Bearer ${token}` },
    log: console.log,
  });

  async function search(name) {
    const url = `https://api.spotify.com/v1/search?type=artist&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(name)}`;
    try {
      const { body } = await client.getJson(url);
      return body?.artists?.items ?? [];
    } catch (err) {
      // An expired or rejected token will not get better on the next artist.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw new ApiError(`Spotify rejected the credential (HTTP ${err.status})`, { status: err.status, abort: true });
      }
      throw err;
    }
  }

  console.log('Testing Spotify search with a known artist...');
  const probe = pickSpotifyMatch('Built to Spill', await search('Built to Spill'));
  if (probe?.confidence !== 'exact') throw new Error('Spotify search is not working (the test search failed). Check the credential. Nothing was written.');

  let changed = false;
  const result = await processItems(
    todo,
    async (record) => {
      const match = pickSpotifyMatch(record.name, await search(record.name));
      record.spotify = match ?? { ids: [], matchedName: null, confidence: 'none' };
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
  console.log('');

  const touched = todo.filter((r) => r.spotify);
  const by = (c) => touched.filter((r) => r.spotify.confidence === c);
  console.log(`  looked up ${result.ok}: exact ${by('exact').length}, inexact ${by('inexact').length}, ambiguous ${by('ambiguous').length}, none ${by('none').length}`);
  for (const r of by('inexact')) console.log(`  check (inexact): ${r.name} -> ${r.spotify.matchedName}`);
  for (const r of by('ambiguous')) console.log(`  check (ambiguous): ${r.name} -> https://open.spotify.com/artist/${r.spotify.ids[0]}`);
  for (const r of by('none')) console.log(`  not on Spotify: ${r.name}`);
  if (result.aborted || result.failed.length) {
    console.error(`\n${result.failed.length} lookup(s) failed${result.aborted ? ` and the stage stopped: ${result.aborted}` : ''}. ${result.notReached.length} not reached. Run again; only unresolved artists are retried.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
