// Spotify API calls

import { log } from './main.js';

const API_BASE = 'https://api.spotify.com/v1';

/**
 * Fetch all liked songs from the user's library (paginated)
 * @param {string} accessToken - Spotify access token
 * @param {Function} onProgress - Optional callback called with track count after each page
 * @returns {Promise<Array>} - Array of track objects
 */
export async function fetchLikedSongs(accessToken, onProgress) {
  const tracks = [];
  let url = `${API_BASE}/me/tracks?limit=50`;
  let pageCount = 0;

  log.info('Fetching liked songs...');

  // Call progress callback with initial count
  if (onProgress) {
    onProgress(0);
  }

  while (url) {
    pageCount++;
    log.info(`Fetching page ${pageCount}...`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      log.error('Failed to fetch liked songs:', errorData);
      throw new Error(`Failed to fetch liked songs: ${errorData.error?.message || response.status}`);
    }

    const data = await response.json();
    tracks.push(...data.items);

    // Call progress callback with updated count
    if (onProgress) {
      onProgress(tracks.length);
    }

    // Get next page URL (null if no more pages)
    url = data.next;
  }

  log.info(`Fetched ${tracks.length} liked songs across ${pageCount} pages`);
  return tracks;
}

/**
 * Extract unique artist IDs from tracks
 * @param {Array} tracks - Array of track objects from /me/tracks
 * @returns {Set<string>} - Set of unique artist IDs
 */
export function extractArtistIds(tracks) {
  const artistIds = new Set();

  for (const item of tracks) {
    // Each item has a .track property containing the actual track
    const track = item.track;
    if (track && track.artists) {
      for (const artist of track.artists) {
        artistIds.add(artist.id);
      }
    }
  }

  log.info(`Extracted ${artistIds.size} unique artist IDs from liked songs`);
  return artistIds;
}

