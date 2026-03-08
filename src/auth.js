// Spotify PKCE Auth Flow
// Access token lives in memory only — never persisted to storage
// Code verifier and Client ID are temporarily stored in sessionStorage during auth flow only

import { log } from './main.js';

// Environment variable Client ID (for dev builds)
const ENV_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

const REDIRECT_URI = import.meta.env.DEV
  ? 'http://127.0.0.1:9090/callback'
  : 'https://spotifort.com/callback';
const SCOPES = 'user-library-read';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const VERIFIER_KEY = 'spotifort_pkce_verifier';
const CLIENT_ID_KEY = 'spotifort_client_id';

// In-memory storage (never persisted beyond session)
let accessToken = null;
let userClientId = null;

/**
 * Check if a Client ID is available (either from env or user-provided)
 * @returns {boolean}
 */
export function hasClientId() {
  return !!(ENV_CLIENT_ID || userClientId || sessionStorage.getItem(CLIENT_ID_KEY));
}

/**
 * Get the current Client ID (env takes priority, then user-provided)
 * @returns {string|null}
 */
export function getClientId() {
  // Env variable takes priority (for dev builds)
  if (ENV_CLIENT_ID) {
    return ENV_CLIENT_ID;
  }
  // Then check in-memory user-provided value
  if (userClientId) {
    return userClientId;
  }
  // Finally check sessionStorage (survives redirect during auth flow)
  return sessionStorage.getItem(CLIENT_ID_KEY);
}

/**
 * Set the user-provided Client ID
 * @param {string} clientId - Spotify Client ID
 */
export function setClientId(clientId) {
  userClientId = clientId;
  // Also store in sessionStorage to survive the auth redirect
  sessionStorage.setItem(CLIENT_ID_KEY, clientId);
  log.info('Client ID set');
}

/**
 * Clear the user-provided Client ID
 */
export function clearClientId() {
  userClientId = null;
  sessionStorage.removeItem(CLIENT_ID_KEY);
  log.info('Client ID cleared');
}

/**
 * Check if using env Client ID vs user-provided
 * @returns {boolean} - True if using env variable
 */
export function isUsingEnvClientId() {
  return !!ENV_CLIENT_ID;
}

/**
 * Generate a cryptographically random string for PKCE code verifier
 * Uses only URL-safe characters as per RFC 7636
 * @param {number} length - Length of the string (43-128 per spec)
 * @returns {string} - Random string
 */
function generateRandomString(length = 64) {
  // URL-safe characters for PKCE (RFC 7636)
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  // Build string character by character (Safari-compatible)
  let result = '';
  for (let i = 0; i < length; i++) {
    result += possible.charAt(randomValues[i] % possible.length);
  }
  return result;
}

/**
 * Generate SHA-256 hash of the code verifier
 * @param {string} plain - The code verifier string
 * @returns {Promise<ArrayBuffer>} - SHA-256 hash
 */
async function sha256(plain) {
  // Check if crypto.subtle is available (not available in some in-app browsers)
  if (!crypto || !crypto.subtle || !crypto.subtle.digest) {
    throw new CryptoNotSupportedError();
  }

  try {
    // Convert string to Uint8Array manually for Safari compatibility
    const bytes = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i++) {
      bytes[i] = plain.charCodeAt(i) & 0xff;
    }

    // Safari may need explicit ArrayBuffer, so we pass bytes.buffer
    return await crypto.subtle.digest('SHA-256', bytes.buffer);
  } catch (err) {
    log.error('SHA-256 failed:', err.message);
    throw new CryptoNotSupportedError();
  }
}

/**
 * Custom error for unsupported crypto operations
 */
class CryptoNotSupportedError extends Error {
  constructor() {
    super('Please open this site directly in Safari or Chrome. In-app browsers (iMessage, Instagram, etc.) are not supported.');
    this.name = 'CryptoNotSupportedError';
  }
}

/**
 * Base64url encode an ArrayBuffer (no padding, URL-safe)
 * Manual implementation for Safari compatibility (avoids btoa edge cases)
 * @param {ArrayBuffer} buffer - The buffer to encode
 * @returns {string} - Base64url encoded string
 */
function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;

  // Base64url alphabet (RFC 4648 Section 5)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  let result = '';

  // Process 3 bytes at a time, producing 4 base64 characters
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    // First character: bits 7-2 of b0
    result += alphabet.charAt(b0 >> 2);

    // Second character: bits 1-0 of b0 + bits 7-4 of b1
    result += alphabet.charAt(((b0 & 0x03) << 4) | (b1 >> 4));

    // Third character: bits 3-0 of b1 + bits 7-6 of b2 (only if we have b1)
    if (i + 1 < len) {
      result += alphabet.charAt(((b1 & 0x0f) << 2) | (b2 >> 6));
    }

    // Fourth character: bits 5-0 of b2 (only if we have b2)
    if (i + 2 < len) {
      result += alphabet.charAt(b2 & 0x3f);
    }
  }

  // No padding for base64url (RFC 4648)
  return result;
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
  const clientId = getClientId();

  if (!clientId) {
    log.error('No Spotify Client ID available');
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
    client_id: clientId,
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

  // Get Client ID (from sessionStorage, survives the redirect)
  const clientId = getClientId();
  if (!clientId) {
    log.error('Client ID not found after redirect');
    window.history.replaceState({}, document.title, '/');
    throw new Error('Client ID lost during auth flow');
  }

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
        client_id: clientId,
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

    // Restore Client ID to memory from sessionStorage
    const storedClientId = sessionStorage.getItem(CLIENT_ID_KEY);
    if (storedClientId && !ENV_CLIENT_ID) {
      userClientId = storedClientId;
    }
    // Clean up sessionStorage (but keep Client ID for potential re-auth)
    // sessionStorage.removeItem(CLIENT_ID_KEY); // Keep it for re-auth

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
