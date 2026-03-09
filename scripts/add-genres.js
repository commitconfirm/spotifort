#!/usr/bin/env node

/**
 * Add genres to lineup.json using MusicBrainz API with Last.fm fallback
 *
 * For each artist: try MusicBrainz first, if no genres found, try Last.fm
 *
 * Usage:
 *   node scripts/add-genres.js
 *
 * Requires:
 *   - LASTFM_API_KEY in .env.local (get one at https://www.last.fm/api/account/create)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINEUP_PATH = join(__dirname, '..', 'public', 'lineup.json');
const ENV_PATH = join(__dirname, '..', '.env.local');

// Load environment variables
if (existsSync(ENV_PATH)) {
  config({ path: ENV_PATH });
}

const MB_API_BASE = 'https://musicbrainz.org/ws/2';
const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';
const USER_AGENT = 'Spotifort/1.0 (https://spotifort.com)';

const MB_REQUEST_DELAY = 1100; // 1.1 seconds (MusicBrainz requires 1/sec)
const LASTFM_REQUEST_DELAY = 200; // 200ms (Last.fm allows 5/sec)

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search MusicBrainz for an artist by name
 * Returns the MusicBrainz ID (MBID) or null if not found
 */
async function searchMusicBrainz(artistName) {
  const query = encodeURIComponent(artistName);
  const url = `${MB_API_BASE}/artist/?query=${query}&fmt=json&limit=1`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 503) {
        console.log(`\n  Rate limited (503). Waiting 5s...`);
        await sleep(5000);
        return null;
      }
      return null;
    }

    const data = await response.json();
    const artists = data.artists;

    if (!artists || artists.length === 0) {
      return null;
    }

    return artists[0].id;
  } catch (err) {
    return null;
  }
}

/**
 * Fetch genres for an artist by MusicBrainz ID
 * Returns array of genre names
 */
async function fetchMusicBrainzGenres(mbid) {
  const url = `${MB_API_BASE}/artist/${mbid}?inc=genres&fmt=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 503) {
        console.log(`\n  Rate limited (503). Waiting 5s...`);
        await sleep(5000);
        return [];
      }
      return [];
    }

    const data = await response.json();
    const genres = data.genres || [];

    return genres
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .map(g => g.name);
  } catch (err) {
    return [];
  }
}

/**
 * Fetch tags from Last.fm for an artist
 * Returns top 5 tags with count > 30
 */
async function fetchLastFmTags(artistName, apiKey) {
  const query = encodeURIComponent(artistName);
  const url = `${LASTFM_API_BASE}/?method=artist.gettoptags&artist=${query}&api_key=${apiKey}&format=json`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (data.error || !data.toptags || !data.toptags.tag) {
      return [];
    }

    const tags = data.toptags.tag;

    // Filter tags with count > 30 and take top 5
    return tags
      .filter(t => t.count > 30)
      .slice(0, 5)
      .map(t => t.name.toLowerCase());
  } catch (err) {
    return [];
  }
}

/**
 * Save lineup to file
 */
function saveLineup(lineup) {
  lineup.lastUpdated = new Date().toISOString().split('T')[0];
  writeFileSync(LINEUP_PATH, JSON.stringify(lineup, null, 2) + '\n');
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('Add Genres (MusicBrainz + Last.fm)');
  console.log('==================================');
  console.log('');

  const lastfmApiKey = process.env.LASTFM_API_KEY;
  if (!lastfmApiKey) {
    console.log('Warning: No LASTFM_API_KEY in .env.local - Last.fm fallback disabled');
    console.log('Get one at: https://www.last.fm/api/account/create');
    console.log('');
  }

  // Load existing lineup
  console.log('Loading lineup.json...');
  const lineup = JSON.parse(readFileSync(LINEUP_PATH, 'utf8'));
  const artists = lineup.artists;

  // Find artists that need genres
  const needsGenres = artists.filter(a => !a.genres || a.genres.length === 0);
  const alreadyHasGenres = artists.filter(a => a.genres && a.genres.length > 0);

  console.log(`  Total artists: ${artists.length}`);
  console.log(`  Already have genres: ${alreadyHasGenres.length}`);
  console.log(`  Need genres: ${needsGenres.length}`);
  console.log('');

  if (needsGenres.length === 0) {
    console.log('All artists already have genres!');
    return;
  }

  const estMinutes = Math.ceil(needsGenres.length * 2.5 / 60);
  console.log(`Processing ${needsGenres.length} artists (~${estMinutes} minutes)...`);
  console.log('');

  let processed = 0;
  let fromMusicBrainz = 0;
  let fromLastFm = 0;
  let noGenres = 0;
  const saveInterval = 25;

  for (const artist of needsGenres) {
    processed++;
    const progress = `[${processed}/${needsGenres.length}]`;

    process.stdout.write(`${progress} ${artist.name.padEnd(40).slice(0, 40)}`);

    let genres = [];
    let source = null;

    // Try Last.fm first (faster, better coverage)
    if (lastfmApiKey) {
      genres = await fetchLastFmTags(artist.name, lastfmApiKey);
      await sleep(LASTFM_REQUEST_DELAY);
      if (genres.length > 0) {
        source = 'LFM';
        fromLastFm++;
      }
    }

    // Fall back to MusicBrainz if no Last.fm tags
    if (genres.length === 0) {
      const mbid = await searchMusicBrainz(artist.name);
      await sleep(MB_REQUEST_DELAY);

      if (mbid) {
        genres = await fetchMusicBrainzGenres(mbid);
        await sleep(MB_REQUEST_DELAY);
        if (genres.length > 0) {
          source = 'MB';
          fromMusicBrainz++;
        }
      }
    }

    artist.genres = genres;

    if (genres.length > 0) {
      console.log(` → [${source}] ${genres.slice(0, 3).join(', ')}${genres.length > 3 ? '...' : ''}`);
    } else {
      noGenres++;
      console.log(' → no genres');
    }

    // Save progress periodically
    if (processed % saveInterval === 0) {
      saveLineup(lineup);
      console.log(`  [Saved: ${processed}/${needsGenres.length}]`);
    }
  }

  // Final save
  saveLineup(lineup);

  // Summary
  const totalWithGenres = artists.filter(a => a.genres && a.genres.length > 0).length;
  const allGenres = new Set(artists.flatMap(a => a.genres || []));

  console.log('');
  console.log('Summary');
  console.log('=======');
  console.log(`  From MusicBrainz:    ${fromMusicBrainz}`);
  console.log(`  From Last.fm:        ${fromLastFm}`);
  console.log(`  No genres found:     ${noGenres}`);
  console.log(`  Total with genres:   ${totalWithGenres}/${artists.length}`);
  console.log(`  Unique genres:       ${allGenres.size}`);
  console.log('');
  console.log(`Saved to: ${LINEUP_PATH}`);
  console.log('');
  console.log('Done!');
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
