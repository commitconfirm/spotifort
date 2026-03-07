// DOM rendering and interaction

import { log } from './main.js';

/**
 * Show the loading state while fetching liked songs
 * @param {number} trackCount - Number of tracks fetched so far
 */
export function showLoading(trackCount = 0) {
  const main = document.querySelector('main');

  // Check if loading section already exists
  let loadingSection = document.getElementById('loading-section');

  if (!loadingSection) {
    // Hide auth section
    const authSection = document.getElementById('auth-section');
    if (authSection) {
      authSection.classList.add('hidden');
    }

    // Create loading section
    loadingSection = document.createElement('section');
    loadingSection.id = 'loading-section';
    main.insertBefore(loadingSection, main.firstChild);
  }

  loadingSection.innerHTML = `
    <h2>Scanning your library...</h2>
    <div class="track-count">${trackCount.toLocaleString()}</div>
    <p class="loading-status">tracks scanned</p>
  `;
}

/**
 * Show the results section with matched artists
 * @param {Array} matchedArtists - Array of matched artist objects
 * @param {string} lastUpdated - ISO date string of lineup last update
 */
export function showResults(matchedArtists, lastUpdated) {
  const main = document.querySelector('main');

  // Remove loading section if present
  const loadingSection = document.getElementById('loading-section');
  if (loadingSection) {
    loadingSection.remove();
  }

  // Hide auth section
  const authSection = document.getElementById('auth-section');
  if (authSection) {
    authSection.classList.add('hidden');
  }

  // Show results section
  let resultsSection = document.getElementById('results-section');
  if (!resultsSection) {
    resultsSection = document.createElement('section');
    resultsSection.id = 'results-section';
    main.appendChild(resultsSection);
  }
  resultsSection.classList.remove('hidden');

  // Render List A (matched artists)
  const listAHtml = renderListA(matchedArtists);

  // Render placeholder for List B (future feature)
  const listBHtml = `
    <div class="list-placeholder">
      <p>More recommendations coming soon</p>
    </div>
  `;

  resultsSection.innerHTML = listAHtml + listBHtml;

  // Add lineup info below results
  const lineupInfo = document.createElement('div');
  lineupInfo.className = 'lineup-info';
  lineupInfo.innerHTML = `Lineup last updated: ${formatDate(lastUpdated)}`;
  resultsSection.after(lineupInfo);

  log.info('Results rendered');
}

/**
 * Render List A: Artists You Like Playing Treefort
 * @param {Array} matchedArtists - Array of matched artist objects
 * @returns {string} - HTML string
 */
function renderListA(matchedArtists) {
  let artistListHtml;

  if (matchedArtists.length > 0) {
    const items = matchedArtists
      .map((artist) => {
        const link = artist.spotifyUrl
          ? `<a href="${artist.spotifyUrl}" target="_blank" rel="noopener noreferrer" class="artist-link">
              <span class="artist-marker">[+]</span>
              <span class="artist-name">${escapeHtml(artist.name)}</span>
            </a>`
          : `<span class="artist-link">
              <span class="artist-marker">[+]</span>
              <span class="artist-name">${escapeHtml(artist.name)}</span>
            </span>`;
        return `<li>${link}</li>`;
      })
      .join('');
    artistListHtml = `<ul class="artist-list">${items}</ul>`;
  } else {
    artistListHtml = `<p class="empty-state">No matches found in your liked songs.</p>`;
  }

  return `
    <div class="list-box">
      <h2>Artists You Like Playing Treefort</h2>
      ${artistListHtml}
    </div>
  `;
}

/**
 * Show the auth section (initial state)
 */
export function showAuth() {
  const authSection = document.getElementById('auth-section');
  const resultsSection = document.getElementById('results-section');
  const loadingSection = document.getElementById('loading-section');

  if (authSection) {
    authSection.classList.remove('hidden');
  }
  if (resultsSection) {
    resultsSection.classList.add('hidden');
  }
  if (loadingSection) {
    loadingSection.remove();
  }
}

/**
 * Show an error message
 * @param {string} message - Error message to display
 */
export function showError(message) {
  const main = document.querySelector('main');

  // Remove loading section if present
  const loadingSection = document.getElementById('loading-section');
  if (loadingSection) {
    loadingSection.remove();
  }

  // Show auth section with error
  const authSection = document.getElementById('auth-section');
  if (authSection) {
    authSection.classList.remove('hidden');

    // Remove any existing error
    const existingError = authSection.querySelector('.error-message');
    if (existingError) {
      existingError.remove();
    }

    // Add error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = 'color: #000; margin-top: 1rem; padding: 1rem; border: 2px solid #000; background: #fff;';
    errorDiv.textContent = `Error: ${message}`;
    authSection.appendChild(errorDiv);
  }
}

/**
 * Format ISO date string to readable format
 * @param {string} isoDate - ISO date string
 * @returns {string} - Formatted date
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
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
