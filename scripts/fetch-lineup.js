#!/usr/bin/env node

/**
 * Fetch and clean Treefort 2026 lineup
 *
 * Pipeline:
 *   1. Prompt for Spotify access token
 *   2. Fetch all tracks from Treefort playlist, extract unique artists with Spotify IDs
 *   3. Fetch Treefort website lineup (ground truth)
 *   4. Cross-reference: keep only website artists, attach Spotify IDs where available
 *   5. Write cleaned result to public/lineup.json
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

const PLAYLIST_ID = '5VHdkLixppY5lhqTUSpIXX';
const TREEFORT_LINEUP_URL = 'https://treefortmusicfest.com/lineup/';
const API_BASE = 'https://api.spotify.com/v1';

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
 * Fetch all tracks from a Spotify playlist (handles pagination)
 */
async function fetchPlaylistTracks(accessToken, playlistId) {
  const tracks = [];
  let url = `${API_BASE}/playlists/${playlistId}/tracks?limit=50`;

  console.log('Fetching Spotify playlist tracks...');

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Spotify API error: ${error.error?.message || response.status}`);
    }

    const data = await response.json();
    tracks.push(...data.items);
    process.stdout.write(`\r  Fetched ${tracks.length} tracks...`);

    url = data.next;
  }

  console.log('');
  return tracks;
}

/**
 * Extract unique artists from playlist tracks
 */
function extractArtistsFromPlaylist(tracks) {
  const artistMap = new Map();

  for (const item of tracks) {
    const track = item.track;
    if (!track || !track.artists) continue;

    for (const artist of track.artists) {
      if (!artistMap.has(artist.id)) {
        artistMap.set(artist.id, {
          name: artist.name,
          spotifyId: artist.id,
          spotifyUrl: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
        });
      }
    }
  }

  return artistMap;
}

/**
 * Fetch artist names from Treefort website
 */
async function fetchWebsiteLineup() {
  console.log('Fetching Treefort website lineup...');

  const response = await fetch(TREEFORT_LINEUP_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`);
  }

  const html = await response.text();

  // Extract artist names from the HTML
  // The lineup page has artist names in specific elements
  const artists = [];

  // Match artist names from the lineup grid/list
  // Looking for patterns like <h3>Artist Name</h3> or similar heading elements
  // and also data in lineup card elements

  // Try multiple patterns to extract artist names
  const patterns = [
    // Artist cards with titles
    /<h[1-6][^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)</gi,
    // Lineup item headings
    /<h[1-6][^>]*>([^<]{2,50})<\/h[1-6]>/gi,
    // Artist links
    /<a[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)</gi,
    // Span/div with artist class
    /<(?:span|div)[^>]*class="[^"]*(?:artist-name|lineup-artist)[^"]*"[^>]*>([^<]+)</gi,
  ];

  const foundNames = new Set();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1].trim();
      if (name.length > 1 && name.length < 100 && !name.includes('<')) {
        foundNames.add(name);
      }
    }
  }

  // If we didn't find many artists with patterns, try a more aggressive approach
  // Look for the main content area and extract text that looks like artist names
  if (foundNames.size < 50) {
    // Extract from common lineup markup patterns
    const altPatterns = [
      /data-artist="([^"]+)"/gi,
      /title="([^"]+)"\s*class="[^"]*artist/gi,
      /"name":\s*"([^"]+)"/gi,
    ];

    for (const pattern of altPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const name = match[1].trim();
        if (name.length > 1 && name.length < 100) {
          foundNames.add(name);
        }
      }
    }
  }

  console.log(`  Found ${foundNames.size} artists from website HTML parsing`);

  // If parsing failed, fall back to the known list
  if (foundNames.size < 50) {
    console.log('  HTML parsing insufficient, using cached lineup data...');
    return getCachedWebsiteLineup();
  }

  return Array.from(foundNames);
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
 * Normalize artist name for comparison
 */
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cross-reference playlist artists with website lineup
 */
function crossReference(playlistArtists, websiteArtists) {
  // Create normalized lookup from playlist
  const spotifyLookup = new Map();
  for (const [id, artist] of playlistArtists) {
    spotifyLookup.set(normalize(artist.name), artist);
  }

  // Create normalized map of website artists
  const websiteNormalized = new Map();
  for (const name of websiteArtists) {
    websiteNormalized.set(normalize(name), name);
  }

  // Build final lineup
  const finalArtists = [];
  let kept = 0;
  let added = 0;
  let removed = 0;

  // Process website artists
  for (const [normalizedName, originalName] of websiteNormalized) {
    const spotifyArtist = spotifyLookup.get(normalizedName);

    if (spotifyArtist) {
      finalArtists.push({
        name: originalName,
        spotifyId: spotifyArtist.spotifyId,
        spotifyUrl: spotifyArtist.spotifyUrl,
        notOnSpotify: false,
      });
      kept++;
    } else {
      finalArtists.push({
        name: originalName,
        spotifyId: null,
        spotifyUrl: null,
        notOnSpotify: true,
      });
      added++;
    }
  }

  // Count removed (in playlist but not on website)
  for (const [id, artist] of playlistArtists) {
    if (!websiteNormalized.has(normalize(artist.name))) {
      removed++;
    }
  }

  // Sort alphabetically
  finalArtists.sort((a, b) => a.name.localeCompare(b.name));

  return { artists: finalArtists, kept, added, removed };
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('Treefort 2026 Lineup Fetcher');
  console.log('============================');
  console.log('');
  console.log('This script builds a clean lineup by:');
  console.log('  1. Fetching artists from the Treefort Spotify playlist');
  console.log('  2. Cross-referencing with the official Treefort website');
  console.log('  3. Keeping only confirmed performing artists');
  console.log('');
  console.log('To get an access token:');
  console.log('  1. Run the Spotifort app (npm run dev)');
  console.log('  2. Connect your Spotify account');
  console.log('  3. Copy the token from browser console: [spotifort] Access token: <token>');
  console.log('');

  const accessToken = await prompt('Paste your access token: ');

  if (!accessToken) {
    console.error('Error: No access token provided');
    process.exit(1);
  }

  try {
    // Step 1: Fetch playlist tracks
    const tracks = await fetchPlaylistTracks(accessToken, PLAYLIST_ID);
    console.log(`  Total tracks in playlist: ${tracks.length}`);

    // Step 2: Extract unique artists from playlist
    const playlistArtists = extractArtistsFromPlaylist(tracks);
    console.log(`  Unique artists in playlist: ${playlistArtists.size}`);

    // Step 3: Fetch website lineup
    const websiteArtists = await fetchWebsiteLineup();
    console.log(`  Artists on website: ${websiteArtists.length}`);

    // Step 4: Cross-reference
    console.log('');
    console.log('Cross-referencing...');
    const { artists, kept, added, removed } = crossReference(playlistArtists, websiteArtists);

    // Step 5: Write to file
    const lineup = {
      lastUpdated: new Date().toISOString().split('T')[0],
      artists: artists,
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(lineup, null, 2) + '\n');

    // Summary
    console.log('');
    console.log('Summary');
    console.log('-------');
    console.log(`  Kept (website + Spotify):    ${kept}`);
    console.log(`  Added (website, no Spotify): ${added}`);
    console.log(`  Removed (not on website):    ${removed}`);
    console.log('');
    console.log(`Final lineup: ${artists.length} artists`);
    console.log(`Written to: ${OUTPUT_PATH}`);

    if (added > 0) {
      console.log('');
      console.log('Artists without Spotify data:');
      artists
        .filter(a => a.notOnSpotify)
        .forEach(a => console.log(`  - ${a.name}`));
    }

    console.log('');
    console.log('Done!');

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
