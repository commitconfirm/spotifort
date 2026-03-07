// Matching logic — liked songs vs Treefort lineup

import { log } from './main.js';

/**
 * Load the Treefort lineup from lineup.json
 * @returns {Promise<Object>} - Lineup data with lastUpdated and artists array
 */
export async function loadLineup() {
  log.info('Loading Treefort lineup...');

  const response = await fetch('/lineup.json');

  if (!response.ok) {
    log.error('Failed to load lineup:', response.status);
    throw new Error(`Failed to load lineup: ${response.status}`);
  }

  const data = await response.json();
  log.info(`Loaded lineup with ${data.artists.length} artists (last updated: ${data.lastUpdated})`);

  return data;
}

/**
 * Match user's artist IDs against the Treefort lineup
 * @param {Set<string>} userArtistIds - Set of Spotify artist IDs from user's library
 * @param {Array} lineupArtists - Array of artist objects from lineup.json
 * @returns {Array} - Array of matched artist objects
 */
export function matchArtists(userArtistIds, lineupArtists) {
  const matched = [];

  for (const artist of lineupArtists) {
    // Skip artists not on Spotify
    if (artist.notOnSpotify || !artist.spotifyId) {
      continue;
    }

    if (userArtistIds.has(artist.spotifyId)) {
      matched.push(artist);
    }
  }

  log.info(`Matched ${matched.length} artists from your library with Treefort lineup`);
  return matched;
}

/**
 * Get artists from lineup that are not on Spotify
 * @param {Array} lineupArtists - Array of artist objects from lineup.json
 * @returns {Array} - Array of artist objects with notOnSpotify: true
 */
export function getNotOnSpotify(lineupArtists) {
  return lineupArtists.filter((artist) => artist.notOnSpotify);
}
