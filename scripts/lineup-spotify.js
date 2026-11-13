#!/usr/bin/env node
/**
 * Stage 3: find each artist's Spotify id. Resolution order: overrides.json, then the festival's own link
 * (stage `festival`), then search by name.
 *   festival artist link   the id from the link; no API call (confidence "festival")
 *   festival album link    GET /albums/{id}; the album's artists, in order (confidence "festival"); a failed call
 *                          leaves the artist as it was and is retried next run, never falling through to search
 *   otherwise              Spotify search for records with no result yet (confidence exact/inexact/ambiguous/none)
 * When the festival link differs from an earlier search result, the festival wins and the old result is kept
 * in `spotify.supersedes` for the review report. Needs no credential when there is nothing to look up
 * (festival artist links need none).
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
import { applyFestivalSpotify, needsSpotify, pickSpotifyMatch } from './lib/state.js';
import { festivalSpotifyTarget, parseAlbumArtists } from './lib/festival.js';
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
  const todo = state.artists.filter((a) => needsSpotify(a, overrideFor(index, a)));
  const viaArtist = todo.filter((a) => festivalSpotifyTarget(a)?.kind === 'artist');
  const viaAlbum = todo.filter((a) => festivalSpotifyTarget(a)?.kind === 'album');
  const toSearch = todo.filter((a) => !festivalSpotifyTarget(a));
  console.log(`Spotify: ${todo.length} artist(s) to resolve (festival artist link ${viaArtist.length}, festival album link ${viaAlbum.length}, search ${toSearch.length})`);
  if (todo.length === 0) return;

  let changed = false;
  const save = () => {
    if (changed) state.lastUpdated = today();
    saveState(state);
  };

  // Festival artist links: the id is in the link, so no credential and no request.
  for (const record of viaArtist) {
    applyFestivalSpotify(record, { ids: [festivalSpotifyTarget(record).id], matchedName: null, via: 'artist' });
    changed = true;
  }
  if (viaArtist.length) {
    save();
    const replaced = viaArtist.filter((r) => r.spotify.supersedes);
    console.log(`  festival artist link used for ${viaArtist.length}; ${replaced.length} differ from an earlier search result`);
    for (const r of replaced) console.log(`    festival link differs from earlier search result: ${r.name}: ${r.spotify.supersedes.ids.join(',')} -> ${r.spotify.ids.join(',')}`);
  }
  if (viaAlbum.length + toSearch.length === 0) return;

  const token = await getAccessToken();
  if (!token) throw new Error('No Spotify credential provided');
  const client = createClient({
    cacheDir: null,
    minIntervalMs: 300,
    headers: { Authorization: `Bearer ${token}` },
    log: console.log,
  });

  const guard = async (call) => {
    try {
      return await call();
    } catch (err) {
      // An expired or rejected token will not get better on the next artist.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw new ApiError(`Spotify rejected the credential (HTTP ${err.status})`, { status: err.status, abort: true });
      }
      throw err;
    }
  };
  async function search(name) {
    const url = `https://api.spotify.com/v1/search?type=artist&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(name)}`;
    const { body } = await guard(() => client.getJson(url));
    return body?.artists?.items ?? [];
  }
  async function albumArtists(id) {
    const { status, body } = await guard(() => client.getJson(`https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`));
    if (status !== 200) throw new ApiError(`album ${id}: HTTP ${status}`, { status });
    const artists = parseAlbumArtists(body);
    if (!artists.length) throw new Error(`album ${id} lists no artists`);
    return artists;
  }

  const failures = [];
  let aborted = null;
  const keep = (label, result) => {
    for (const f of result.failed) failures.push({ label, name: f.item.name, message: f.message });
    if (result.aborted) aborted = result.aborted;
    return result;
  };

  if (viaAlbum.length) {
    const result = keep('album', await processItems(
      viaAlbum,
      async (record) => {
        const target = festivalSpotifyTarget(record);
        const artists = await albumArtists(target.id);
        applyFestivalSpotify(record, { ids: artists.map((a) => a.id), matchedName: artists.map((a) => a.name).join(' & '), via: 'album', albumId: target.id });
        changed = true;
      },
      { save, onItem: progressLine(), onError: (r, err) => console.log(`\n  ${r.name}: ${err.message}`) }
    ));
    console.log('');
    console.log(`  festival album links resolved ${result.ok} of ${viaAlbum.length}`);
    for (const r of viaAlbum.filter((x) => x.spotify?.via === 'album' && x.spotify.albumId === festivalSpotifyTarget(x)?.id)) {
      console.log(`    ${r.name} -> ${r.spotify.matchedName} (${r.spotify.ids.join(', ')})${r.spotify.supersedes ? ` [festival link differs from earlier search result: ${r.spotify.supersedes.ids.join(',')}]` : ''}`);
    }
  }

  if (toSearch.length && !aborted) {
    console.log('Testing Spotify search with a known artist...');
    const probe = pickSpotifyMatch('Built to Spill', await search('Built to Spill'));
    if (probe?.confidence !== 'exact') throw new Error('Spotify search is not working (the test search failed). Check the credential. Nothing was written.');

    const result = keep('search', await processItems(
      toSearch,
      async (record) => {
        const match = pickSpotifyMatch(record.name, await search(record.name));
        record.spotify = match ?? { ids: [], matchedName: null, confidence: 'none' };
        changed = true;
      },
      { save, onItem: progressLine(), onError: (r, err) => console.log(`\n  ${r.name}: ${err.message}`) }
    ));
    console.log('');
    const touched = toSearch.filter((r) => r.spotify);
    const by = (c) => touched.filter((r) => r.spotify.confidence === c);
    console.log(`  searched ${result.ok}: exact ${by('exact').length}, inexact ${by('inexact').length}, ambiguous ${by('ambiguous').length}, none ${by('none').length}`);
    for (const r of by('inexact')) console.log(`  check (inexact): ${r.name} -> ${r.spotify.matchedName}`);
    for (const r of by('ambiguous')) console.log(`  check (ambiguous): ${r.name} -> https://open.spotify.com/artist/${r.spotify.ids[0]}`);
    for (const r of by('none')) console.log(`  not on Spotify: ${r.name}`);
  }
  save();
  if (aborted || failures.length) {
    for (const f of failures) console.error(`  failed (${f.label}): ${f.name}: ${f.message}`);
    console.error(`\n${failures.length} lookup(s) failed${aborted ? ` and the stage stopped: ${aborted}` : ''}. Run again; only unresolved artists are retried.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
