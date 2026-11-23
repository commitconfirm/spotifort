import { describe, it, expect } from 'vitest';
import festival from '../festival.config.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { realLineup } from './helpers/real-data.js';
import {
  TRACKS_PER_ARTIST, MAX_RELEASES, ADD_BATCH_SIZE, LEFT_OUT, PLAYLIST_DESCRIPTION,
  isSpotifyId, playlistPlan, planEstimate, songKey, isVersionTitle, chooseOwnTracks, newestReleases,
  playlistName, trackUri, buildTrackList, batches,
} from '../src/core/playlist.js';

const lineup = prepareLineup({
  year: 2030,
  artists: [
    { n: 1, name: 'Bully', spotifyIds: ['spBully'] },
    { n: 2, name: 'Duo', spotifyIds: ['spDuoA', 'spDuoB', 'spDuoA'] },
    { n: 3, name: 'Shaky', spotifyIds: ['spShaky'], unverified: true },
    { n: 4, name: 'No Spotify', spotifyIds: [] },
    { n: 5, name: 'Junk Ids', spotifyIds: ['bad id', '', 7, 'a/../b'] },
    { n: 6, name: 'Missing' },
    { n: 7, name: 'Fine', spotifyIds: ['spFine'] },
  ],
});

describe('constants', () => {
  it('has the agreed values', () => {
    expect([TRACKS_PER_ARTIST, MAX_RELEASES, ADD_BATCH_SIZE]).toEqual([3, 3, 100]);
    expect(LEFT_OUT).toEqual({ UNVERIFIED: 'unverified', NO_SPOTIFY: 'no-spotify', NO_TRACKS: 'no-tracks', QUOTA: 'quota', LOOKUP_FAILED: 'lookup-failed' });
    expect(Object.isFrozen(LEFT_OUT)).toBe(true);
    expect(PLAYLIST_DESCRIPTION).toBe('Made with spotifort.com. Not affiliated with Treefort Music Fest or Spotify.');
  });
});

describe('isSpotifyId', () => {
  it('accepts alphanumerics only', () => {
    expect(isSpotifyId('4Z8W4fKeB5YxbusRsdQVPb')).toBe(true);
    for (const v of ['', 'a b', 'a/b', 'a-b', '../x', 'é', null, undefined, 5, {}, ['a']]) expect(isSpotifyId(v)).toBe(false);
  });
});

describe('playlistPlan', () => {
  it('orders matches then recommendations, duplicates once, unknown n ignored', () => {
    const plan = playlistPlan({ matches: [{ n: 7 }, { n: 1 }], recommendations: [{ n: 1 }, { n: 99 }, { n: 2 }] }, lineup);
    expect(plan.artists.map((a) => a.n)).toEqual([7, 1, 2]);
    expect(plan.leftOut).toEqual([]);
  });
  it('de-duplicates ids and takes names from the lineup', () => {
    const plan = playlistPlan({ matches: [{ n: 2, name: 'Other' }], recommendations: [] }, lineup);
    expect(plan.artists).toEqual([{ n: 2, name: 'Duo', spotifyIds: ['spDuoA', 'spDuoB'] }]);
  });
  it('leaves out unverified (even with an id) and no-Spotify artists, in pick order', () => {
    const plan = playlistPlan({ matches: [{ n: 3 }, { n: 7 }], recommendations: [{ n: 4 }, { n: 5 }, { n: 6 }] }, lineup);
    expect(plan.artists.map((a) => a.n)).toEqual([7]);
    expect(plan.leftOut).toEqual([
      { n: 3, name: 'Shaky', reason: 'unverified' },
      { n: 4, name: 'No Spotify', reason: 'no-spotify' },
      { n: 5, name: 'Junk Ids', reason: 'no-spotify' },
      { n: 6, name: 'Missing', reason: 'no-spotify' },
    ]);
  });
  it('filters junk ids but keeps valid ones', () => {
    const l = prepareLineup({ artists: [{ n: 1, name: 'A', spotifyIds: ['bad id', 'good1', null] }] });
    expect(playlistPlan({ matches: [{ n: 1 }] }, l).artists[0].spotifyIds).toEqual(['good1']);
  });
  it('tolerates junk results', () => {
    for (const r of [undefined, null, {}, { matches: 'x', recommendations: 5 }, { matches: [null, {}, { n: 'x' }] }]) {
      expect(playlistPlan(r, lineup)).toEqual({ artists: [], leftOut: [] });
    }
  });
});

describe('planEstimate', () => {
  it('counts artists and tracks', () => {
    expect(planEstimate({ artists: [{}, {}, {}, {}] })).toEqual({ artists: 4, tracks: 12 });
    expect(planEstimate({ artists: [] })).toEqual({ artists: 0, tracks: 0 });
  });
});

describe('songKey / isVersionTitle', () => {
  it('collapses versions of one song', () => {
    const key = songKey('Motion Sickness');
    for (const t of ['Motion Sickness - Demo', 'MOTION SICKNESS (Acoustic)', 'Motion Sickness [Sped Up]', 'Motion Sickness (feat. Someone)',
      'Motion Sickness - 2023 Remaster', 'motion sickness \u2013 Live', 'Motion Sickness (Live) - Demo', 'Motion Sickness (Live (Acoustic))']) {
      expect(songKey(t)).toBe(key);
    }
  });
  it('keeps titles without a version word distinct', () => {
    const key = songKey('Song');
    for (const t of ['Song (Part 2)', 'Song, Pt. 2', 'Song - Interlude']) expect(songKey(t)).not.toBe(key);
  });
  it('does not match version words inside other words', () => {
    expect(songKey('Livewire')).toBe('livewire');
    expect(songKey('Song (Withering)')).not.toBe(songKey('Song'));
  });
  it('never returns an empty key for a title that is all decoration', () => {
    expect(songKey('(Live)')).not.toBe('');
    expect(songKey('(Live)')).toBe('live');
  });
  it('handles non-strings', () => {
    expect(songKey(undefined)).toBe('');
    expect(songKey(42)).toBe('');
    expect(isVersionTitle(null)).toBe(false);
  });
  it('flags version titles', () => {
    expect(isVersionTitle('Song')).toBe(false);
    expect(isVersionTitle('Song (Part 2)')).toBe(false);
    expect(isVersionTitle('Song - Demo')).toBe(true);
    expect(isVersionTitle('Song (feat. X)')).toBe(true);
  });
  it('is quick on hostile titles', () => {
    const t0 = Date.now();
    for (const s of ['('.repeat(100000), ' - '.repeat(33334), '['.repeat(100000), ('(a ' + 'live ').repeat(20000)]) songKey(s);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

const tr = (id, name, artistIds = ['spBully'], extra = {}) => ({ id, name, artists: artistIds.map((i) => ({ id: i, name: i })), ...extra });

describe('chooseOwnTracks', () => {
  it('takes the first distinct songs up to the limit', () => {
    const c = [tr('t1', 'A'), tr('t2', 'B'), tr('t3', 'C'), tr('t4', 'D')];
    expect(chooseOwnTracks(c, ['spBully'])).toEqual([{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }, { id: 't3', name: 'C' }]);
  });
  it('returns only { id, name }', () => {
    expect(chooseOwnTracks([tr('t1', 'A', ['spBully'], { popularity: 9, uri: 'x' })], ['spBully'])).toEqual([{ id: 't1', name: 'A' }]);
  });
  it('drops another artist with the same name but a different id', () => {
    const c = [tr('x1', 'Imposter Hit', ['spOther']), tr('t1', 'Real', ['spBully']), tr('x2', 'Other 2', ['spOther'])];
    expect(chooseOwnTracks(c, ['spBully'])).toEqual([{ id: 't1', name: 'Real' }]);
  });
  it('ranks tracks where the artist is listed second after listed-first ones, but still uses them', () => {
    const c = [tr('f1', 'Feature', ['spOther', 'spBully']), tr('a1', 'Own 1'), tr('a2', 'Own 2'), tr('a3', 'Own 3')];
    expect(chooseOwnTracks(c, ['spBully']).map((t) => t.id)).toEqual(['a1', 'a2', 'a3']);
    expect(chooseOwnTracks(c.slice(0, 3), ['spBully']).map((t) => t.id)).toEqual(['a1', 'a2', 'f1']);
  });
  it('collapses versions, preferring listed-first then the plain title', () => {
    const c = [
      tr('s1', 'Song - Acoustic'),
      tr('s2', 'SONG'),
      tr('s3', 'Song', ['spOther', 'spBully']),
      tr('s4', 'Song (Live)', ['spOther', 'spBully']),
      tr('o1', 'Other'),
    ];
    // listed-first group "song": s1 (version) and s2 (plain) are listed first; plain wins
    expect(chooseOwnTracks(c, ['spBully'])).toEqual([{ id: 's2', name: 'SONG' }, { id: 'o1', name: 'Other' }]);
    // a plain listed-second title loses to a listed-first version
    expect(chooseOwnTracks([tr('a', 'Song', ['spOther', 'spBully']), tr('b', 'Song (Demo)')], ['spBully'])).toEqual([{ id: 'b', name: 'Song (Demo)' }]);
    // same listing, plain beats version, then earliest
    expect(chooseOwnTracks([tr('a', 'Song (Demo)'), tr('b', 'Song'), tr('c', 'Song')], ['spBully'])).toEqual([{ id: 'b', name: 'Song' }]);
  });
  it('orders groups with a listed-first track before others', () => {
    const c = [tr('f', 'Feat Only', ['spOther', 'spBully']), tr('a', 'Alpha')];
    expect(chooseOwnTracks(c, ['spBully']).map((t) => t.id)).toEqual(['a', 'f']);
  });
  it('treats any of several Spotify ids as the artist', () => {
    const c = [tr('t1', 'A', ['spDuoB']), tr('t2', 'B', ['spDuoA']), tr('t3', 'C', ['spDuoA', 'spDuoB'])];
    expect(chooseOwnTracks(c, ['spDuoA', 'spDuoB']).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(chooseOwnTracks(c, ['spDuoB']).map((t) => t.id)).toEqual(['t1', 't3']);
  });
  it('fills after `already` without repeating by id or song key', () => {
    const already = [{ id: 't1', name: 'Song' }];
    const c = [tr('t1', 'Song'), tr('t9', 'Song (Acoustic)'), tr('t2', 'Two'), tr('t3', 'Three'), tr('t4', 'Four')];
    expect(chooseOwnTracks(c, ['spBully'], { already })).toEqual([{ id: 't1', name: 'Song' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }]);
  });
  it('respects the limit, including when `already` is full', () => {
    const already = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    expect(chooseOwnTracks([tr('t', 'T')], ['spBully'], { already })).toEqual(already);
    expect(chooseOwnTracks([tr('t', 'T')], ['spBully'], { already, limit: 2 })).toEqual(already.slice(0, 2));
    expect(chooseOwnTracks([tr('t1', 'T1'), tr('t2', 'T2')], ['spBully'], { limit: 1 })).toEqual([{ id: 't1', name: 'T1' }]);
  });
  it('ends with fewer than the limit when there are fewer songs', () => {
    expect(chooseOwnTracks([tr('t1', 'A'), tr('t2', 'B')], ['spBully'])).toHaveLength(2);
    expect(chooseOwnTracks([tr('t1', 'A'), tr('t2', 'A (Live)')], ['spBully'], { already: [{ id: 'z', name: 'Z' }] })).toHaveLength(2);
    expect(chooseOwnTracks([], ['spBully'])).toEqual([]);
  });
  it('ignores malformed candidates and tolerates junk input', () => {
    const c = [null, 5, 'x', {}, { id: 'bad id', name: 'N', artists: [{ id: 'spBully' }] }, { id: 't0', name: 5, artists: [{ id: 'spBully' }] },
      { id: 't0', name: 'N', artists: 'spBully' }, { id: 't0', name: 'N' }, { id: 't0', name: 'N', artists: [null, { id: 'spBully' }] }, tr('t1', 'Good')];
    expect(chooseOwnTracks(c, ['spBully']).map((t) => t.id)).toEqual(['t1', 't0']);
    expect(chooseOwnTracks('nope', ['spBully'])).toEqual([]);
    expect(chooseOwnTracks([tr('t1', 'A')], null)).toEqual([]);
    expect(chooseOwnTracks([tr('t1', 'A')], ['spBully'], { already: null })).toHaveLength(1);
  });
  it('counts a repeated track id once', () => {
    expect(chooseOwnTracks([tr('t1', 'A'), tr('t1', 'A'), tr('t2', 'B')], ['spBully']).map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('newestReleases', () => {
  it('re-sorts a grouped-by-type list by date, with mixed precisions', () => {
    const albums = [
      { id: 'a1', name: 'Album 2019', release_date: '2019-05-01' },
      { id: 'a2', name: 'Album 2022', release_date: '2022' },
      { id: 's1', name: 'Single 2022-06', release_date: '2022-06' },
      { id: 's2', name: 'Single 2023', release_date: '2023-01-15' },
      { id: 's3', name: 'Single 2021', release_date: '2021-12-31' },
    ];
    expect(newestReleases(albums, 10).map((a) => a.id)).toEqual(['s2', 's1', 'a2', 's3', 'a1']);
    expect(newestReleases(albums)).toHaveLength(3);
    expect(newestReleases(albums)[0]).toEqual({ id: 's2', name: 'Single 2023', releaseDate: '2023-01-15' });
  });
  it('keeps ties in original order and puts bad dates last', () => {
    const albums = [
      { id: 'b1', release_date: 'nope' },
      { id: 'a1', name: 'A', release_date: '2020-01-01' },
      { id: 'a2', name: 'B', release_date: '2020-01-01' },
      { id: 'b2' },
      { id: 'a0', name: 'C', release_date: '2021' },
    ];
    expect(newestReleases(albums, 10).map((a) => a.id)).toEqual(['a0', 'a1', 'a2', 'b1', 'b2']);
    expect(newestReleases(albums, 10)[3]).toEqual({ id: 'b1', name: '', releaseDate: 'nope' });
    expect(newestReleases(albums, 10)[4]).toEqual({ id: 'b2', name: '', releaseDate: '' });
  });
  it('drops duplicates and junk', () => {
    const albums = [null, 4, {}, { id: 'bad id', release_date: '2024' }, { id: 'x1', release_date: '2020' }, { id: 'x1', release_date: '2025' }];
    expect(newestReleases(albums)).toEqual([{ id: 'x1', name: '', releaseDate: '2020' }]);
    expect(newestReleases('x')).toEqual([]);
    expect(newestReleases(undefined)).toEqual([]);
  });
});

describe('playlistName', () => {
  it('builds the name from the festival year and a local date', () => {
    expect(festival.year).toBe(2027);
    expect(playlistName(festival.year, new Date(2026, 10, 23))).toBe('Spotifort: Treefort 2027 \u00b7 Nov 23, 2026');
    expect(playlistName(2027, new Date(2027, 0, 5))).toBe('Spotifort: Treefort 2027 \u00b7 Jan 5, 2027');
  });
  it('drops the date when it is not a valid Date', () => {
    expect(playlistName(2027, new Date('nope'))).toBe('Spotifort: Treefort 2027');
    expect(playlistName(2027, undefined)).toBe('Spotifort: Treefort 2027');
    expect(playlistName(2027, '2026-11-23')).toBe('Spotifort: Treefort 2027');
  });
});

describe('trackUri', () => {
  it('builds a URI or null', () => {
    expect(trackUri('abc123')).toBe('spotify:track:abc123');
    expect(trackUri('a:b')).toBeNull();
    expect(trackUri('')).toBeNull();
    expect(trackUri(undefined)).toBeNull();
  });
});

describe('buildTrackList', () => {
  it('keeps order, removes a track shared by two artists and skips invalid ids', () => {
    const list = buildTrackList([
      { n: 1, tracks: [{ id: 'a' }, { id: 'shared' }, { id: 'b' }] },
      { n: 2, tracks: [{ id: 'shared' }, { id: 'bad id' }, { id: 'c' }, null] },
      { n: 3, tracks: [{ id: 'a' }] },
      null,
      { n: 4 },
    ]);
    expect(list).toEqual([
      { n: 1, uri: 'spotify:track:a' }, { n: 1, uri: 'spotify:track:shared' }, { n: 1, uri: 'spotify:track:b' },
      { n: 2, uri: 'spotify:track:c' },
    ]);
    expect(buildTrackList(undefined)).toEqual([]);
  });
});

describe('batches', () => {
  const sized = (n) => Array.from({ length: n }, (_, i) => i);
  it('cuts lists into at most 100', () => {
    expect(batches([])).toEqual([]);
    expect(batches(sized(100)).map((b) => b.length)).toEqual([100]);
    expect(batches(sized(101)).map((b) => b.length)).toEqual([100, 1]);
    expect(batches(sized(250)).map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches(sized(250)).flat()).toEqual(sized(250));
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe('real lineup', () => {
  it('plans every artist or leaves it out, never planning unverified or id-less ones', () => {
    const recommendations = realLineup.artists.map((a) => ({ n: a.n, name: a.name, score: 1 }));
    const plan = playlistPlan({ matches: [], recommendations }, realLineup);
    expect(plan.artists.length + plan.leftOut.length).toBe(realLineup.artists.length);
    for (const p of plan.artists) {
      expect(p.spotifyIds.length).toBeGreaterThan(0);
      expect(p.spotifyIds.every(isSpotifyId)).toBe(true);
      expect(realLineup.byN(p.n).unverified).not.toBe(true);
    }
    for (const l of plan.leftOut.filter((x) => x.reason === LEFT_OUT.UNVERIFIED)) expect(realLineup.byN(l.n).unverified).toBe(true);
  });
});
