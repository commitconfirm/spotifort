// Lineup page — displays full Treefort lineup data

import { escapeHtml, safeSpotifyUrl, formatDate } from './utils.js';

/**
 * Render a plain list of artist names
 * @param {Array} artists
 * @returns {string} HTML
 */
function renderNameList(artists) {
  const items = artists
    .map(artist => `
        <li>
          <span class="artist-link">
            <span class="artist-marker">[-]</span>
            <span class="artist-name">${escapeHtml(artist.name)}</span>
          </span>
        </li>`)
    .join('');
  return `<ul class="artist-list">${items}</ul>`;
}

/**
 * Render the lineup data
 */
function renderLineup(data) {
  const content = document.getElementById('lineup-content');
  const lastUpdated = document.getElementById('last-updated');

  // Set last updated date
  lastUpdated.textContent = `Lineup last updated: ${formatDate(data.lastUpdated)}`;

  // Separate artists by Spotify availability
  // Records with no Spotify ID and notOnSpotify false were never looked up (or the lookup failed):
  // they are "pending", not "not found".
  const onSpotify = data.artists.filter(a => a.spotifyId);
  const notOnSpotify = data.artists.filter(a => !a.spotifyId && a.notOnSpotify);
  const pending = data.artists.filter(a => !a.spotifyId && !a.notOnSpotify);

  // Build HTML
  let html = '<div class="lineup-grid">';

  // Artists on Spotify
  html += `
    <div class="list-box">
      <h2>Artists on Spotify (${onSpotify.length})</h2>
      <ul class="artist-list">
  `;

  for (const artist of onSpotify) {
    const spotifyUrl = safeSpotifyUrl(artist.spotifyUrl);
    const link = spotifyUrl
      ? `<a href="${escapeHtml(spotifyUrl)}" target="_blank" rel="noopener noreferrer" class="artist-link">
          <span class="artist-marker">[+]</span>
          <span class="artist-name">${escapeHtml(artist.name)}</span>
        </a>`
      : `<span class="artist-link">
          <span class="artist-marker">[+]</span>
          <span class="artist-name">${escapeHtml(artist.name)}</span>
        </span>`;
    html += `<li>${link}</li>`;
  }

  html += `
      </ul>
    </div>
  `;

  // Artists not on Spotify (searched successfully, no result)
  html += `
    <div class="list-box">
      <h2>Artists Not Found on Spotify (${notOnSpotify.length})</h2>
  `;

  if (notOnSpotify.length > 0) {
    html += renderNameList(notOnSpotify);
  } else if (pending.length === 0) {
    html += '<p class="empty-state">All artists were found on Spotify.</p>';
  } else {
    html += '<p class="empty-state">None confirmed yet.</p>';
  }

  html += `
    </div>
  `;

  // Artists whose Spotify lookup has not completed
  if (pending.length > 0) {
    html += `
    <div class="list-box">
      <h2>Spotify Lookup Pending (${pending.length})</h2>
      <p class="lineup-pending-note">These artists are on the festival lineup, but their Spotify lookup has not completed yet, so they cannot be matched to your library for now.</p>
      ${renderNameList(pending)}
    </div>
    `;
  }

  html += '</div>';

  content.innerHTML = html;
}

/**
 * Show error message
 */
function showError(message) {
  const content = document.getElementById('lineup-content');
  content.innerHTML = `
    <div class="list-box centered">
      <p class="lineup-error-text">Error: ${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Initialize the page
 */
async function init() {
  try {
    const response = await fetch(`/lineups/${__FESTIVAL_YEAR__}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load lineup: ${response.status}`);
    }
    const data = await response.json();
    renderLineup(data);
  } catch (err) {
    showError(err.message);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
