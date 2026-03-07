// Spotify PKCE Auth Flow
// Access token lives in memory only — never persisted to storage
// Code verifier is temporarily stored in sessionStorage during auth flow only

import { log } from './main.js';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.DEV
  ? 'http://127.0.0.1:9090/callback'
  : 'https://spotifort.com/callback';
const SCOPES = 'user-library-read';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const VERIFIER_KEY = 'spotifort_pkce_verifier';

// In-memory storage for access token (never persisted)
let accessToken = null;

/**
 * Generate a cryptographically random string for PKCE code verifier
 * @param {number} length - Length of the string (43-128 per spec)
 * @returns {string} - Random string
 */
function generateRandomString(length = 64) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((x) => possible[x % possible.length])
    .join('');
}

/**
 * Generate SHA-256 hash of the code verifier
 * @param {string} plain - The code verifier string
 * @returns {Promise<ArrayBuffer>} - SHA-256 hash
 */
async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

/**
 * Base64url encode an ArrayBuffer (no padding, URL-safe)
 * @param {ArrayBuffer} buffer - The buffer to encode
 * @returns {string} - Base64url encoded string
 */
function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate PKCE code challenge from verifier
 * @param {string} verifier - The code verifier
 * @returns {Promise<string>} - Base64url encoded SHA-256 hash
 */
async function generateCodeChallenge(verifier) {
  const hash = await sha256(verifier);
  return base64urlEncode(hash);
}

/**
 * Initiate Spotify OAuth flow with PKCE
 * Redirects the user to Spotify's authorization page
 */
export async function initiateAuth() {
  if (!CLIENT_ID) {
    log.error('VITE_SPOTIFY_CLIENT_ID is not set. Create .env.local with your Spotify Client ID.');
    throw new Error('Missing Spotify Client ID');
  }

  log.info('Initiating Spotify auth flow');

  // Generate code verifier and store temporarily in sessionStorage
  // (needed to survive the redirect back from Spotify)
  const codeVerifier = generateRandomString(64);
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  log.info('Generated code verifier');

  // Generate code challenge
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  log.info('Generated code challenge');

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  log.info('Redirecting to Spotify auth');

  // Redirect to Spotify
  window.location.href = authUrl;
}

/**
 * Handle the OAuth callback and exchange code for access token
 * @returns {Promise<string|null>} - Access token or null if not on callback page
 */
export async function handleCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  // Not on callback page
  if (!code && !error) {
    return null;
  }

  // Handle error from Spotify
  if (error) {
    log.error('Spotify auth error:', error);
    // Clean up URL
    window.history.replaceState({}, document.title, '/');
    throw new Error(`Spotify authorization failed: ${error}`);
  }

  log.info('Received auth code, exchanging for token');

  // Retrieve code verifier from sessionStorage
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY); // Clean up immediately

  if (!codeVerifier) {
    log.warn('Code verifier not found — auth flow interrupted');
    window.history.replaceState({}, document.title, '/');
    return null;
  }

  try {
    // Exchange code for access token
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      log.error('Token exchange failed:', errorData);
      throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
    }

    const data = await response.json();
    accessToken = data.access_token;

    log.info('Successfully obtained access token');
    log.info('Token type:', data.token_type);
    log.info('Expires in:', data.expires_in, 'seconds');
    log.info('Access token:', accessToken);

    // Clean up URL (remove code from URL bar)
    window.history.replaceState({}, document.title, '/');

    return accessToken;
  } catch (err) {
    log.error('Failed to exchange code for token:', err);
    window.history.replaceState({}, document.title, '/');
    throw err;
  }
}

/**
 * Get the current access token
 * @returns {string|null} - Access token or null if not authenticated
 */
export function getAccessToken() {
  return accessToken;
}

/**
 * Check if the user is authenticated
 * @returns {boolean} - True if access token exists
 */
export function isAuthenticated() {
  return accessToken !== null;
}

/**
 * Clear the access token (logout)
 */
export function clearAuth() {
  accessToken = null;
  sessionStorage.removeItem(VERIFIER_KEY);
  log.info('Auth cleared');
}
