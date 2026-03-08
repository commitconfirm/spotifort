#!/usr/bin/env node

/**
 * Add genres to existing lineup.json using GET /artists/{id}
 *
 * This script uses the individual artist endpoint instead of Search API,
 * which may have separate rate limits. It can resume from where it left off.
 *
 * Usage:
 *   node scripts/add-genres.js
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINEUP_PATH = join(__dirname, '..', 'public', 'lineup.json');

const API_BASE = 'https://api.spotify.com/v1';
const REQUEST_DELAY = 500; // ms between API calls - be gentle

/**
 * Prompt user for input
 */
function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
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
 * Fetch artist by ID - returns genres or null
 * STOPS IMMEDIATELY on rate limit
 */
async function fetchArtistGenres(accessToken, artistId) {
  const url = `${API_BASE}/artists/${artistId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || 'unknown';
    console.log(`\n\n*** RATE LIMITED ***`);
    console.log(`Retry-After header: ${retryAfter} seconds`);
    console.log(`Stopping immediately to preserve progress.`);
    return { rateLimited: true };
  }

  if (response.status === 403) {
    console.log(`\n  WARNING: 403 Forbidden for artist ${artistId} - endpoint may be blocked`);
    return { rateLimited: false, genres: [], blocked: true };
  }

  if (!response.ok) {
    console.log(`\n  ERROR: ${response.status} for artist ${artistId}`);
    return { rateLimited: false, genres: [] };
  }

  const data = await response.json();
  return { rateLimited: false, genres: data.genres || [] };
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('Add Genres to Lineup');
  console.log('====================');
  console.log('');
  console.log('This script adds genre data to existing artists in lineup.json');
  console.log('using GET /artists/{id} endpoint. Stops immediately on rate limit.');
  console.log('');
  console.log('To get an access token:');
  console.log('  1. Run the Spotifort app (npm run dev)');
  console.log('  2. Connect your Spotify account');
  console.log('  3. Copy the token from browser console');
  console.log('');

  const accessToken = await prompt('Paste your access token: ');

  if (!accessToken) {
    console.error('Error: No access token provided');
    process.exit(1);
  }

  // Load existing lineup
  console.log('');
  console.log('Loading lineup.json...');
  const lineup = JSON.parse(readFileSync(LINEUP_PATH, 'utf8'));
  const artists = lineup.artists;

  // Find artists that need genres (have spotifyId but no genres)
  const needsGenres = artists.filter(a =>
    a.spotifyId && (!a.genres || a.genres.length === 0)
  );
  const alreadyHasGenres = artists.filter(a => a.genres && a.genres.length > 0);

  console.log(`  Total artists: ${artists.length}`);
  console.log(`  Already have genres: ${alreadyHasGenres.length}`);
  console.log(`  Need genres: ${needsGenres.length}`);
  console.log('');

  if (needsGenres.length === 0) {
    console.log('All artists already have genres!');
    return;
  }

  // Test with first artist
  console.log('Testing API access...');
  const testArtist = needsGenres[0];
  const testResult = await fetchArtistGenres(accessToken, testArtist.spotifyId);

  if (testResult.rateLimited) {
    console.log('Cannot proceed - rate limited on first request.');
    process.exit(1);
  }

  if (testResult.blocked) {
    console.log('ERROR: GET /artists/{id} endpoint appears to be blocked (403).');
    console.log('This endpoint should work for Dev Mode apps. Check your token.');
    process.exit(1);
  }

  console.log(`  Test passed: ${testArtist.name} has ${testResult.genres.length} genres`);
  if (testResult.genres.length > 0) {
    console.log(`  Genres: ${testResult.genres.slice(0, 3).join(', ')}${testResult.genres.length > 3 ? '...' : ''}`);
  }
  console.log('');

  // Process all artists needing genres
  console.log(`Processing ${needsGenres.length} artists...`);
  console.log('');

  let processed = 0;
  let withGenres = 0;
  let rateLimited = false;

  for (const artist of needsGenres) {
    processed++;
    process.stdout.write(`\r  ${processed}/${needsGenres.length}: ${artist.name.padEnd(45).slice(0, 45)}`);

    const result = await fetchArtistGenres(accessToken, artist.spotifyId);

    if (result.rateLimited) {
      rateLimited = true;
      break;
    }

    // Update artist in the original array
    artist.genres = result.genres;
    if (result.genres.length > 0) {
      withGenres++;
    }

    await sleep(REQUEST_DELAY);
  }

  console.log('');
  console.log('');

  // Save progress regardless of rate limit
  lineup.lastUpdated = new Date().toISOString().split('T')[0];
  writeFileSync(LINEUP_PATH, JSON.stringify(lineup, null, 2) + '\n');

  // Summary
  const totalWithGenres = artists.filter(a => a.genres && a.genres.length > 0).length;
  const allGenres = new Set(artists.flatMap(a => a.genres || []));

  console.log('Summary');
  console.log('-------');
  console.log(`  Processed this run: ${processed}`);
  console.log(`  Found genres for: ${withGenres}`);
  console.log(`  Total with genres: ${totalWithGenres}/${artists.length}`);
  console.log(`  Unique genres: ${allGenres.size}`);
  console.log('');
  console.log(`Saved to: ${LINEUP_PATH}`);

  if (rateLimited) {
    const remaining = needsGenres.length - processed;
    console.log('');
    console.log(`*** Rate limited after ${processed} artists. ${remaining} remaining. ***`);
    console.log('Run this script again later to continue.');
  } else {
    console.log('');
    console.log('Done!');
  }
}

main();
