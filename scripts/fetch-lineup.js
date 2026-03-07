#!/usr/bin/env node

/**
 * Fetch Treefort 2026 lineup and enrich with Spotify data
 *
 * Pipeline:
 *   1. Fetch artist names from Treefort website (ground truth)
 *   2. Search Spotify for each artist to get Spotify ID and URL
 *   3. Fetch genres for each artist with a Spotify ID
 *   4. Write result to public/lineup.json
 *
 * Usage:
 *   node scripts/fetch-lineup.js
 */

import { createInterface } from 'readline';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'public', 'lineup.json');

const TREEFORT_LINEUP_URL = 'https://treefortmusicfest.com/lineup/';
const API_BASE = 'https://api.spotify.com/v1';
const REQUEST_DELAY = 300; // ms between API calls
const MAX_RETRIES = 3;

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
 * Fetch with retry and rate limit handling
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      // Rate limited - use exponential backoff, cap at 30 seconds
      const backoff = Math.min(30, Math.pow(2, attempt + 1));
      console.log(`\n  Rate limited. Waiting ${backoff}s before retry ${attempt}/${retries}...`);
      await sleep(backoff * 1000);
      continue;
    }

    return response;
  }

  // All retries exhausted
  return { ok: false, status: 429, text: async () => 'Rate limit exceeded after retries' };
}

/**
 * Fetch artist names from Treefort website
 * Note: HTML parsing is unreliable, so we use the cached list directly
 */
async function fetchWebsiteLineup() {
  console.log('Using cached Treefort lineup (HTML parsing is unreliable)...');
  return getCachedWebsiteLineup();
}

/**
 * Cached website lineup (fallback if HTML parsing fails)
 * Last updated: 2026-03-07
 */
function getCachedWebsiteLineup() {
  return [
    "Magdalena Bay", "Geese", "flipturn", "Father John Misty", "Mother Mother",
    "Amber Mark", "The Beaches", "St. Paul & The Broken Bones", "INJI", "Evan Honer",
    "Built to Spill", "hemlocke springs", "JMSN", "Machine Girl", "Blondshell",
    "DUCKWRTH", "Samia", "San Holo", "Haute & Freddy", "nimino", "Tune-Yards",
    "COBRAH", "Maddie Zahm", "Son Little", "The Wonder Years", "Yellow Days",
    "Citizen", "Billie Marten", "The Army, The Navy", "Andy Frasco & The U.N.",
    "Hannah Cohen", "Kishi Bashi", "Rehash", "Toody Cole & Her Band",
    "The Belair Lip Bombs", "The Nude Party", "Tokyo Tea Room", "White Reaper",
    "Anamanaguchi", "Angel Du$t", "Brijean", "Chanpan", "hellogoodbye",
    "John Craigie", "Kaleena Zanders", "Porches", "The Early November",
    "The Womack Sisters", "Gelli Haha", "Drug Church", "femtanyl", "Ingrown",
    "SEXTILE", "STOMACH BOOK", "Surf Hat", "Wine Lips", "Ben Quad", "Cat Clyde",
    "Home Front", "LSD and the Search for God", "Wallice", "Catie Turner",
    "Eshu Tune", "Kassa Overall", "Pearly Drops", "BIG SIS", "Cab Ellis",
    "Cece Coakley", "Chalk", "Death Lens", "Elise Trouw presents The Diary of Elon Lust",
    "FIGHTMASTER", "Initiate", "Instant Crush", "Knuckle Puck", "Liz Cooper",
    "mclusky", "Mexican Slum Rats", "Momma", "Oh He Dead", "Sessa", "Silverada",
    "The Psycodelics", "Abby Holliday", "Girl Tones", "Landon Conrath", "West 22nd",
    "Heaven For Real", "Acopia", "Ellis Bullard", "Go Kurosawa", "Kevin Devine",
    "Macseal", "Steinza", "Whitmer Thomas", "Angela Autumn", "Beton Armé",
    "Divorce", "Eddie 9V", "future.exboyfriend", "Heathers", "John Roseboro",
    "L.A. WITCH", "lots of hands", "Night Cap", "Prism Bitch", "runo plum",
    "Saintseneca", "Shady Nasty", "SKORTS", "Spoon Benders", "SPY", "Sword II",
    "The Macks", "The Two Lips", "Tyler Ballgame", "Venus & the Flytraps",
    "Witch Post", "Jens Kuross", "Moon Owl's Mages", "Aren't We Amphibians",
    "Case Oats", "corto.alto", "Deloyd Elze", "Drook", "dust", "Ekko Astral",
    "Footballhead", "Fust", "Gladie", "Improvement Movement", "Jeff Crosby",
    "Kash'd Out", "Merce Lemon", "Odd Man Out", "PISS", "Riley!",
    "Sam Burchfield", "Soft Blue Shimmer", "The Sophs", "The Takes",
    "The Velveteers", "Vika & the Velvets", "Will Swinton", "Willa Mae", "Yuuf",
    "Frankie Tillo", "Blueprint", "Lily Seabird", "Pancho and the Wizards",
    "Smokey Brights", "The Thing", "Trestles", "VIAL",
    "Walter Mitty and His Makeshift Orchestra", "War On Women", "Victor Jones",
    "Buckets", "Keddies Resort", "Lex Leosis", "MARO", "The Dangerous Summer",
    "Ashley Young", "Ally Nicholas", "Anna Moss", "Bob Sumner", "Chloe Gendrow",
    "Connor Kelly & The Time Warp", "Emily Yacina", "meg elsier", "Shadow Work",
    "The Dirty Turkeys", "Tobacco Road", "BYLAND", "fanclubwallet", "©asi",
    "Bad Tiger", "BLXCKPUNKS", "Cure for Paranoia", "Help", "Hillfolk Noir",
    "Jang The Goon", "jo passed", "Landlady", "MX LONELY", "Tom Hamilton Band",
    "Tylor & the Train Robbers", "Zookraught", "Boot Juice", "Forty Feet Tall",
    "Night Heron", "Teddy And The Rough Riders", "hemlock", "Motherhood",
    "Tispur", "Wes Parker", "With Child", "Kiss the Tiger",
    "Rudy Love and The Encore", "Acapulco Lips", "Afrosonics", "Alex Vile",
    "Amoeba Arena", "Anyone Awake", "Aubory Bugg", "Barbara", "Barn",
    "Bonnie Trash", "Brand New Companion", "Buddy Wynkoop", "Chief Broom",
    "Chipped Nail Polish", "Clarion", "Dark Chisme",
    "Dedicated Servers with The French Tips and Friends", "Deep Heaven",
    "Family Worship Center", "Floating Witch's Head", "Horror Hi-Fi",
    "Hudson Powder Company",
  ];
}

/**
 * Search Spotify for an artist by name
 * Returns { spotifyId, spotifyUrl, genres } or null if not found
 * Note: Search API returns genres directly, no separate call needed
 */
let firstErrorLogged = false;
async function searchSpotifyArtist(accessToken, artistName, debug = false) {
  const query = encodeURIComponent(artistName);
  const url = `${API_BASE}/search?type=artist&q=${query}&limit=1`;

  const response = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (!firstErrorLogged) {
      console.log(`\n  ERROR: Search API returned ${response.status}`);
      const text = await response.text();
      console.log(`  Response: ${text}`);
      console.log('');
      firstErrorLogged = true;
    }
    return null;
  }

  const data = await response.json();
  const artists = data.artists?.items;

  if (!artists || artists.length === 0) {
    return null;
  }

  const artist = artists[0];

  // Debug: log first artist's full response to see what fields are available
  if (debug) {
    console.log('\n  DEBUG - First artist search response:');
    console.log('  Keys:', Object.keys(artist).join(', '));
    console.log('  genres:', JSON.stringify(artist.genres));
    console.log('');
  }

  return {
    spotifyId: artist.id,
    spotifyUrl: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
    genres: artist.genres || [],
  };
}

/**
 * Process all artists: search Spotify (genres included in search response)
 */
async function processArtists(accessToken, artistNames) {
  const artists = [];
  const total = artistNames.length;

  console.log(`Processing ${total} artists...`);
  console.log('');

  for (let i = 0; i < artistNames.length; i++) {
    const name = artistNames[i];
    const num = i + 1;

    process.stdout.write(`\r  Processing artist ${num}/${total}: ${name.padEnd(50).slice(0, 50)}`);

    // Search for artist on Spotify (includes genres in response)
    // Debug first artist to see response structure
    const spotifyData = await searchSpotifyArtist(accessToken, name, i === 0);
    await sleep(REQUEST_DELAY);

    if (spotifyData) {
      artists.push({
        name,
        spotifyId: spotifyData.spotifyId,
        spotifyUrl: spotifyData.spotifyUrl,
        notOnSpotify: false,
        genres: spotifyData.genres,
      });
    } else {
      artists.push({
        name,
        spotifyId: null,
        spotifyUrl: null,
        notOnSpotify: true,
        genres: [],
      });
    }
  }

  console.log('');
  console.log('');

  return artists;
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('Treefort 2026 Lineup Fetcher');
  console.log('============================');
  console.log('');
  console.log('This script builds the lineup by:');
  console.log('  1. Fetching artist names from the Treefort website');
  console.log('  2. Searching Spotify for each artist');
  console.log('  3. Fetching genres for matched artists');
  console.log('');
  console.log('To get an access token:');
  console.log('  1. Run the Spotifort app (npm run dev)');
  console.log('  2. Connect your Spotify account');
  console.log('  3. Copy the token from browser console: [spotifort] Access token: <token>');
  console.log('');
  console.log('Note: If you hit rate limits (429), wait 30-60 seconds before retrying.');
  console.log('');

  const accessToken = await prompt('Paste your access token: ');

  if (!accessToken) {
    console.error('Error: No access token provided');
    process.exit(1);
  }

  try {
    // Test API access first
    console.log('Testing Spotify API access...');
    const testResult = await searchSpotifyArtist(accessToken, 'Built to Spill', true);
    if (!testResult) {
      console.error('ERROR: Search API is not working. Check your access token.');
      process.exit(1);
    }
    console.log(`  Test passed: Found "${testResult.spotifyId}"`);
    console.log('');

    // Step 1: Fetch website lineup
    const artistNames = await fetchWebsiteLineup();
    console.log(`  Total artists: ${artistNames.length}`);
    console.log('');

    // Step 2 & 3: Search Spotify and fetch genres
    const artists = await processArtists(accessToken, artistNames);

    // Sort alphabetically
    artists.sort((a, b) => a.name.localeCompare(b.name));

    // Step 4: Write to file
    const lineup = {
      lastUpdated: new Date().toISOString().split('T')[0],
      artists,
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(lineup, null, 2) + '\n');

    // Summary
    const withSpotify = artists.filter(a => !a.notOnSpotify);
    const withoutSpotify = artists.filter(a => a.notOnSpotify);
    const withGenres = artists.filter(a => a.genres && a.genres.length > 0);
    const allGenres = new Set(artists.flatMap(a => a.genres || []));

    console.log('Summary');
    console.log('-------');
    console.log(`  Total artists:          ${artists.length}`);
    console.log(`  Found on Spotify:       ${withSpotify.length}`);
    console.log(`  Not found on Spotify:   ${withoutSpotify.length}`);
    console.log(`  Artists with genres:    ${withGenres.length}`);
    console.log(`  Unique genres:          ${allGenres.size}`);
    console.log('');
    console.log(`Written to: ${OUTPUT_PATH}`);

    if (withoutSpotify.length > 0) {
      console.log('');
      console.log('Artists not found on Spotify:');
      withoutSpotify.forEach(a => console.log(`  - ${a.name}`));
    }

    console.log('');
    console.log('Done!');

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
