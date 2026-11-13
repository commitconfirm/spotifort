import { describe, it, expect } from 'vitest';
import {
  cleanSlug,
  discoverRestBase,
  feedLooksBroken,
  festivalLinksFor,
  festivalSpotifyTarget,
  needsFestival,
  parseAlbumArtists,
  parsePerformer,
  parseSpotifyLink,
  performerUrl,
} from '../scripts/lib/festival.js';
import { parseLineupCards, parseLineupHtml } from '../scripts/lib/lineup-pipeline.js';
import { applyFestivalSpotify, mergeScrape, needsSpotify, spotifySource } from '../scripts/lib/state.js';
import { resolveRecord, buildOutputs } from '../scripts/lib/build.js';
import { FESTIVAL_REST_BASE } from '../scripts/lib/constants.js';

const ID = '6hhmxPotJ2kCsQjUGPtH14';
const ID2 = '49ECnwhYzm6Nu97puMvwjG';

describe('parseSpotifyLink', () => {
  it('reads artist ids, ignoring query, fragment and intl prefix', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/artist/${ID}`)).toEqual({ kind: 'artist', id: ID });
    expect(parseSpotifyLink(`https://open.spotify.com/artist/${ID}?si=abc&nd=1#x`)).toEqual({ kind: 'artist', id: ID });
    expect(parseSpotifyLink(`https://open.spotify.com/intl-ja/artist/${ID}`)).toEqual({ kind: 'artist', id: ID });
    expect(parseSpotifyLink(`https://open.spotify.com/intl-pt-br/artist/${ID}`)).toEqual({ kind: 'artist', id: ID });
    expect(parseSpotifyLink(`  https://open.spotify.com/artist/${ID}/ `)).toEqual({ kind: 'artist', id: ID });
  });
  it('reads album ids', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/album/${ID}?si=x`)).toEqual({ kind: 'album', id: ID });
  });
  it('a junk query that holds another URL does not matter', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/artist/${ID}?si=https://open.spotify.com/album/${ID2}?si=x`)).toEqual({ kind: 'artist', id: ID });
  });
  it('records non-artist links with their kind and no query', () => {
    expect(parseSpotifyLink('https://open.spotify.com/user/sautrah?si=1')).toEqual({ kind: 'user', url: 'https://open.spotify.com/user/sautrah' });
    expect(parseSpotifyLink(`https://open.spotify.com/playlist/${ID}`)).toEqual({ kind: 'playlist', url: `https://open.spotify.com/playlist/${ID}` });
    expect(parseSpotifyLink(`https://open.spotify.com/track/${ID}`)).toMatchObject({ kind: 'track' });
  });
  it('rejects everything that is not an https open.spotify.com URL', () => {
    for (const bad of [
      `http://open.spotify.com/artist/${ID}`,
      `https://evil.example/artist/${ID}`,
      `https://open.spotify.com.evil.example/artist/${ID}`,
      `https://spotify.com/artist/${ID}`,
      `https://user:pw@open.spotify.com/artist/${ID}`,
      `https://open.spotify.com:8443/artist/${ID}`,
      `spotify:artist:${ID}`,
      'https://open.spotify.com/artist/short',
      'https://open.spotify.com/artist/',
      'https://open.spotify.com/',
      'not a url',
      '',
      null,
      42,
    ]) {
      expect(parseSpotifyLink(bad), String(bad)).toBeNull();
    }
  });
});

describe('parsePerformer', () => {
  const body = {
    found: true,
    name: 'X',
    hometown: ' Boise,  ID ',
    bio: '<p>long text</p>',
    image: 'https://example.com/a.jpg',
    social: [
      { type: 'spotify', url: `https://open.spotify.com/artist/${ID}?si=1` },
      { type: 'bandcamp', url: 'https://x.bandcamp.com/album/y' },
      { type: 'applemusic', url: 'https://music.apple.com/us/artist/x/12345' },
      { type: 'youtube', url: 'https://www.youtube.com/@x' },
      { type: 'soundcloud', url: 'https://soundcloud.com/search?q=x' },
      { type: 'instagram', url: 'https://www.instagram.com/x/' },
      { type: 'website', url: 'http://insecure.example/' },
      { type: 'facebook', url: 'javascript:alert(1)' },
    ],
    music: [{ type: 'applemusic', url: 'https://music.apple.com/us/album/z/1?i=2' }],
    showtimes: [],
  };
  it('keeps the spotify target, validated links and the hometown; drops bio, image and music', () => {
    const r = parsePerformer(body, 'x', '2026-11-13');
    expect(r.ok).toBe(true);
    expect(r.festival).toEqual({
      slug: 'x',
      fetched: '2026-11-13',
      hometown: 'Boise, ID',
      spotify: { kind: 'artist', id: ID },
      links: {
        appleMusic: 'https://music.apple.com/us/artist/x/12345',
        bandcamp: 'https://x.bandcamp.com/album/y',
        instagram: 'https://www.instagram.com/x/',
        youtube: 'https://www.youtube.com/@x',
      },
    });
  });
  it('prefers an artist link over an album link over anything else', () => {
    const social = [
      { type: 'spotify', url: 'https://open.spotify.com/user/u' },
      { type: 'spotify', url: `https://open.spotify.com/album/${ID2}` },
      { type: 'spotify', url: `https://open.spotify.com/artist/${ID}` },
    ];
    expect(parsePerformer({ found: true, social }, 's', 'd').festival.spotify).toEqual({ kind: 'artist', id: ID });
    expect(parsePerformer({ found: true, social: social.slice(0, 2) }, 's', 'd').festival.spotify).toEqual({ kind: 'album', id: ID2 });
    expect(parsePerformer({ found: true, social: social.slice(0, 1) }, 's', 'd').festival.spotify).toMatchObject({ kind: 'user' });
  });
  it('a performer with no spotify link has none', () => {
    expect(parsePerformer({ found: true, social: [] }, 's', 'd').festival).toEqual({ slug: 's', fetched: 'd', links: {} });
  });
  it('keeps showtimes only when they are a short list of flat objects', () => {
    const ok = [{ venue: 'A', start: '2027-04-01T20:00', day: 3 }];
    expect(parsePerformer({ found: true, showtimes: ok }, 's', 'd').festival.showtimes).toEqual(ok);
    expect(parsePerformer({ found: true, showtimes: [{ nested: { a: 1 } }] }, 's', 'd').festival.showtimes).toBeUndefined();
    expect(parsePerformer({ found: true, showtimes: Array.from({ length: 500 }, () => ({ a: 1 })) }, 's', 'd').festival.showtimes).toBeUndefined();
    expect(parsePerformer({ found: true, showtimes: 'soon' }, 's', 'd').festival.showtimes).toBeUndefined();
  });
  it('tolerates missing fields and wrong types', () => {
    const r = parsePerformer({ found: true, hometown: 5, social: [null, 'x', { type: 5, url: 'y' }, { type: 'spotify' }, { type: 'bandcamp', url: {} }], music: 'no' }, 's', 'd');
    expect(r).toEqual({ ok: true, festival: { slug: 's', fetched: 'd', links: {} } });
    expect(parsePerformer({ found: true, social: 'nope' }, 's', 'd').ok).toBe(true);
  });
  it('treats found:false, non-objects and a missing found as failures', () => {
    expect(parsePerformer({ found: false }, 's', 'd')).toMatchObject({ ok: false });
    expect(parsePerformer({ name: 'x' }, 's', 'd')).toMatchObject({ ok: false });
    for (const bad of [null, undefined, 'text', 7, [], true]) expect(parsePerformer(bad, 's', 'd').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('cleanSlug accepts plain slugs and rejects path tricks', () => {
    expect(cleanSlug('alex-amen')).toBe('alex-amen');
    expect(cleanSlug('jün')).toBe('jün');
    for (const bad of ['', '../x', 'a/b', 'a b', '-x', 'a?b', null, 5, 'x'.repeat(101)]) expect(cleanSlug(bad), String(bad)).toBeNull();
  });
  it('discoverRestBase reads the page config only for https on the festival host', () => {
    const page = (base) => `<script>var tmfLineup = {"restBase":"${base}","performerBase":"x"};</script>`;
    expect(discoverRestBase(page('https://treefortmusicfest.com/wp-json/tmf/v2/performer/'))).toBe('https://treefortmusicfest.com/wp-json/tmf/v2/performer/');
    expect(discoverRestBase(page('https://treefortmusicfest.com/wp-json/tmf/v2/performer'))).toBe('https://treefortmusicfest.com/wp-json/tmf/v2/performer/');
    for (const bad of ['https://evil.example/x/', 'http://treefortmusicfest.com/x/', 'https://treefortmusicfest.com:99/x/', 'https://treefortmusicfest.com/x/?a=1', 'nonsense']) {
      expect(discoverRestBase(page(bad)), bad).toBe(FESTIVAL_REST_BASE);
    }
    expect(discoverRestBase('<html>no config</html>')).toBe(FESTIVAL_REST_BASE);
    expect(discoverRestBase('tmfLineup = {broken;')).toBe(FESTIVAL_REST_BASE);
    expect(discoverRestBase(undefined)).toBe(FESTIVAL_REST_BASE);
  });
  it('performerUrl encodes the slug', () => {
    expect(performerUrl('https://h/p/', 'a-b')).toBe('https://h/p/a-b');
    expect(performerUrl('https://h/p/', 'jün')).toBe('https://h/p/j%C3%BCn');
  });
  it('needsFestival: slug present and not fetched (or changed, or refresh)', () => {
    expect(needsFestival({ slug: 'a' })).toBe(true);
    expect(needsFestival({ slug: 'a', festival: { slug: 'a' } })).toBe(false);
    expect(needsFestival({ slug: 'b', festival: { slug: 'a' } })).toBe(true);
    expect(needsFestival({ slug: 'a', festival: { slug: 'a' } }, true)).toBe(true);
    expect(needsFestival({ festival: { slug: 'a' } })).toBe(false);
    expect(needsFestival({ slug: 'a', removed: '2026-12-01' })).toBe(false);
    expect(needsFestival({ slug: '../x' })).toBe(false);
  });
  it('feedLooksBroken: more than half failing, after enough requests', () => {
    expect(feedLooksBroken({ attempted: 5, failed: 5 })).toBe(false); // too early to judge
    expect(feedLooksBroken({ attempted: 10, failed: 5 })).toBe(false); // exactly half
    expect(feedLooksBroken({ attempted: 10, failed: 6 })).toBe(true);
    expect(feedLooksBroken({ attempted: 100, failed: 3 })).toBe(false);
  });
  it('parseAlbumArtists keeps order, drops bad ids and repeats', () => {
    expect(parseAlbumArtists({ artists: [{ id: ID, name: 'A' }, { id: 'bad' }, { id: ID }, { id: ID2, name: 'B' }, null] })).toEqual([{ id: ID, name: 'A' }, { id: ID2, name: 'B' }]);
    expect(parseAlbumArtists({})).toEqual([]);
    expect(parseAlbumArtists(null)).toEqual([]);
  });
  it('festivalSpotifyTarget only returns artist or album targets', () => {
    expect(festivalSpotifyTarget({ festival: { spotify: { kind: 'artist', id: ID } } })).toEqual({ kind: 'artist', id: ID });
    expect(festivalSpotifyTarget({ festival: { spotify: { kind: 'album', id: ID } } })).toEqual({ kind: 'album', id: ID });
    expect(festivalSpotifyTarget({ festival: { spotify: { kind: 'user', url: 'u' } } })).toBeNull();
    expect(festivalSpotifyTarget({ festival: { spotify: { kind: 'artist', id: 'bad' } } })).toBeNull();
    expect(festivalSpotifyTarget({})).toBeNull();
  });
  it('festivalLinksFor revalidates stored links and reads platform ids', () => {
    const r = festivalLinksFor({ festival: { links: { appleMusic: 'https://music.apple.com/us/artist/x/12345', bandcamp: 'http://x.bandcamp.com/', youtube: 'https://evil.example/@x', instagram: 'https://www.instagram.com/x/' } } });
    expect(r).toEqual({ links: { appleMusic: 'https://music.apple.com/us/artist/x/12345' }, ids: { appleMusic: '12345' } });
  });
});

describe('scrape slugs', () => {
  const card = (slug, name) => `<div class="lineup-item"${slug ? ` data-slug="${slug}"` : ''}><a><h3 class="lineup-artist-name">${name}</h3></a></div>`;
  it('parseLineupCards pairs each name with its own slug', () => {
    const html = [card('a-b', 'A &amp; B'), card(null, 'No Slug'), card('c', 'C'), card('dup', 'c')].join('\n');
    expect(parseLineupCards(html)).toEqual([
      { name: 'A & B', slug: 'a-b' },
      { name: 'No Slug', slug: null },
      { name: 'C', slug: 'c' },
    ]);
    expect(parseLineupHtml(html)).toEqual(['A & B', 'No Slug', 'C']);
  });
  it('mergeScrape stores slugs, updates them and drops them when the card has none', () => {
    const names = Array.from({ length: 52 }, (_, i) => `Artist ${i}`);
    const first = mergeScrape({ year: 2027, artists: [] }, names.map((name, i) => ({ name, slug: i === 1 ? null : `s${i}` })), '2026-11-13');
    expect(first.state.artists[0].slug).toBe('s0');
    expect('slug' in first.state.artists[1]).toBe(false);
    const second = mergeScrape(first.state, names.map((name, i) => ({ name, slug: i === 0 ? 'renamed' : i === 1 ? 'now' : null })), '2026-11-14');
    expect(second.state.artists[0].slug).toBe('renamed');
    expect(second.state.artists[1].slug).toBe('now');
    expect('slug' in second.state.artists[2]).toBe(false);
    // plain names still work
    expect(mergeScrape(first.state, names, '2026-11-14').state.artists).toHaveLength(52);
  });
});

describe('Spotify resolution order', () => {
  const base = { n: 1, id: 'x', name: 'X', firstSeen: 'd' };
  const searched = { ids: [ID2], matchedName: 'X', confidence: 'exact' };
  const withArtist = (extra = {}) => ({ ...base, festival: { slug: 'x', spotify: { kind: 'artist', id: ID } }, ...extra });

  it('an override beats everything and the festival link is not even looked up', () => {
    expect(needsSpotify(withArtist(), { spotifyIds: [ID2] })).toBe(false);
    expect(spotifySource(withArtist({ spotify: searched }), { spotifyIds: [ID2] })).toBe('override');
  });
  it('a festival artist link is needed when nothing, or a search result, is stored', () => {
    expect(needsSpotify(withArtist(), {})).toBe(true);
    expect(needsSpotify(withArtist({ spotify: searched }), {})).toBe(true);
    const done = withArtist();
    applyFestivalSpotify(done, { ids: [ID], matchedName: null, via: 'artist' });
    expect(done.spotify).toEqual({ ids: [ID], matchedName: null, confidence: 'festival', via: 'artist' });
    expect(needsSpotify(done, {})).toBe(false);
    expect(spotifySource(done, {})).toBe('festival');
  });
  it('the festival wins over a different search result and remembers it', () => {
    const r = withArtist({ spotify: searched });
    applyFestivalSpotify(r, { ids: [ID], matchedName: null, via: 'artist' });
    expect(r.spotify.supersedes).toEqual({ ids: [ID2], matchedName: 'X', confidence: 'exact' });
    // applying the same result again keeps the memory
    applyFestivalSpotify(r, { ids: [ID], matchedName: null, via: 'artist' });
    expect(r.spotify.supersedes.ids).toEqual([ID2]);
  });
  it('the same id as the search result is not a change', () => {
    const r = withArtist({ spotify: { ids: [ID], matchedName: 'X', confidence: 'ambiguous' } });
    applyFestivalSpotify(r, { ids: [ID], matchedName: null, via: 'artist' });
    expect(r.spotify.supersedes).toBeUndefined();
  });
  it('an earlier "none" is not reported as a change', () => {
    const r = withArtist({ spotify: { ids: [], matchedName: null, confidence: 'none' } });
    applyFestivalSpotify(r, { ids: [ID], matchedName: null, via: 'artist' });
    expect(r.spotify.supersedes).toBeUndefined();
  });
  it('an album link needs resolving once, then is remembered by album id', () => {
    const r = { ...base, festival: { slug: 'x', spotify: { kind: 'album', id: ID } }, spotify: searched };
    expect(needsSpotify(r, {})).toBe(true);
    applyFestivalSpotify(r, { ids: [ID2, ID], matchedName: 'A & B', via: 'album', albumId: ID });
    expect(r.spotify).toMatchObject({ confidence: 'festival', via: 'album', albumId: ID });
    expect(needsSpotify(r, {})).toBe(false);
    expect(spotifySource(r, {})).toBe('festival-album');
    r.festival.spotify.id = ID2; // the festival changed the album
    expect(needsSpotify(r, {})).toBe(true);
  });
  it('a changed festival artist link is picked up; a vanished one falls back to search', () => {
    const r = withArtist();
    applyFestivalSpotify(r, { ids: [ID], matchedName: null, via: 'artist' });
    r.festival.spotify = { kind: 'artist', id: ID2 };
    expect(needsSpotify(r, {})).toBe(true);
    delete r.festival.spotify;
    expect(needsSpotify(r, {})).toBe(true); // stored festival result, no link any more
    r.spotify = searched;
    expect(needsSpotify(r, {})).toBe(false);
  });
  it('non-artist links, no link and an unfetched feed leave the old behaviour', () => {
    const user = { ...base, festival: { slug: 'x', spotify: { kind: 'user', url: 'u' } } };
    expect(needsSpotify(user, {})).toBe(true);
    expect(needsSpotify({ ...user, spotify: searched }, {})).toBe(false);
    expect(needsSpotify({ ...base, slug: 'x' }, {})).toBe(true);
    expect(spotifySource({ ...base, spotify: { ids: [], confidence: 'none' } }, {})).toBe('none');
    expect(spotifySource({ ...base, spotify: searched }, {})).toBe('search');
    expect(spotifySource(base, {})).toBe('unresolved');
  });
});

describe('build with festival data', () => {
  const rec = (extra = {}) => ({ n: 1, id: 'x', name: 'X', firstSeen: 'd', ...extra });
  const fest = { slug: 'x', spotify: { kind: 'artist', id: ID }, links: { bandcamp: 'https://x.bandcamp.com/', appleMusic: 'https://music.apple.com/us/artist/x/12345', youtube: 'https://www.youtube.com/@x' } };

  it('festival confidence counts as confirmed, not unverified', () => {
    const r = resolveRecord(rec({ spotify: { ids: [ID], matchedName: null, confidence: 'festival', via: 'artist' }, festival: fest }), {});
    expect(r.unverified).toBe(false);
    expect(r.spotifyIds).toEqual([ID]);
    expect(r.confidence).toBe('festival');
    expect(r.spotifySource).toBe('festival');
  });
  it('an override with unverified:true still wins over a festival result', () => {
    const r = resolveRecord(rec({ spotify: { ids: [ID], matchedName: null, confidence: 'festival', via: 'artist' }, festival: fest }), { spotifyIds: [ID2], unverified: true });
    expect(r.spotifyIds).toEqual([ID2]);
    expect(r.unverified).toBe(true);
    expect(r.spotifySource).toBe('override');
    expect(r.supersedes).toBeNull();
  });
  it('festival links fill what MusicBrainz lacks, MusicBrainz wins elsewhere, and ids come from the URL', () => {
    const r = resolveRecord(
      rec({ spotify: { ids: [ID], matchedName: null, confidence: 'festival', via: 'artist' }, festival: fest, links: { bandcamp: 'https://mb.bandcamp.com/' } }),
      {}
    );
    expect(r.links.bandcamp).toBe('https://mb.bandcamp.com/');
    expect(r.links.appleMusic).toBe('https://music.apple.com/us/artist/x/12345');
    expect(r.links.youtube).toBe('https://www.youtube.com/@x');
    expect(r.links.spotify).toBe(`https://open.spotify.com/artist/${ID}`);
    expect(r.ids).toEqual({ appleMusic: '12345' });
    expect(Object.keys(r.links)).not.toContain('website');
  });
  it('an override link still beats a festival link', () => {
    const r = resolveRecord(rec({ spotify: { ids: [ID], confidence: 'festival', via: 'artist' }, festival: fest }), { links: { bandcamp: null } });
    expect(r.links.bandcamp).toBeUndefined();
  });
  it('the review lists sources, changes, non-artist links, search-only artists and unfetched performers', () => {
    const artists = [
      rec({ n: 1, id: 'a', name: 'Alpha', slug: 'a', festival: fest, spotify: { ids: [ID], matchedName: null, confidence: 'festival', via: 'artist', supersedes: { ids: [ID2], matchedName: 'Alfa', confidence: 'exact' } } }),
      rec({ n: 2, id: 'b', name: 'Beta', slug: 'b', festival: { slug: 'b', links: {}, spotify: { kind: 'user', url: 'https://open.spotify.com/user/beta' } }, spotify: { ids: [ID2], matchedName: 'Beta', confidence: 'exact' } }),
      rec({ n: 3, id: 'c', name: 'Gamma', slug: 'c', festival: { slug: 'c', links: {} }, spotify: { ids: [ID2], matchedName: 'Gamma', confidence: 'inexact' } }),
      rec({ n: 4, id: 'd', name: 'Delta', slug: 'd', spotify: { ids: [], confidence: 'none' } }),
      rec({ n: 5, id: 'e', name: 'Epsilon', spotify: { ids: [ID2], matchedName: 'Epsilon', confidence: 'exact' } }),
    ];
    const out = buildOutputs({ state: { year: 2027, lastUpdated: 'd', lastScrape: null, artists }, overrides: {} });
    expect(out.stats.spotifySources).toMatchObject({ festival: 1, search: 3, none: 1, override: 0 });
    expect(out.review).toContain('festival artist link 1, festival album link 0, search 3, none 1');
    expect(out.review).toMatch(/Alpha: .*Alfa, exact\) -> /);
    expect(out.review).toContain('Beta: user: https://open.spotify.com/user/beta');
    expect(out.review).toMatch(/weakest matches \(2\)[\s\S]*Gamma -> .*\(inexact, unverified\)[\s\S]*Epsilon/);
    expect(out.review).toMatch(/not fetched \(1\)[\s\S]*Delta/);
  });
});
