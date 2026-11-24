// The login purpose round trip and the in-memory scopes. No DOM environment: the few browser globals auth.js touches
// (window.location/history, sessionStorage, document for the redirect anchor, fetch) are stubbed per test.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearAuth, completeAuth, getAccessToken, hasScopes, startAuth, LIBRARY_SCOPES, PLAYLIST_SCOPE } from '../src/auth.js';

const CLIENT = 'a'.repeat(32);

function stubBrowser({ search = '' } = {}) {
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const clicked = [];
  const document = {
    title: 't',
    body: { appendChild: () => {} },
    createElement: () => ({ click() { clicked.push(this.href); }, remove() {} }),
  };
  const replaceState = vi.fn();
  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { location: { search }, history: { replaceState } });
  return { store, clicked, replaceState };
}

const tokenFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

/** Start a login, then come back to /callback with the state Spotify returns. */
async function roundTrip(purpose, { tokenBody = { access_token: 'tok' }, returned } = {}) {
  const first = stubBrowser();
  await startAuth(CLIENT, purpose);
  const url = new URL(first.clicked[0]);
  const state = url.searchParams.get('state');
  const saved = new Map(first.store);
  const back = stubBrowser({ search: `?code=c&state=${encodeURIComponent(returned ?? state)}` });
  for (const [k, v] of saved) back.store.set(k, v);
  vi.stubGlobal('fetch', tokenFetch(tokenBody));
  return { url, state, back, result: completeAuth(CLIENT) };
}

afterEach(() => {
  clearAuth();
  vi.unstubAllGlobals();
});

describe('startAuth', () => {
  it('asks for the read-only library scopes by default, and carries the purpose in state', async () => {
    const { clicked } = stubBrowser();
    await startAuth(CLIENT);
    const url = new URL(clicked[0]);
    expect(url.searchParams.get('scope')).toBe(LIBRARY_SCOPES);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9._~-]{32}\.library$/);
  });
  it('asks only for playlist-modify-private for a playlist', async () => {
    const { clicked } = stubBrowser();
    await startAuth(CLIENT, 'playlist');
    const url = new URL(clicked[0]);
    expect(url.searchParams.get('scope')).toBe(PLAYLIST_SCOPE);
    expect(url.searchParams.get('state').endsWith('.playlist')).toBe(true);
  });
  it('throws on an unknown purpose before storing anything', async () => {
    const { store, clicked } = stubBrowser();
    await expect(startAuth(CLIENT, 'admin')).rejects.toThrow(/purpose/);
    expect(store.size).toBe(0);
    expect(clicked).toEqual([]);
  });
});

describe('completeAuth', () => {
  it('returns the purpose of a playlist login and records the scopes Spotify granted', async () => {
    const { result } = await roundTrip('playlist', { tokenBody: { access_token: 'tok', scope: 'playlist-modify-private' } });
    expect(await result).toEqual({ token: 'tok', purpose: 'playlist' });
    expect(getAccessToken()).toBe('tok');
    expect(hasScopes(PLAYLIST_SCOPE)).toBe(true);
    expect(hasScopes('user-library-read')).toBe(false);
  });
  it('falls back to the requested scopes when Spotify does not list them', async () => {
    const { result } = await roundTrip('library', { tokenBody: { access_token: 'tok', scope: '  ' } });
    expect(await result).toEqual({ token: 'tok', purpose: 'library' });
    expect(hasScopes(LIBRARY_SCOPES)).toBe(true);
    expect(hasScopes(PLAYLIST_SCOPE)).toBe(false);
  });
  it('a mismatched state is rejected with the stored purpose, and nothing is granted', async () => {
    const { result } = await roundTrip('playlist', { returned: 'forged.playlist' });
    await expect(result).rejects.toMatchObject({ purpose: 'playlist', message: 'The login could not be verified. Please connect again from this page.' });
    expect(getAccessToken()).toBeNull();
    expect(hasScopes(PLAYLIST_SCOPE)).toBe(false);
  });
  it('access_denied words the message by the stored purpose', async () => {
    for (const [purpose, message] of [
      ['playlist', 'Spotify access was not allowed, so no playlist was made.'],
      ['library', 'Spotify access was not allowed, so nothing was imported.'],
    ]) {
      const first = stubBrowser();
      await startAuth(CLIENT, purpose);
      const saved = new Map(first.store);
      const back = stubBrowser({ search: '?error=access_denied' });
      for (const [k, v] of saved) back.store.set(k, v);
      await expect(completeAuth(CLIENT)).rejects.toMatchObject({ purpose, message });
      expect(back.replaceState).toHaveBeenCalledWith(null, 't', '/');
    }
  });
  it('an error with no stored state carries purpose null; an old-format state counts as a library login', async () => {
    stubBrowser({ search: '?error=access_denied' });
    await expect(completeAuth(CLIENT)).rejects.toMatchObject({ purpose: null, message: 'Spotify access was not allowed, so nothing was imported.' });
    const back = stubBrowser({ search: '?error=access_denied' });
    back.store.set('spotifort_oauth_state', 'OLDSTATEwithoutpurpose0123456789');
    await expect(completeAuth(CLIENT)).rejects.toMatchObject({ purpose: 'library' });
  });
  it('returns null when this is not a callback', async () => {
    stubBrowser();
    expect(await completeAuth(CLIENT)).toBeNull();
  });
  it('clearAuth forgets the token and its scopes', async () => {
    const { result } = await roundTrip('playlist');
    await result;
    expect(hasScopes(PLAYLIST_SCOPE)).toBe(true);
    clearAuth();
    expect(hasScopes(PLAYLIST_SCOPE)).toBe(false);
    expect(hasScopes('')).toBe(false);
  });
});
