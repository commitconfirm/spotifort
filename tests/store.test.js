import { describe, it, expect } from 'vitest';
import { createStore, isValidClientId, POOL_KEY, CLIENT_ID_KEY } from '../src/store.js';
import { emptyPool, addTyped } from '../src/core/pool.js';
import * as storeModule from '../src/store.js';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const memStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)), removeItem: (k) => void delete data[k] };
};
const throwing = () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } });

describe('client id', () => {
  it('validates 32 hex characters', () => {
    expect(isValidClientId(ID)).toBe(true);
    expect(isValidClientId(ID.toUpperCase())).toBe(true);
    for (const bad of [ID + 'a', ID.slice(1), 'g'.repeat(32), '', null, undefined, 5, `${ID}\n`]) expect(isValidClientId(bad)).toBe(false);
  });
  it('remember=true writes to localStorage only; remember=false to sessionStorage only', () => {
    const local = memStorage(), session = memStorage();
    const s = createStore({ local, session });
    expect(s.saveClientId(ID, { remember: true })).toBe(true);
    expect(local.data[CLIENT_ID_KEY]).toBe(ID);
    expect(session.data[CLIENT_ID_KEY]).toBeUndefined();
    s.saveClientId(ID, { remember: false });
    expect(local.data[CLIENT_ID_KEY]).toBeUndefined();
    expect(session.data[CLIENT_ID_KEY]).toBe(ID);
    expect(s.loadClientId()).toBe(ID);
    s.saveClientId(ID, { remember: true });
    expect(session.data[CLIENT_ID_KEY]).toBeUndefined();
  });
  it('refuses to store an invalid id', () => {
    const local = memStorage(), session = memStorage();
    const s = createStore({ local, session });
    expect(s.saveClientId('not-an-id', { remember: true })).toBe(false);
    expect(local.data).toEqual({});
    expect(session.data).toEqual({});
  });
  it('re-validates on every read and discards bad values', () => {
    const local = memStorage({ [CLIENT_ID_KEY]: '<script>' }), session = memStorage({ [CLIENT_ID_KEY]: ID });
    const s = createStore({ local, session });
    expect(s.loadClientId()).toBe(ID);
    expect(local.data[CLIENT_ID_KEY]).toBeUndefined();
    expect(createStore({ local: memStorage({ [CLIENT_ID_KEY]: 'zzz' }), session: memStorage() }).loadClientId()).toBeNull();
  });
  it('keeps the id in memory when storage throws or is missing', () => {
    for (const make of [() => ({ local: throwing(), session: throwing() }), () => ({ local: null, session: null }), () => ({ local: throwing(), session: memStorage() })]) {
      const s = createStore(make());
      expect(() => s.saveClientId(ID, { remember: true })).not.toThrow();
      expect(s.loadClientId()).toBe(ID);
      s.forgetAll();
      expect(s.loadClientId()).toBeNull();
    }
  });
});

describe('pool', () => {
  it('saves and loads through pool serialisation', () => {
    const local = memStorage();
    const s = createStore({ local, session: memStorage() });
    const pool = addTyped(emptyPool(), 'Wilco');
    s.savePool(pool);
    expect(JSON.parse(local.data[POOL_KEY]).v).toBe(1);
    expect(createStore({ local, session: memStorage() }).loadPool()).toEqual(pool);
  });
  it('loads an empty pool when nothing is stored or the data is corrupt', () => {
    expect(createStore({ local: memStorage(), session: memStorage() }).loadPool()).toEqual(emptyPool());
    expect(createStore({ local: memStorage({ [POOL_KEY]: '{{{' }), session: memStorage() }).loadPool()).toEqual(emptyPool());
  });
  it('degrades to memory when storage fails', () => {
    for (const local of [throwing(), null]) {
      const s = createStore({ local, session: null });
      const pool = addTyped(emptyPool(), 'Wilco');
      expect(() => s.savePool(pool)).not.toThrow();
      expect(s.loadPool()).toEqual(pool);
      s.forgetAll();
      expect(s.loadPool()).toEqual(emptyPool());
    }
  });
});

describe('forgetAll', () => {
  it('clears both keys from both storages', () => {
    const local = memStorage({ [POOL_KEY]: 'x', [CLIENT_ID_KEY]: ID, other: 'keep' });
    const session = memStorage({ [POOL_KEY]: 'x', [CLIENT_ID_KEY]: ID });
    createStore({ local, session }).forgetAll();
    expect(local.data).toEqual({ other: 'keep' });
    expect(session.data).toEqual({});
  });
  it('does not throw on throwing storage', () => {
    expect(() => createStore({ local: throwing(), session: throwing() }).forgetAll()).not.toThrow();
  });
});

describe('surface', () => {
  it('has no generic setter and nowhere to put a token', () => {
    expect(Object.keys(storeModule).sort()).toEqual(['CLIENT_ID_KEY', 'POOL_KEY', 'createStore', 'isValidClientId']);
    const s = createStore({ local: memStorage(), session: memStorage() });
    expect(Object.keys(s).sort()).toEqual(['forgetAll', 'loadClientId', 'loadPool', 'saveClientId', 'savePool']);
  });
  it('falls back safely with no injected storages and no browser globals', () => {
    const s = createStore();
    expect(() => { s.saveClientId(ID); s.savePool(emptyPool()); s.loadPool(); s.loadClientId(); s.forgetAll(); }).not.toThrow();
  });
});
