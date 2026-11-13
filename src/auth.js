// Spotify Authorization Code with PKCE (no client secret).
// The access token lives in this module's memory only and is never written to any storage. The PKCE code verifier
// and the OAuth `state` are kept in sessionStorage (this tab only) so they survive the redirect to Spotify and back.
// The Client ID is not stored here: src/store.js is the one place that persists it, and callers pass it in.

import { log } from './log.js';
import { statesMatch } from './utils.js';

export const SCOPES = 'user-library-read user-top-read user-follow-read';
const REDIRECT_URI = import.meta.env.DEV ? 'http://127.0.0.1:9090/callback' : 'https://spotifort.com/callback';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const VERIFIER_KEY = 'spotifort_pkce_verifier';
const STATE_KEY = 'spotifort_oauth_state';

let accessToken = null;

/** Thrown when the browser cannot do the PKCE hashing (some in-app browsers). */
export class CryptoNotSupportedError extends Error {
  constructor() {
    super('Please open this site directly in Safari or Chrome. In-app browsers (iMessage, Instagram, etc.) are not supported.');
    this.name = 'CryptoNotSupportedError';
  }
}

/** @returns {boolean} true when this browser can run the PKCE flow */
export function cryptoAvailable() {
  try {
    return Boolean(globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle?.digest);
  } catch {
    return false;
  }
}

/**
 * Cryptographically random string of URL-safe characters (RFC 7636).
 * @param {number} length
 * @returns {string}
 */
function generateRandomString(length = 64) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  let result = '';
  for (let i = 0; i < length; i++) result += possible.charAt(randomValues[i] % possible.length);
  return result;
}

/**
 * SHA-256 of an ASCII string. Bytes are built by hand and the buffer passed explicitly for older Safari.
 * @param {string} plain
 * @returns {Promise<ArrayBuffer>}
 */
async function sha256(plain) {
  if (!cryptoAvailable()) throw new CryptoNotSupportedError();
  try {
    const bytes = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i++) bytes[i] = plain.charCodeAt(i) & 0xff;
    return await crypto.subtle.digest('SHA-256', bytes.buffer);
  } catch (err) {
    log.error('SHA-256 failed:', err.message);
    throw new CryptoNotSupportedError();
  }
}

/**
 * Base64url without padding (RFC 4648 section 5); manual for Safari compatibility.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += alphabet.charAt(b0 >> 2) + alphabet.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    if (i + 1 < bytes.length) result += alphabet.charAt(((b1 & 0x0f) << 2) | (b2 >> 6));
    if (i + 2 < bytes.length) result += alphabet.charAt(b2 & 0x3f);
  }
  return result;
}

/**
 * Start the login: store verifier and state for this tab, then send the browser to Spotify.
 * @param {string} clientId a valid Client ID (the caller validates and stores it first)
 */
export async function startAuth(clientId) {
  if (!clientId) throw new Error('Missing Spotify Client ID');
  log.info('Starting Spotify login');
  const codeVerifier = generateRandomString(64);
  const state = generateRandomString(32);
  const codeChallenge = base64urlEncode(await sha256(codeVerifier)); // throws before anything is stored on bad browsers
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
  });
  // An anchor click is the most reliable cross-browser redirect.
  const link = document.createElement('a');
  link.href = `${AUTH_URL}?${params}`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Finish the login on /callback: verify `state`, exchange the code for a token (kept in memory), and clean the URL.
 * @param {string|null} clientId the Client ID the login was started with
 * @returns {Promise<string|null>} the access token, or null when this is not a callback (or the login was interrupted)
 * @throws {Error} with a plain-language message
 */
export async function completeAuth(clientId) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const cleanUrl = () => window.history.replaceState(null, document.title, '/');
  if (!code && !error) return null;

  if (error) {
    log.error('Spotify auth error:', error);
    sessionStorage.removeItem(STATE_KEY);
    cleanUrl();
    throw new Error(error === 'access_denied' ? 'Spotify access was not allowed, so nothing was imported.' : 'Spotify could not complete the login. Please try again.');
  }

  // Verify state before touching the verifier: on a mismatch both stay, so a forged callback cannot break a login in progress.
  if (!statesMatch(sessionStorage.getItem(STATE_KEY), params.get('state'))) {
    log.error('OAuth state missing or mismatched — rejecting callback');
    cleanUrl();
    throw new Error('The login could not be verified. Please connect again from this page.');
  }
  sessionStorage.removeItem(STATE_KEY);

  if (!clientId) {
    cleanUrl();
    throw new Error('Your Client ID was lost during the login. Please enter it and connect again.');
  }
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!codeVerifier) {
    log.warn('Code verifier not found — login interrupted');
    cleanUrl();
    return null;
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: codeVerifier }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      log.error('Token exchange failed:', data.error, data.error_description);
      throw new Error('Spotify did not accept the login. Check that your Client ID and redirect URI match the setup guide, then try again.');
    }
    const data = await response.json();
    accessToken = typeof data.access_token === 'string' ? data.access_token : null;
    if (!accessToken) throw new Error('Spotify did not return an access token. Please try again.');
    log.info('Access token obtained; expires in', data.expires_in, 'seconds; scopes:', data.scope);
    return accessToken;
  } catch (err) {
    if (err instanceof TypeError) throw new Error('Could not reach Spotify. Check your connection and try again.', { cause: err });
    throw err;
  } finally {
    cleanUrl();
  }
}

/** @returns {string|null} the in-memory access token */
export function getAccessToken() {
  return accessToken;
}

/** Forget the token and any half-finished login in this tab. */
export function clearAuth() {
  accessToken = null;
  try {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // storage blocked: nothing to clear
  }
}
