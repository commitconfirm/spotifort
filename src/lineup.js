// Lineup page — displays full Treefort lineup data

/**
 * Format ISO date string to readable format
 */
function formatDate(isoDate) {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  const onSpotify = data.artists.filter(a => !a.notOnSpotify && a.spotifyId);
  const notOnSpotify = data.artists.filter(a => a.notOnSpotify || !a.spotifyId);

  // Build HTML
  let html = '<div class="lineup-grid">';

  // Artists on Spotify
  html += `
    <div class="list-box">
      <h2>Artists on Spotify (${onSpotify.length})</h2>
      <ul class="artist-list">
  `;

  for (const artist of onSpotify) {
    const link = artist.spotifyUrl
      ? `<a href="${escapeHtml(artist.spotifyUrl)}" target="_blank" rel="noopener noreferrer" class="artist-link">
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

  // Artists not on Spotify
  html += `
    <div class="list-box">
      <h2>Artists Not Found on Spotify (${notOnSpotify.length})</h2>
  `;

  if (notOnSpotify.length > 0) {
    html += '<ul class="artist-list">';
    for (const artist of notOnSpotify) {
      html += `
        <li>
          <span class="artist-link">
            <span class="artist-marker">[-]</span>
            <span class="artist-name">${escapeHtml(artist.name)}</span>
          </span>
        </li>
      `;
    }
    html += '</ul>';
  } else {
    html += '<p class="empty-state">All artists were found on Spotify.</p>';
  }

  html += `
    </div>
  `;

  html += '</div>';

  content.innerHTML = html;
}

/**
 * Show error message
 */
function showError(message) {
  const content = document.getElementById('lineup-content');
  content.innerHTML = `
    <div class="list-box" style="text-align: center;">
      <p style="color: #000;">Error: ${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Initialize the page
 */
async function init() {
  try {
    const response = await fetch('/lineup.json');
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
