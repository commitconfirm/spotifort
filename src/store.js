// Persistence: the artist pool and the Spotify Client ID, nothing else. There is deliberately no generic
// set(key, value): access and refresh tokens must never reach storage. Storage objects are injected so this runs
// (and is tested) without a browser. Every storage call is wrapped: a missing or throwing storage (private mode,
// blocked site data, quota) degrades to in-memory behaviour for this page load instead of breaking.
// localStorage only, never cookies. docs/ARCHITECTURE.md, "Persistence".

import { deserialise, emptyPool, serialise } from './core/pool.js';

export const POOL_KEY = 'spotifort:v1:pool';
export const CLIENT_ID_KEY = 'spotifort:v1:clientId';
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/i;

/**
 * @param {unknown} id
 * @returns {boolean} true for a 32-hex-character Spotify Client ID
 */
export function isValidClientId(id) {
  return typeof id === 'string' && CLIENT_ID_PATTERN.test(id);
}

/** Resolve a browser storage lazily; accessing it can itself throw (blocked site data). */
function browserStorage(name) {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null;
  }
}

/** Run a storage operation; any failure (or missing storage) is reported as `ok: false`. */
function attempt(storage, fn) {
  if (!storage) return { ok: false, value: null };
  try {
    return { ok: true, value: fn(storage) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * @param {{ local?: Storage|null, session?: Storage|null }} [storages] defaults to the browser's localStorage and sessionStorage
 */
export function createStore(storages = {}) {
  const local = 'local' in storages ? storages.local : browserStorage('localStorage');
  const session = 'session' in storages ? storages.session : browserStorage('sessionStorage');

  // In-memory copies, used only for a value that could not be written to storage.
  let memClientId = null;
  let memPool = null;

  const read = (storage, key) => attempt(storage, (s) => s.getItem(key));
  const write = (storage, key, value) => attempt(storage, (s) => (s.setItem(key, value), true)).ok;
  const remove = (storage, key) => attempt(storage, (s) => (s.removeItem(key), true)).ok;

  return {
    /**
     * Save the Client ID: localStorage when `remember`, otherwise sessionStorage (and removed from the other).
     * @param {string} id
     * @param {{ remember?: boolean }} [options]
     * @returns {boolean} false if the id is not a valid Client ID (nothing is stored)
     */
    saveClientId(id, { remember = false } = {}) {
      if (!isValidClientId(id)) return false;
      const [target, other] = remember ? [local, session] : [session, local];
      remove(other, CLIENT_ID_KEY);
      memClientId = write(target, CLIENT_ID_KEY, id) ? null : id;
      return true;
    },

    /** @returns {string|null} a valid stored Client ID; invalid stored values are discarded */
    loadClientId() {
      for (const storage of [local, session]) {
        const { ok, value } = read(storage, CLIENT_ID_KEY);
        if (!ok || value === null) continue;
        if (isValidClientId(value)) return value;
        remove(storage, CLIENT_ID_KEY);
      }
      return memClientId;
    },

    /**
     * Remember the pool (localStorage). Failure keeps it in memory for this page load.
     * @param {{ entries: object[] }} pool
     */
    savePool(pool) {
      const text = serialise(pool);
      memPool = write(local, POOL_KEY, text) ? null : text;
    },

    /** @returns {{ entries: object[] }} the stored pool, validated; empty if none or unreadable */
    loadPool() {
      const { ok, value } = read(local, POOL_KEY);
      if (ok && typeof value === 'string') return deserialise(value);
      return memPool ? deserialise(memPool) : emptyPool();
    },

    /** Clear the pool and the Client ID from both storages and memory. */
    forgetAll() {
      for (const storage of [local, session]) {
        remove(storage, POOL_KEY);
        remove(storage, CLIENT_ID_KEY);
      }
      memClientId = null;
      memPool = null;
    },
  };
}
