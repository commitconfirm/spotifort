import { describe, it, expect } from 'vitest';
import { prepareLineup } from '../src/core/lineup-index.js';
import { emptyPool, addTyped, addPicked, addBatch } from '../src/core/pool.js';
import { matchPool } from '../src/core/match.js';

const lineup = prepareLineup({
  year: 2030,
  artists: [
    { n: 1, name: 'Bully', spotifyIds: ['spBully'] },
    { n: 2, name: 'Duo & Friends', spotifyIds: ['spDuoA', 'spDuoB'], ids: { tidal: 'td2' } },
    { n: 3, name: 'Shaky Match', spotifyIds: ['spShaky'], unverified: true },
    { n: 4, name: 'No Spotify', spotifyIds: [] },
  ],
});

describe('matchPool', () => {
  it('matches by Spotify id (confirmed) even when the names differ', () => {
    const pool = addBatch(emptyPool(), 'spotify:liked', [{ name: 'BULLY (US)', ids: { spotify: 'spBully' }, weight: 1 }]);
    const [m] = matchPool(pool, lineup);
    expect(m).toMatchObject({ n: 1, confirmed: true, unverified: false });
    expect(m.entries).toEqual([{ key: 'bully us', name: 'BULLY (US)', via: 'id' }]);
  });
  it('matches on any of the lineup artist Spotify ids', () => {
    const pool = addBatch(emptyPool(), 's', [{ name: 'Member B', ids: { spotify: 'spDuoB' }, weight: 1 }]);
    expect(matchPool(pool, lineup).map((m) => m.n)).toEqual([2]);
  });
  it('matches by other platform ids', () => {
    // platform ids travel in the pool entry ids
    const pool = addBatch(emptyPool(), 's', [{ name: 'Whatever', ids: { tidal: 'td2' }, weight: 1 }]);
    expect(matchPool(pool, lineup)[0]).toMatchObject({ n: 2, confirmed: true });
  });
  it('matches picked lineup artists by n, confirmed', () => {
    const pool = addPicked(emptyPool(), { n: 4, name: 'No Spotify' });
    expect(matchPool(pool, lineup)[0]).toMatchObject({ n: 4, confirmed: true });
  });
  it('matches by normalised name, unconfirmed', () => {
    const pool = addTyped(emptyPool(), 'duo and friends');
    const [m] = matchPool(pool, lineup);
    expect(m).toMatchObject({ n: 2, confirmed: false });
    expect(m.entries[0].via).toBe('name');
  });
  it('falls back to the name when the id matches nobody', () => {
    const pool = addBatch(emptyPool(), 's', [{ name: 'Bully', ids: { spotify: 'someOtherBully' }, weight: 1 }]);
    expect(matchPool(pool, lineup)[0]).toMatchObject({ n: 1, confirmed: false });
  });
  it('is unconfirmed when the lineup record is unverified, even by id', () => {
    const pool = addBatch(emptyPool(), 's', [{ name: 'Shaky Match', ids: { spotify: 'spShaky' }, weight: 1 }]);
    expect(matchPool(pool, lineup)[0]).toMatchObject({ n: 3, confirmed: false, unverified: true });
  });
  it('gives one result per lineup artist, collecting every entry that produced it', () => {
    let pool = addBatch(emptyPool(), 's', [{ name: 'Member A', ids: { spotify: 'spDuoA' }, weight: 1 }, { name: 'Member B', ids: { spotify: 'spDuoB' }, weight: 1 }]);
    pool = addTyped(pool, 'Duo and Friends');
    const ms = matchPool(pool, lineup);
    expect(ms).toHaveLength(1);
    expect(ms[0].entries).toHaveLength(3);
    expect(ms[0].confirmed).toBe(true); // an id match outweighs the unconfirmed name match
  });
  it('returns results sorted by name and nothing for an unrelated pool', () => {
    let pool = addTyped(addTyped(emptyPool(), 'No Spotify'), 'Bully');
    expect(matchPool(pool, lineup).map((m) => m.name)).toEqual(['Bully', 'No Spotify']);
    expect(matchPool(addTyped(emptyPool(), 'Metallica'), lineup)).toEqual([]);
  });
});
