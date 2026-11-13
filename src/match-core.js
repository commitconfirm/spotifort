// Pure matching logic (no side-effect imports, so it can be unit tested)

/**
 * Match user's artist IDs against the lineup.
 * An entry matches when the user has its primary spotifyId or any additionalSpotifyIds
 * (multi-artist billings such as "A & B"). Each entry appears at most once.
 * @param {Set<string>} userArtistIds
 * @param {Array} lineupArtists
 * @returns {Array} matched lineup entries (original objects, keyed by primary spotifyId)
 */
export function matchLineupArtists(userArtistIds, lineupArtists) {
  const matched = [];

  for (const artist of lineupArtists) {
    // Skip artists not on Spotify
    if (artist.notOnSpotify || !artist.spotifyId) {
      continue;
    }

    const extra = Array.isArray(artist.additionalSpotifyIds) ? artist.additionalSpotifyIds : [];
    if (userArtistIds.has(artist.spotifyId) || extra.some((id) => userArtistIds.has(id))) {
      matched.push(artist);
    }
  }

  return matched;
}
