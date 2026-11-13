// Matching logic — liked songs vs Treefort lineup

import { log } from './main.js';
import { matchLineupArtists } from './match-core.js';

/**
 * Load the Treefort lineup from the year's lineup file
 * @returns {Promise<Object>} - Lineup data with lastUpdated and artists array
 */
export async function loadLineup() {
  log.info('Loading Treefort lineup...');

  const response = await fetch(`/lineups/${__FESTIVAL_YEAR__}.json`);

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
 * @param {Array} lineupArtists - Array of artist objects from the year's lineup file
 * @returns {Array} - Array of matched artist objects
 */
export function matchArtists(userArtistIds, lineupArtists) {
  const matched = matchLineupArtists(userArtistIds, lineupArtists);

  log.info(`Matched ${matched.length} artists from your library with Treefort lineup`);
  return matched;
}

/**
 * Get artists from lineup that are not on Spotify
 * @param {Array} lineupArtists - Array of artist objects from the year's lineup file
 * @returns {Array} - Array of artist objects with notOnSpotify: true
 */
export function getNotOnSpotify(lineupArtists) {
  return lineupArtists.filter((artist) => artist.notOnSpotify);
}
