// Spotifort — Main Application Entry Point
// App initialization and orchestration

// Logging utility — verbose in dev, silent in prod (except errors)
export const log = {
  info: (...args) => import.meta.env.DEV && console.log('[spotifort]', ...args),
  warn: (...args) => import.meta.env.DEV && console.warn('[spotifort]', ...args),
  error: (...args) => console.error('[spotifort]', ...args),
};

// Import after log is defined (other modules depend on log)
import { initiateAuth, handleCallback, hasClientId } from './auth.js';
import { fetchLikedSongs, extractArtistIds } from './spotify.js';
import { loadLineup, matchArtists } from './matcher.js';
import { initUI, showLoading, showResults, showError, showSetup, setOnClientIdSet, showAuth, handleChangeClientId } from './ui.js';

/**
 * Initialize the application
 */
async function init() {
  // Check if we're returning from Spotify auth callback
  // Handle both /callback and /callback/ (with or without trailing slash)
  const pathname = window.location.pathname.replace(/\/$/, '');

  if (pathname === '/callback') {
    try {
      const token = await handleCallback();
      if (token) {
        await runMatching(token);
      } else {
        showError('Authentication failed. Please try again.');
      }
    } catch (err) {
      log.error('Callback error:', err.message);
      showError(err.message);
    }
    return;
  }

  // Set up callback for when Client ID is saved
  setOnClientIdSet(() => {
    showAuthSection();
  });

  // Set up "Change Client ID" link in footer
  const changeClientIdLink = document.getElementById('change-client-id');
  if (changeClientIdLink) {
    changeClientIdLink.addEventListener('click', (e) => {
      e.preventDefault();
      handleChangeClientId();
    });
  }

  // Check if Client ID is available
  if (!hasClientId()) {
    log.info('No Client ID available, showing setup');
    showSetup();
    return;
  }

  // Client ID available, show auth section
  showAuthSection();
}

/**
 * Show the auth section and set up Connect button
 */
function showAuthSection() {
  showAuth();

  // Set up Connect Spotify button
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    // Remove existing listeners by cloning
    const newBtn = connectBtn.cloneNode(true);
    connectBtn.parentNode.replaceChild(newBtn, connectBtn);
    newBtn.addEventListener('click', handleConnectClick);
    log.info('Connect button ready');
  }

  log.info('Spotifort ready');
}

/**
 * Handle click on Connect Spotify button
 */
async function handleConnectClick() {
  const connectBtn = document.getElementById('connect-btn');

  try {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    await initiateAuth();
  } catch (err) {
    log.error('Failed to initiate auth:', err.message);
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Spotify';
    showError(err.message);
  }
}

/**
 * Run the matching flow: fetch liked songs, extract artists, match against lineup
 * @param {string} accessToken - Spotify access token
 */
async function runMatching(accessToken) {
  try {
    // Show loading state with progress callback
    const onProgress = (trackCount) => {
      showLoading(trackCount);
    };

    // Fetch liked songs with progress updates
    const tracks = await fetchLikedSongs(accessToken, onProgress);

    // Extract unique artist IDs
    const userArtistIds = extractArtistIds(tracks);

    // Load Treefort lineup
    const lineup = await loadLineup();

    // Match against lineup
    const matched = matchArtists(userArtistIds, lineup.artists);

    // Log matched artists to console
    log.info('=== MATCHED ARTISTS ===');
    if (matched.length > 0) {
      matched.forEach((artist, i) => {
        log.info(`${i + 1}. ${artist.name}`);
      });
    } else {
      log.info('No matches found');
    }
    log.info('=======================');

    // Initialize UI with lineup data for genre-based expansion
    initUI(lineup.artists);

    // Show results in UI
    showResults(matched, lineup.lastUpdated);

  } catch (err) {
    log.error('Matching failed:', err.message);
    showError(err.message);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
