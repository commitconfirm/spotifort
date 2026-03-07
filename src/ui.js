// DOM rendering and interaction

import { log } from './main.js';
import { setClientId, clearClientId } from './auth.js';

// Module-level state for expansion feature
let lineupArtists = [];

// Callback for when Client ID is set
let onClientIdSet = null;

/**
 * Set callback for when Client ID is saved
 * @param {Function} callback
 */
export function setOnClientIdSet(callback) {
  onClientIdSet = callback;
}

/**
 * Show the Client ID setup screen
 */
export function showSetup() {
  const main = document.querySelector('main');

  // Hide other sections
  const authSection = document.getElementById('auth-section');
  const resultsSection = document.getElementById('results-section');
  const loadingSection = document.getElementById('loading-section');

  if (authSection) authSection.classList.add('hidden');
  if (resultsSection) resultsSection.classList.add('hidden');
  if (loadingSection) loadingSection.remove();

  // Check if setup section already exists
  let setupSection = document.getElementById('setup-section');
  if (!setupSection) {
    setupSection = document.createElement('section');
    setupSection.id = 'setup-section';
    main.insertBefore(setupSection, main.firstChild);
  }
  setupSection.classList.remove('hidden');

  setupSection.innerHTML = `
    <h2>Setup Required</h2>
    <p class="setup-intro">
      Due to Spotify's API restrictions, each user needs their own Spotify Developer app.
      This takes about 2 minutes to set up.
    </p>

    <div class="setup-steps">
      <h3>Quick Setup</h3>
      <ol>
        <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">developer.spotify.com/dashboard</a></li>
        <li>Log in with your Spotify account (Premium required)</li>
        <li>Click <strong>Create app</strong></li>
        <li>Fill in:
          <ul>
            <li>App name: anything (e.g., "My Spotifort")</li>
            <li>App description: anything</li>
            <li>Redirect URI: <code>https://spotifort.com/callback</code></li>
          </ul>
        </li>
        <li>Check the Developer Terms checkbox and click <strong>Save</strong></li>
        <li>Click <strong>Settings</strong>, then copy your <strong>Client ID</strong></li>
      </ol>
      <p class="setup-link"><a href="/setup.html">View detailed guide with screenshots</a></p>
    </div>

    <div class="setup-input">
      <label for="client-id-input">Paste your Client ID:</label>
      <input type="text" id="client-id-input" placeholder="e.g., 1a2b3c4d5e6f7g8h9i0j" autocomplete="off" spellcheck="false">
      <button id="save-client-id-btn" type="button">Save & Continue</button>
    </div>

    <p class="setup-note">
      Your Client ID is stored in memory only and will be cleared when you close this tab.
      We never store it permanently or send it anywhere except to Spotify.
    </p>
  `;

  // Attach event handlers
  const input = document.getElementById('client-id-input');
  const saveBtn = document.getElementById('save-client-id-btn');

  saveBtn.addEventListener('click', () => handleSaveClientId(input.value));
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSaveClientId(input.value);
    }
  });

  log.info('Setup screen shown');
}

/**
 * Handle saving the Client ID
 * @param {string} clientId
 */
function handleSaveClientId(clientId) {
  const trimmed = clientId.trim();

  if (!trimmed) {
    showSetupError('Please enter a Client ID');
    return;
  }

  // Basic validation: Spotify Client IDs are 32 hex characters
  if (!/^[a-f0-9]{32}$/i.test(trimmed)) {
    showSetupError('Invalid Client ID format. It should be 32 characters (letters and numbers).');
    return;
  }

  // Save and proceed
  setClientId(trimmed);
  hideSetup();

  if (onClientIdSet) {
    onClientIdSet();
  }
}

/**
 * Show an error on the setup screen
 * @param {string} message
 */
function showSetupError(message) {
  const setupSection = document.getElementById('setup-section');
  if (!setupSection) return;

  // Remove existing error
  const existingError = setupSection.querySelector('.setup-error');
  if (existingError) existingError.remove();

  // Add new error
  const errorDiv = document.createElement('div');
  errorDiv.className = 'setup-error';
  errorDiv.textContent = message;

  const inputDiv = setupSection.querySelector('.setup-input');
  if (inputDiv) {
    inputDiv.appendChild(errorDiv);
  }
}

/**
 * Hide the setup screen
 */
function hideSetup() {
  const setupSection = document.getElementById('setup-section');
  if (setupSection) {
    setupSection.classList.add('hidden');
  }
}

/**
 * Handle "Change Client ID" click
 */
export function handleChangeClientId() {
  clearClientId();
  showSetup();
}

/**
 * Initialize UI with lineup data for genre-based expansion
 * @param {Array} lineup - Array of lineup artist objects with genres
 */
export function initUI(lineup) {
  lineupArtists = lineup;
  log.info('UI initialized with lineup data');
}

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

  // Attach click handlers for expansion
  attachExpansionHandlers();

  // Add lineup info below results
  let lineupInfo = document.querySelector('.lineup-info');
  if (!lineupInfo) {
    lineupInfo = document.createElement('div');
    lineupInfo.className = 'lineup-info';
    resultsSection.after(lineupInfo);
  }
  lineupInfo.innerHTML = `Lineup last updated: ${formatDate(lastUpdated)}`;

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
        const artistId = artist.spotifyId || '';
        const spotifyLink = artist.spotifyUrl
          ? `<a href="${escapeHtml(artist.spotifyUrl)}" target="_blank" rel="noopener noreferrer" class="artist-name-link">${escapeHtml(artist.name)}</a>`
          : `<span class="artist-name">${escapeHtml(artist.name)}</span>`;

        return `
          <li class="artist-item" data-artist-id="${escapeHtml(artistId)}">
            <div class="artist-row">
              <button class="artist-toggle" aria-expanded="false" aria-label="Show similar artists at Treefort">
                <span class="artist-marker">[+]</span>
              </button>
              ${spotifyLink}
            </div>
            <div class="artist-related hidden"></div>
          </li>`;
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
 * Attach click handlers to expansion toggles
 */
function attachExpansionHandlers() {
  const toggles = document.querySelectorAll('.artist-toggle');
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', handleToggleClick);
  });
}

/**
 * Handle click on artist expansion toggle
 * @param {Event} event - Click event
 */
function handleToggleClick(event) {
  const toggle = event.currentTarget;
  const listItem = toggle.closest('.artist-item');
  const artistId = listItem.dataset.artistId;
  const relatedDiv = listItem.querySelector('.artist-related');
  const marker = toggle.querySelector('.artist-marker');
  const isExpanded = toggle.getAttribute('aria-expanded') === 'true';

  if (isExpanded) {
    // Collapse
    toggle.setAttribute('aria-expanded', 'false');
    marker.textContent = '[+]';
    relatedDiv.classList.add('hidden');
    return;
  }

  // Expand
  toggle.setAttribute('aria-expanded', 'true');
  marker.textContent = '[-]';
  relatedDiv.classList.remove('hidden');

  // Find similar artists by genre
  const similarArtists = findSimilarArtistsByGenre(artistId);
  renderSimilarArtists(relatedDiv, similarArtists);
}

/**
 * Find lineup artists that share genres with the given artist
 * @param {string} artistId - Spotify artist ID
 * @returns {Array} - Array of { artist, sharedGenres, overlapCount }
 */
function findSimilarArtistsByGenre(artistId) {
  // Find the clicked artist in lineup
  const clickedArtist = lineupArtists.find(a => a.spotifyId === artistId);

  if (!clickedArtist || !clickedArtist.genres || clickedArtist.genres.length === 0) {
    return [];
  }

  const clickedGenres = new Set(clickedArtist.genres);
  const results = [];

  // Find other artists with overlapping genres
  for (const artist of lineupArtists) {
    // Skip the clicked artist itself
    if (artist.spotifyId === artistId) continue;

    // Skip artists without genres
    if (!artist.genres || artist.genres.length === 0) continue;

    // Find shared genres
    const sharedGenres = artist.genres.filter(g => clickedGenres.has(g));

    if (sharedGenres.length > 0) {
      results.push({
        artist,
        sharedGenres,
        overlapCount: sharedGenres.length,
      });
    }
  }

  // Sort by overlap count (most shared genres first), then alphabetically
  results.sort((a, b) => {
    if (b.overlapCount !== a.overlapCount) {
      return b.overlapCount - a.overlapCount;
    }
    return a.artist.name.localeCompare(b.artist.name);
  });

  // Cap at 10 results
  return results.slice(0, 10);
}

/**
 * Render similar artists list
 * @param {HTMLElement} container - Container element
 * @param {Array} similarArtists - Array of { artist, sharedGenres }
 */
function renderSimilarArtists(container, similarArtists) {
  if (similarArtists.length === 0) {
    container.innerHTML = '<p class="related-empty">No similar artists in the lineup</p>';
    return;
  }

  const items = similarArtists
    .map(({ artist, sharedGenres }) => {
      const genresText = sharedGenres.join(', ');
      const nameHtml = artist.spotifyUrl
        ? `<a href="${escapeHtml(artist.spotifyUrl)}" target="_blank" rel="noopener noreferrer" class="related-artist-link">${escapeHtml(artist.name)}</a>`
        : `<span>${escapeHtml(artist.name)}</span>`;

      return `<li>${nameHtml} <span class="shared-genres">(${escapeHtml(genresText)})</span></li>`;
    })
    .join('');

  container.innerHTML = `<ul class="related-list">${items}</ul>`;
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
