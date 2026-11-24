import { describe, it, expect } from 'vitest';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { addBatch, addTyped, addPicked, emptyPool } from '../src/core/pool.js';
import { decodeShare } from '../src/core/share.js';
import {
  addByName, addSuggestion, computeResults, diagnostics, groupByBand, importSummaryText, joinNames, libraryChipText, libraryCount, listenFor, poolChips,
  reasonText, resolveName, sharePicks, shareUrl, sharedFromHash, signalLabel, similarFor, suggestions,
  useRelativeBands, validExamples, LARGE_POOL, RELATIVE_STRONG,
  playlistIntro, playlistProgressText, leftOutGroups, searchStopText, releasesStopText, playlistOutcome, playlistFailure,
  PLAYLIST_VISIBILITY_NOTE, beyondCapText,
} from '../src/app/state.js';

const lineup = prepareLineup({
  year: 2030,
  artists: [
    { n: 1, name: 'Alpha', spotifyIds: ['sp1'], links: { spotify: 'https://open.spotify.com/artist/sp1', tidal: 'https://tidal.com/artist/9' }, tags: ['rock'], similar: [[2, 0.6, 'direct'], [3, 0.3, 'tags']] },
    { n: 2, name: 'Beta', tags: ['rock'], similar: [[1, 0.6, 'neighbours']] },
    { n: 3, name: 'Gamma Ray', tags: [], similar: [], unverified: true },
  ],
});
const sim = prepareSimilarity({ minMatch: 0.1, names: ['Gamma Rays Tribute', 'Outsider'], edges: [[3, 40], [1, 50, 2, 20]] });

describe('resolveName / addByName', () => {
  it('resolves lineup names first, then the index, else unknown; pending without the index', () => {
    expect(resolveName('alpha', lineup, sim)).toMatchObject({ kind: 'lineup', artist: { n: 1 } });
    expect(resolveName('OUTSIDER', lineup, sim)).toEqual({ kind: 'outside', name: 'Outsider' });
    expect(resolveName('Metallica', lineup, sim)).toEqual({ kind: 'unknown' });
    expect(resolveName('Outsider', lineup, null)).toEqual({ kind: 'pending' });
    expect(resolveName('   ', lineup, sim)).toEqual({ kind: 'unknown' });
  });
  it('adds a lineup artist as a pick and an outside artist under its canonical name; never adds unknown names', () => {
    let r = addByName(emptyPool(), 'alpha', lineup, sim);
    expect(r.outcome).toBe('added');
    expect(r.pool.entries[0]).toMatchObject({ name: 'Alpha', n: 1, sources: ['picked'] });
    r = addByName(r.pool, 'outsider', lineup, sim);
    expect(r.pool.entries.map((e) => e.name)).toEqual(['Alpha', 'Outsider']);
    const u = addByName(r.pool, 'Metallica', lineup, sim);
    expect(u.outcome).toBe('unknown');
    expect(u.pool).toBe(r.pool);
  });
  it('reports an artist the visitor already added', () => {
    const pool = addTyped(emptyPool(), 'Outsider');
    expect(addSuggestion(pool, { kind: 'outside', name: 'Outsider' })).toMatchObject({ outcome: 'already', pool });
  });
  it('adding by hand an artist that only a library holds is not "already"', () => {
    const pool = addBatch(emptyPool(), 'spotify', [{ name: 'Outsider', weight: 0.5 }]);
    const r = addSuggestion(pool, { kind: 'outside', name: 'Outsider' });
    expect(r.outcome).toBe('added');
    expect(r.pool.entries[0].sources.sort()).toEqual(['spotify', 'typed']);
  });
});

describe('suggestions', () => {
  it('lists lineup artists first, then outside artists, with stable ids', () => {
    const s = suggestions('gamma', lineup, sim);
    expect(s).toEqual([
      { id: 'l3', kind: 'lineup', name: 'Gamma Ray', n: 3 },
      { id: 'ogamma rays tribute', kind: 'outside', name: 'Gamma Rays Tribute' },
    ]);
  });
  it('works on the lineup alone before the index loads, and respects the limit', () => {
    expect(suggestions('gamma', lineup, null)).toHaveLength(1);
    expect(suggestions('a', lineup, sim)).toEqual([]); // one character is too short
    expect(suggestions('gamma', lineup, sim, { limit: 1 })).toHaveLength(1);
  });
});

describe('validExamples', () => {
  it('keeps names on the lineup or in the index, drops unknown ones, keeps unresolved ones while the index loads', () => {
    expect(validExamples(['Alpha', 'Outsider', 'Nope'], lineup, sim)).toEqual(['Alpha', 'Outsider']);
    expect(validExamples(['Alpha', 'Outsider', 'Nope'], lineup, null)).toEqual(['Alpha', 'Outsider', 'Nope']);
    expect(validExamples(undefined, lineup, sim)).toEqual([]);
  });
});

describe('poolChips', () => {
  it('shows hand-added artists as chips and each library as one summary chip', () => {
    let pool = addPicked(addTyped(emptyPool(), 'Outsider'), { n: 1, name: 'Alpha' });
    pool = addBatch(pool, 'spotify', Array.from({ length: 1341 }, (_, i) => ({ name: `Lib ${i}`, weight: 0.5 })).concat([{ name: 'Alpha', weight: 0.4 }]));
    const chips = poolChips(pool);
    expect(chips.manual.map((c) => c.name)).toEqual(['Outsider', 'Alpha']);
    expect(chips.libraries).toEqual([{ sourceId: 'spotify', label: 'Spotify library', count: 1342, text: 'Spotify library · 1,342 artists' }]);
  });
  it('formats the summary for one artist', () => {
    expect(libraryChipText('Spotify library', 1)).toBe('Spotify library · 1 artist');
  });
});

describe('computeResults', () => {
  it('matches and recommends; "no data" only for hand-added artists', () => {
    let pool = addTyped(emptyPool(), 'Outsider');
    pool = addBatch(pool, 'spotify', [{ name: 'Unknown Library Act', weight: 0.8 }]);
    pool = addTyped(pool, 'Typed Nobody');
    const r = computeResults(pool, lineup, sim);
    expect(r.recommendations.map((x) => x.name)).toEqual(['Alpha', 'Beta']);
    expect(r.noData.map((e) => e.name)).toEqual(['Typed Nobody']);
    expect(r.stats.contributors).toBe(1);
  });
  it('without the index: lineup matches still work, nothing is reported as no data', () => {
    const pool = addTyped(addPicked(emptyPool(), { n: 1, name: 'Alpha' }), 'Outsider');
    const r = computeResults(pool, lineup, null);
    expect(r.matches.map((m) => m.name)).toEqual(['Alpha']);
    expect(r.recommendations.map((x) => x.name)).toEqual(['Beta', 'Gamma Ray']);
    expect(r.noData).toEqual([]);
  });
});

describe('reason wording', () => {
  it('joins names naturally', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
  it('words outside and lineup reasons', () => {
    expect(reasonText({ reasons: [{ name: 'Dry Cleaning', kind: 'outside' }] })).toBe('because you like Dry Cleaning');
    expect(reasonText({ reasons: [{ name: 'Loathe', kind: 'outside' }, { name: 'Deftones', kind: 'outside' }, { name: 'Jawbox', kind: 'lineup' }] })).toBe(
      'because you like Loathe, Deftones and Jawbox'
    );
    expect(reasonText({ reasons: [{ name: 'Bully', kind: 'lineup' }] })).toBe('because you like Bully, who is also playing');
    expect(reasonText({ reasons: [] })).toBe('');
    expect(reasonText(null)).toBe('');
  });
});

describe('bands', () => {
  const recs = (scores) => scores.map((score, i) => ({ n: i + 1, score, band: score >= 0.5 ? 'strong' : score >= 0.25 ? 'good' : 'worth-a-listen' }));
  it('groups by absolute band in order, leaving out empty groups', () => {
    const g = groupByBand(recs([0.9, 0.3, 0.12]));
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Strong match', 1], ['Good match', 1], ['Worth a listen', 1]]);
    expect(groupByBand(recs([0.3, 0.26])).map((x) => x.band)).toEqual(['good']);
  });
  it('switches to rank bands only for a large, saturated pool', () => {
    const saturated = recs(Array.from({ length: 30 }, () => 0.9));
    expect(useRelativeBands(LARGE_POOL - 1, saturated)).toBe(false);
    expect(useRelativeBands(LARGE_POOL, saturated)).toBe(true);
    expect(useRelativeBands(5000, recs([0.9, 0.9, 0.3]))).toBe(false);
    const g = groupByBand(saturated, { relative: true });
    expect(g.map((x) => x.items.length)).toEqual([RELATIVE_STRONG, 10, 10]);
  });
});

describe('listen links', () => {
  it('uses the chosen service: "Listen" when verified, "Search on X" otherwise; the rest go under more', () => {
    const a = lineup.byN(1);
    const sp = listenFor(a, 'spotify');
    expect(sp.primary).toMatchObject({ platform: 'spotify', kind: 'verified', text: 'Listen', url: 'https://open.spotify.com/artist/sp1' });
    expect(sp.others.map((l) => l.text)).toEqual(['Search on Apple Music', 'Listen on Tidal', 'Search on Bandcamp']);
    const bc = listenFor(a, 'bandcamp');
    expect(bc.primary).toMatchObject({ kind: 'search', text: 'Search on Bandcamp' });
    expect(bc.primary.url).toBe('https://bandcamp.com/search?q=Alpha&item_type=b');
  });
});

describe('similar lineup artists', () => {
  it('labels the signal', () => {
    expect(signalLabel('direct')).toBe('similar listeners');
    expect(signalLabel('neighbours')).toBe('similar listeners');
    expect(signalLabel('tags')).toBe('similar tags');
    expect(similarFor(1, lineup).map((s) => [s.name, s.label])).toEqual([['Beta', 'similar listeners'], ['Gamma Ray', 'similar tags']]);
  });
});

describe('share', () => {
  it('shares lineup picks from both lists only, never the pool', () => {
    const picks = sharePicks([{ n: 3 }, { n: 1 }], [{ n: 2 }, { n: 1 }]);
    expect(picks).toEqual([1, 2, 3]);
    const url = shareUrl('https://spotifort.com', 2030, picks);
    expect(url).toMatch(/^https:\/\/spotifort\.com\/#s=2030\./);
    expect(decodeShare(url.slice(url.indexOf('#')), lineup).picks).toEqual([1, 2, 3]);
    expect(shareUrl('https://spotifort.com', 2030, [])).toBeNull();
  });
  it('reads a valid fragment into lineup artists sorted by name; ignores invalid or empty ones', () => {
    const hash = new URL(shareUrl('https://x.test', 2030, [3, 2])).hash;
    expect(sharedFromHash(hash, lineup).artists.map((a) => a.name)).toEqual(['Beta', 'Gamma Ray']);
    expect(sharedFromHash('#s=2029.Bg', lineup)).toBeNull(); // wrong year
    expect(sharedFromHash('#s=2030.!!', lineup)).toBeNull();
    expect(sharedFromHash('#s=2030.', lineup)).toBeNull(); // valid but empty
    expect(sharedFromHash('', lineup)).toBeNull();
  });
});

describe('diagnostics', () => {
  it('summarises pool size, contributors and the score distribution', () => {
    const pool = addTyped(addTyped(emptyPool(), 'Outsider'), 'Gamma Rays Tribute');
    const d = diagnostics(pool, computeResults(pool, lineup, sim));
    expect(d).toMatchObject({ poolSize: 2, contributors: 2, candidates: 3, max: 0.5, bands: { strong: 1, good: 1, worth: 1 }, relative: false });
    expect(d.min).toBeCloseTo(0.2);
    expect(diagnostics(emptyPool(), { recommendations: [], stats: { scores: [], contributors: 0 } })).toMatchObject({ min: null, median: null, max: null });
  });
});

describe('import summary', () => {
  it('counts pool entries from the source, not imported items (artists sharing a name merge)', () => {
    const items = [
      { name: 'Same Name', ids: { spotify: 'aaaaaaaaaaaaaaaaaaaaaa' }, weight: 0.4 },
      { name: 'same name', ids: { spotify: 'bbbbbbbbbbbbbbbbbbbbbb' }, weight: 0.5 },
      { name: 'Other', ids: { spotify: 'cccccccccccccccccccccc' }, weight: 0.4 },
    ];
    const pool = addBatch(emptyPool(), 'spotify', items);
    expect(libraryCount(pool, 'spotify')).toBe(2);
    expect(libraryCount(pool, 'tidal')).toBe(0);
    expect(poolChips(pool).libraries[0].count).toBe(libraryCount(pool, 'spotify'));
  });
  it('names only the parts that were read', () => {
    expect(importSummaryText({ count: 1406, songs: 2998 })).toBe('Imported 1,406 artists from 2,998 liked songs, your top artists and the artists you follow.');
    expect(importSummaryText({ count: 5, songs: 1, missing: ['top artists'] })).toBe(
      'Imported 5 artists from 1 liked song and the artists you follow. Your top artists could not be read, so they were left out.');
    expect(importSummaryText({ count: 1, songs: 10, missing: ['top artists', 'followed artists'] })).toBe(
      'Imported 1 artist from 10 liked songs. Your top artists and followed artists could not be read, so they were left out.');
    expect(importSummaryText({ count: 0, songs: 0 })).toBe('Your Spotify library had no artists to add.');
  });
});

// --- playlist wording ----------------------------------------------------------------------------

const allStrings = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
};
const planOf = (artists, leftOut = 0, beyondCap = 0) => ({
  artists: Array.from({ length: artists }, (_, i) => ({ n: i + 1, name: `A${i}`, spotifyIds: ['x'] })),
  leftOut: Array.from({ length: leftOut }, (_, i) => ({ n: 1000 + i, name: `L${i}`, reason: 'unverified' })),
  beyondCap,
});
const NAME = 'Spotifort: Treefort 2030 · Nov 23, 2026';
const base = {
  url: 'https://open.spotify.com/playlist/PL1', playlistId: 'PL1', name: NAME, trackCount: 6, artistCount: 2, plannedTracks: 6,
  leftOut: [], newestReleases: [], searchExhausted: false, searchStopReason: null, releasesExhausted: false, releasesStopReason: null, error: null,
};

describe('playlistIntro', () => {
  it('has nothing to offer with no picks', () => {
    expect(playlistIntro(planOf(0))).toEqual({
      status: 'none', summary: 'Nothing to make a playlist from yet. Add artists until something appears in your lists.', notes: [], buttonText: 'Continue to Spotify',
    });
    expect(playlistIntro(undefined).status).toBe('none');
  });
  it('explains when every pick was left out', () => {
    const intro = playlistIntro(planOf(0, 2), { tokenReady: true });
    expect(intro.status).toBe('none');
    expect(intro.summary).toBe('None of your Treefort picks has a Spotify page we are sure of, so there is nothing to put in a playlist.');
    expect(intro.buttonText).toBe('Make the playlist');
  });
  it('summarises a ready plan with no notes', () => {
    const intro = playlistIntro(planOf(2));
    expect(intro).toEqual({
      status: 'ready',
      summary: 'Spotifort will make one new playlist in your Spotify account, with about 6 tracks: up to 3 each from 2 of your Treefort picks, in the order they are listed. Nothing else in your account is changed.',
      notes: [],
      buttonText: 'Continue to Spotify',
    });
  });
  it('adds the notes in order, with the right verb for one left-out pick', () => {
    const one = playlistIntro(planOf(1, 1));
    expect(one.notes).toEqual(['1 of your picks has no Spotify page we are sure of and will be left out. You will see which afterwards.']);
    const intro = playlistIntro(planOf(100, 3), { madeBefore: true, tokenReady: true });
    expect(intro.summary).toContain('about 300 tracks');
    expect(intro.summary).toContain('from 100 of your Treefort picks');
    expect(intro.notes).toEqual([
      '3 of your picks have no Spotify page we are sure of and will be left out. You will see which afterwards.',
      'You already made a playlist in this visit. This makes another one; it does not replace the first.',
    ]);
    expect(intro.buttonText).toBe('Make the playlist');
    expect(playlistIntro(planOf(100)).notes).toEqual([]); // exactly at the cap: nothing was cut, nothing to say
  });
  it('says so plainly when the cap applies, with a count and no names', () => {
    const intro = playlistIntro(planOf(100, 3, 47), { madeBefore: true });
    expect(intro.summary).toBe('Spotifort will make one new playlist in your Spotify account, with about 300 tracks: up to 3 each from the first 100 of your 150 Treefort picks, in the order they are listed. Nothing else in your account is changed.');
    expect(intro.notes).toEqual([
      'A playlist takes tracks from 100 picks at most, so the 47 further down your lists are not included.',
      '3 of your picks have no Spotify page we are sure of and will be left out. You will see which afterwards.',
      'You already made a playlist in this visit. This makes another one; it does not replace the first.',
    ]);
    expect(playlistIntro(planOf(100, 0, 1)).notes).toEqual(['A playlist takes tracks from 100 picks at most, so the 1 further down your lists is not included.']);
    expect(playlistIntro(planOf(100, 0, 1)).summary).toContain('the first 100 of your 101 Treefort picks');
    for (const junk of [undefined, null, -3, 2.5, 'x', NaN]) expect(playlistIntro({ ...planOf(5), beyondCap: junk }).notes).toEqual([]);
  });
  it('formats large numbers', () => {
    expect(playlistIntro(planOf(400)).summary).toContain('about 1,200 tracks');
  });
});

describe('playlistProgressText', () => {
  it('words each phase', () => {
    expect(playlistProgressText({ phase: 'lookup', done: 3, total: 1200 })).toBe('Looking up tracks… 3 of 1,200 artists');
    expect(playlistProgressText({ phase: 'create' })).toBe('Creating the playlist…');
    expect(playlistProgressText({ phase: 'add', done: 100, total: 150 })).toBe('Adding tracks… 100 of 150');
    expect(playlistProgressText({})).toBe('Getting your picks ready…');
    expect(playlistProgressText(null)).toBe('Getting your picks ready…');
  });
});

describe('leftOutGroups', () => {
  it('groups every reason in a fixed order, keeping the artists in the order given', () => {
    const groups = leftOutGroups([
      { n: 1, name: 'One', reason: 'lookup-failed' },
      { n: 2, name: 'Two', reason: 'unverified' },
      { n: 3, name: 'Three', reason: 'weird' },
      { n: 4, name: 'Four', reason: 'quota' },
      { n: 5, name: 'Five', reason: 'no-tracks' },
      { n: 6, name: 'Six', reason: 'no-spotify' },
      { n: 7, name: 'Seven', reason: 'unverified' },
    ]);
    expect(groups).toEqual([
      { reason: 'unverified', label: 'We are not sure which Spotify artist this is, so we did not guess:', artists: [{ n: 2, name: 'Two' }, { n: 7, name: 'Seven' }] },
      { reason: 'no-spotify', label: 'No Spotify page that we know of:', artists: [{ n: 6, name: 'Six' }] },
      { reason: 'no-tracks', label: 'No tracks of their own found on Spotify:', artists: [{ n: 5, name: 'Five' }] },
      { reason: 'quota', label: 'Spotify stopped answering lookups before we got to them:', artists: [{ n: 4, name: 'Four' }] },
      { reason: 'lookup-failed', label: 'The lookup failed for them:', artists: [{ n: 1, name: 'One' }] },
      { reason: 'other', label: 'Left out:', artists: [{ n: 3, name: 'Three' }] },
    ]);
  });
  it('omits empty groups and tolerates junk', () => {
    expect(leftOutGroups([{ n: 1, name: 'One', reason: 'no-tracks' }]).map((g) => g.reason)).toEqual(['no-tracks']);
    expect(leftOutGroups(undefined)).toEqual([]);
    expect(leftOutGroups('x')).toEqual([]);
    expect(leftOutGroups([null, 5, { n: 2, reason: 'toString' }, { n: 3, name: 7, reason: 'quota' }])).toEqual([
      { reason: 'quota', label: 'Spotify stopped answering lookups before we got to them:', artists: [{ n: 3, name: '' }] },
      { reason: 'other', label: 'Left out:', artists: [{ n: 2, name: '' }] },
    ]);
  });
});

describe('searchStopText / releasesStopText', () => {
  it('words the four search stops', () => {
    expect(searchStopText('quota')).toBe('Spotify’s daily search limit for your Client ID was reached part-way through, so for the remaining artists we looked at their newest releases instead. The limit can take up to a day to clear.');
    expect(searchStopText('rate')).toBe('Spotify started refusing searches part-way through (too many requests), so for the remaining artists we looked at their newest releases instead. If that was a daily limit, it can take up to a day to clear.');
    expect(searchStopText('errors')).toBe('Spotify’s search kept failing part-way through, so for the remaining artists we looked at their newest releases instead.');
    expect(searchStopText('network')).toBe('A search got no answer part-way through, so for the remaining artists we looked at their newest releases instead.');
  });
  it('words the two releases stops', () => {
    expect(releasesStopText('quota')).toBe('Spotify’s daily limit for your Client ID was reached while we were looking at newest releases, so the artists not yet looked up were left out. The limit can take up to a day to clear.');
    expect(releasesStopText('rate')).toBe('Spotify started refusing requests (too many requests) while we were looking at newest releases, so the artists not yet looked up were left out. If that was a daily limit, it can take up to a day to clear.');
  });
  it('returns null for no reason or an unknown one', () => {
    for (const r of [null, undefined, '', 'nope', 'toString', '__proto__', 5]) {
      expect(searchStopText(r)).toBeNull();
      expect(releasesStopText(r)).toBeNull();
    }
    expect(releasesStopText('errors')).toBeNull();
    expect(releasesStopText('network')).toBeNull();
  });
});

describe('playlistOutcome', () => {
  it('created: heading, counts, link, visibility, announce', () => {
    const vm = playlistOutcome({ ...base, status: 'created' });
    expect(vm).toEqual({
      status: 'created',
      heading: 'Your playlist is ready',
      lines: [`6 tracks from 2 artists are in “${NAME}”.`],
      link: { url: 'https://open.spotify.com/playlist/PL1', text: 'Open Spotify', label: 'Open Spotify to see your playlist' },
      visibility: true,
      notes: [],
      capNote: null,
      newest: null,
      leftOut: [],
      announce: 'Your playlist is ready: 6 tracks from 2 artists.',
    });
  });
  it('created: plurals for one track and one artist', () => {
    const vm = playlistOutcome({ ...base, status: 'created', trackCount: 1, artistCount: 1 });
    expect(vm.lines).toEqual([`1 track from 1 artist is in “${NAME}”.`]);
    expect(vm.announce).toBe('Your playlist is ready: 1 track from 1 artist.');
    expect(playlistOutcome({ ...base, status: 'created', trackCount: 3, artistCount: 1 }).lines[0]).toBe(`3 tracks from 1 artist are in “${NAME}”.`);
  });
  it('created: notes from both stop reasons, newest releases and left-out groups', () => {
    const vm = playlistOutcome({
      ...base, status: 'created', searchStopReason: 'rate', releasesStopReason: 'quota',
      newestReleases: [{ n: 1, name: 'A', searched: false }, { n: 2, name: 'B', searched: true }, { n: 3, name: 'C' }],
      leftOut: [{ n: 9, name: 'Z', reason: 'quota' }],
    });
    expect(vm.notes).toEqual([searchStopText('rate'), releasesStopText('quota')]);
    expect(vm.newest).toEqual({ label: 'Tracks from newest releases were used for:', names: ['A', 'B', 'C'] });
    expect(vm.leftOut).toEqual(leftOutGroups([{ n: 9, name: 'Z', reason: 'quota' }]));
  });
  it('incomplete: says what it holds, never to try again', () => {
    const vm = playlistOutcome({
      ...base, status: 'incomplete', trackCount: 100, plannedTracks: 150, searchStopReason: 'quota',
      newestReleases: [{ n: 1, name: 'A' }], leftOut: [{ n: 9, name: 'Z', reason: 'no-tracks' }],
      error: { kind: 'incomplete', cause: 'network', message: 'x' },
    });
    expect(vm.status).toBe('incomplete');
    expect(vm.heading).toBe('Your playlist was made, but it is not complete');
    expect(vm.lines).toEqual([
      `Spotify stopped accepting tracks part-way. At least 100 of 150 tracks are in “${NAME}”.`,
      'Open it in Spotify to see what it holds. Making a playlist again would create a second one; it would not finish this one.',
    ]);
    expect(vm.link).toEqual({ url: base.url, text: 'Open Spotify', label: 'Open Spotify to see your playlist' });
    expect(vm.visibility).toBe(true);
    expect(vm.notes).toEqual([searchStopText('quota')]);
    expect(vm.newest.names).toEqual(['A']);
    expect(vm.leftOut).toHaveLength(1);
    expect(vm.announce).toBe('Your playlist was made, but not every track was added.');
  });
  it('empty: nothing was created; no link and no visibility note', () => {
    const vm = playlistOutcome({ ...base, status: 'empty', url: null, playlistId: null, trackCount: 0, artistCount: 0, plannedTracks: 0, searchStopReason: 'errors', newestReleases: [{ n: 1, name: 'A' }], leftOut: [{ n: 1, name: 'A', reason: 'no-tracks' }] });
    expect(vm).toMatchObject({
      status: 'empty', heading: 'No playlist was made', link: null, visibility: false, newest: null,
      lines: ['No tracks were found on Spotify for your picks, so nothing was created in your account.'],
      notes: [searchStopText('errors')],
      announce: 'No playlist was made: no tracks were found.',
    });
    expect(vm.leftOut).toHaveLength(1);
  });
  it('unconfirmed: names the playlist, says to look before making another, and shows no lists', () => {
    const vm = playlistOutcome({
      ...base, status: 'unconfirmed', url: null, playlistId: null, trackCount: 0, artistCount: 0, searchStopReason: 'quota',
      newestReleases: [{ n: 1, name: 'A' }], leftOut: [{ n: 9, name: 'Z', reason: 'no-tracks' }], error: { kind: 'unconfirmed', cause: 'network', message: 'x' },
    });
    expect(vm).toEqual({
      status: 'unconfirmed',
      heading: 'We cannot tell whether your playlist was made',
      lines: [
        `Spotify did not confirm it. Look in your Spotify library for “${NAME}” before you make another one.`,
        'If it is there, it is empty: no tracks were added, and you can delete it in Spotify. If it is not there, nothing was created.',
      ],
      link: null, visibility: false, notes: [], capNote: null, newest: null, leftOut: [],
      announce: 'Spotify did not confirm that the playlist was made. Look in your Spotify library before making another.',
    });
  });
  it('an unknown or missing status is treated as unconfirmed, without throwing', () => {
    for (const r of [undefined, null, {}, { status: 'weird' }, { status: 'unconfirmed', name: 7 }, { error: { kind: 'network' } }]) {
      const vm = playlistOutcome(r);
      expect(vm.status).toBe('unconfirmed');
      expect(vm.link).toBeNull();
      expect(vm.lines[0]).toBe('Spotify did not confirm it. Look in your Spotify library for it before you make another one.');
    }
  });
  it('reads status, not error: a created result with a stray error is still created', () => {
    expect(playlistOutcome({ ...base, status: 'created', error: { kind: 'network' } }).status).toBe('created');
  });
  it('tolerates junk counts and lists', () => {
    const vm = playlistOutcome({ status: 'created', name: NAME, url: 5, trackCount: 'x', artistCount: -1, newestReleases: 'x', leftOut: 'x' });
    expect(vm.lines).toEqual([`0 tracks from 0 artists are in “${NAME}”.`]);
    expect(vm.link).toBeNull();
    expect(vm.newest).toBeNull();
    expect(vm.leftOut).toEqual([]);
  });
});

describe('playlistOutcome: incomplete with nothing confirmed', () => {
  it('does not claim "at least 0" tracks and still never says to try again', () => {
    const vm = playlistOutcome({ status: 'incomplete', name: 'N', url: 'https://open.spotify.com/playlist/abc', trackCount: 0, plannedTracks: 9, artistCount: 0, leftOut: [], newestReleases: [] });
    expect(vm.lines[0]).toBe('Spotify stopped accepting tracks before any were confirmed, so “N” may be empty.');
    expect(JSON.stringify(vm)).not.toMatch(/try again|retry/i);
  });
});

describe('picks beyond the cap in the outcome', () => {
  const made = { status: 'created', name: 'N', url: 'https://open.spotify.com/playlist/abc', trackCount: 300, plannedTracks: 300, artistCount: 100, leftOut: [{ n: 1, name: 'L', reason: 'unverified' }], newestReleases: [] };
  it('gives a count in its own note, never in the left-out groups', () => {
    const vm = playlistOutcome(made, { beyondCap: 47 });
    expect(vm.capNote).toBe('A playlist takes tracks from 100 picks at most. 47 of your picks were further down your lists and are not in it.');
    expect(vm.leftOut).toEqual([{ reason: 'unverified', label: expect.any(String), artists: [{ n: 1, name: 'L' }] }]);
    expect(beyondCapText(1)).toBe('A playlist takes tracks from 100 picks at most. 1 of your picks was further down your lists and is not in it.');
  });
  it('is absent when nothing was beyond the cap, and for an unconfirmed outcome', () => {
    expect(playlistOutcome(made).capNote).toBeNull();
    expect(playlistOutcome(made, { beyondCap: 0 }).capNote).toBeNull();
    for (const junk of [undefined, null, -1, 1.5, '4']) expect(beyondCapText(junk)).toBeNull();
    expect(playlistOutcome({ status: 'unconfirmed', name: 'N' }, { beyondCap: 47 }).capNote).toBeNull();
    for (const status of ['incomplete', 'empty']) expect(playlistOutcome({ ...made, status }, { beyondCap: 2 }).capNote).toContain('2 of your picks were');
  });
});

describe('playlistFailure', () => {
  const cases = {
    auth: 'Your Spotify login had expired before anything was created. Log in again to make the playlist.',
    forbidden: 'Spotify refused the request, so nothing was created. Check that you approved the playlist permission, and that you logged in with the Spotify account your Client ID belongs to.',
    scope: 'Spotify refused the request, so nothing was created. Check that you approved the playlist permission, and that you logged in with the Spotify account your Client ID belongs to.',
    quota: 'Spotify’s daily limit for your Client ID has been reached, so nothing was created. It can take up to a day to clear.',
    rate: 'Spotify is refusing requests right now (too many requests), so nothing was created. Wait a while before trying again; if it is a daily limit, it can take up to a day to clear.',
    http: 'Spotify returned an error, so nothing was created. You can try again.',
    network: 'Spotify could not be reached, so nothing was created. Check your connection and try again.',
    data: 'We could not load the artist data, so nothing was created. You can try again.',
  };
  for (const [kind, text] of Object.entries(cases)) {
    it(`words a ${kind} rejection`, () => {
      expect(playlistFailure({ kind })).toEqual({ kind, heading: 'No playlist was made', text, announce: `No playlist was made. ${text}` });
    });
  }
  it('words anything else generically', () => {
    const other = 'Something went wrong before the playlist was made, so nothing was created. You can try again.';
    for (const err of [undefined, null, new Error('x'), { kind: 'weird' }, { kind: 'toString' }, { kind: 'incomplete' }]) {
      expect(playlistFailure(err)).toMatchObject({ kind: 'other', heading: 'No playlist was made', text: other, announce: `No playlist was made. ${other}` });
    }
  });
});

describe('playlist wording: hard rules', () => {
  const stops = { searchStopReason: 'rate', releasesStopReason: 'rate', newestReleases: [{ n: 1, name: 'A' }], leftOut: ['unverified', 'no-spotify', 'no-tracks', 'quota', 'lookup-failed', 'x'].map((reason, i) => ({ n: i, name: `N${i}`, reason })) };
  const outcomes = ['created', 'incomplete', 'empty', 'unconfirmed', 'weird'].map((status) => playlistOutcome({ ...base, ...stops, status }));
  it('incomplete and unconfirmed never say to try again or retry', () => {
    for (const vm of outcomes.filter((o) => o.status === 'incomplete' || o.status === 'unconfirmed')) {
      for (const s of allStrings(vm)) expect(s).not.toMatch(/try again|retry/i);
    }
  });
  it('no playlist string says "private playlist"', () => {
    const intros = [playlistIntro(planOf(0)), playlistIntro(planOf(0, 1)), playlistIntro(planOf(100, 2, 30), { madeBefore: true, tokenReady: true })];
    const failures = ['auth', 'forbidden', 'scope', 'quota', 'rate', 'http', 'network', 'data', 'x'].map((kind) => playlistFailure({ kind }));
    const strings = [...allStrings(outcomes), ...allStrings(intros), ...allStrings(failures), PLAYLIST_VISIBILITY_NOTE];
    expect(strings.length).toBeGreaterThan(30);
    for (const s of strings) expect(s.toLowerCase()).not.toContain('private playlist');
  });
  it('the visibility note says how to make it private', () => {
    expect(PLAYLIST_VISIBILITY_NOTE).toBe('Spotify labels this playlist “Public Playlist”, and anyone who has its link can open it. It is not shown on your profile. To change that, open it in Spotify, open its ••• menu and choose Make private.');
  });
});
