import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { checkHtml, checkHeaders, checkAppPages, checkExamples, checkSecrets, checkData, dataSizes } from '../scripts/lib/check-dist.js';
import { BUDGET_LINEUP_GZIP, BUDGET_SIMILARITY_GZIP } from '../scripts/lib/constants.js';

const page = (body = '', head = '') =>
  `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

describe('checkHtml', () => {
  it('passes a clean page', () => {
    const html = page(
      '<h1 class="x">Hi</h1><a href="https://example.com">x</a>',
      '<link rel="stylesheet" href="/assets/a.css"><script type="module" src="/assets/a.js"></script>'
    );
    expect(checkHtml('index.html', html)).toEqual([]);
  });

  const cases = {
    'inline script': [page('<script>alert(1)</script>'), /inline script/],
    'inline event handler': [page('<button onclick="x()">b</button>'), /event handler/],
    'style attribute': [page('<p style="color:red">x</p>'), /style attribute/],
    'style block': [page('', '<style>p{}</style>'), /<style> block/],
    'leftover token': [page('<p>%FESTIVAL_YEAR%</p>'), /%FESTIVAL_YEAR%/],
    'google fonts': [page('', '<link rel="preconnect" href="https://fonts.gstatic.com">'), /fonts\.gstatic\.com/],
    'cross-origin script': [page('', '<script src="https://cdn.example.com/a.js"></script>'), /not same-origin/],
    'protocol-relative stylesheet': [page('', '<link rel="stylesheet" href="//cdn.example.com/a.css">'), /not same-origin/],
  };
  for (const [label, [html, re]] of Object.entries(cases)) {
    it(`flags ${label}`, () => {
      const v = checkHtml('p.html', html);
      expect(v.length).toBeGreaterThan(0);
      expect(v.join('\n')).toMatch(re);
    });
  }

  it('ignores violations inside comments', () => {
    expect(checkHtml('p.html', page('<!-- <script>x</script> -->'))).toEqual([]);
  });
});

describe('checkHeaders', () => {
  it('requires a CSP line', () => {
    expect(checkHeaders(null)).toHaveLength(1);
    expect(checkHeaders('/*\n  X-Frame-Options: DENY')).toHaveLength(1);
    expect(checkHeaders("/*\n  Content-Security-Policy: default-src 'self'")).toEqual([]);
  });
});

describe('_headers CSP', () => {
  const csp = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => /^\s*Content-Security-Policy\s*:/i.test(l));
  const directive = (name) =>
    csp.split(':').slice(1).join(':').split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];
  it("has no 'unsafe-inline' and no wildcard source", () => {
    expect(csp).toBeTruthy();
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp.split(/[\s;]+/)).not.toContain('*');
    expect(csp).not.toMatch(/\*\./);
  });
  it('script-src lists only self and the Cloudflare beacon', () => {
    expect(directive('script-src')).toEqual(["'self'", 'https://static.cloudflareinsights.com/beacon.min.js']);
  });
  it('connect-src lists only self, Spotify and the Cloudflare beacon report host', () => {
    expect(directive('connect-src')).toEqual([
      "'self'",
      'https://api.spotify.com',
      'https://accounts.spotify.com',
      'https://cloudflareinsights.com',
    ]);
  });
});

describe('checkAppPages', () => {
  it('passes when callback.html is the app page and no Phase 1 files ship', () => {
    expect(checkAppPages('<html>app</html>', '<html>app</html>', false)).toEqual([]);
  });
  it('flags a missing or different callback page, and leftover lineups/', () => {
    expect(checkAppPages('<html>app</html>', null, false)).toHaveLength(1);
    expect(checkAppPages('<html>app</html>', '<html>old copy</html>', false)).toHaveLength(1);
    expect(checkAppPages(null, null, false)).toHaveLength(2);
    expect(checkAppPages('a', 'a', true)).toHaveLength(1);
  });
});

describe('checkExamples', () => {
  const lineup = JSON.stringify({ artists: [{ n: 1, name: 'Bully' }] });
  const sim = JSON.stringify({ names: ['Phoebe Bridgers'], edges: [[1, 50]] });
  it('accepts examples on the lineup or in the index, by normalised name', () => {
    expect(checkExamples(['bully', 'Phoebe  Bridgers'], lineup, sim)).toEqual([]);
  });
  it('flags a stale example', () => {
    expect(checkExamples(['Bully', 'Nobody Here'], lineup, sim)).toEqual([expect.stringMatching(/Nobody Here/)]);
  });
  it('tolerates no examples and unparseable data', () => {
    expect(checkExamples(undefined, lineup, sim)).toEqual([]);
    expect(checkExamples(['X'], '{', sim)).toEqual([]);
  });
});

describe('checkSecrets', () => {
  it('passes ordinary text', () => expect(checkSecrets('a.js', 'const token = x; SPOTIFY_TOKEN')).toEqual([]));
  it('flags a hard-coded client id', () => {
    expect(checkSecrets('a.js', `clientId:"${'a1'.repeat(16)}"`)).toHaveLength(1);
  });
  it('flags env-style secrets', () => {
    expect(checkSecrets('a.txt', 'LASTFM_API_KEY=abc123')).toHaveLength(1);
    expect(checkSecrets('a.txt', 'SPOTIFY_CLIENT_SECRET=abc')).toHaveLength(1);
  });
});

describe('checkData', () => {
  const lineup = () => ({
    year: 2027,
    artists: [
      { n: 1, id: 'a', name: 'A', spotifyIds: ['x'], ids: { tidal: '1' }, links: { spotify: 'https://open.spotify.com/artist/x', bandcamp: 'https://a.bandcamp.com/' }, tags: ['indie'], similar: [[2, 0.5, 'direct']] },
      { n: 2, id: 'b', name: 'B', spotifyIds: [], ids: {}, links: {}, tags: [], similar: [[1, 0.5, 'tags']], unverified: true },
    ],
  });
  const sim = () => ({ minMatch: 0.1, names: ['Big Thief', 'Waxahatchee'], edges: [[1, 70, 2, 22], [2, 15]] });
  const run = (l, s) => checkData(2027, l === null ? null : JSON.stringify(l), s === null ? null : JSON.stringify(s));

  it('passes valid files', () => expect(run(lineup(), sim())).toEqual([]));

  it('flags missing and unparseable files', () => {
    expect(run(null, sim()).join()).toMatch(/lineup.json: missing/);
    expect(run(lineup(), null).join()).toMatch(/similarity.json: missing/);
    expect(checkData(2027, '{', JSON.stringify(sim())).join()).toMatch(/does not parse/);
  });

  it('flags a missing minMatch and names whose normalised keys are unsorted or not unique', () => {
    let s = sim();
    delete s.minMatch;
    expect(run(lineup(), s).join()).toMatch(/minMatch/);
    s = sim();
    s.names = ['Waxahatchee', 'Big Thief'];
    expect(run(lineup(), s).join()).toMatch(/not sorted by normalised key/);
    s = sim();
    s.names = ['The Big Thief', 'Big Thief'];
    expect(run(lineup(), s).join()).toMatch(/not unique/);
    s = sim();
    s.names = ['Rock & Roll', 'Rock and Roll'];
    expect(run(lineup(), s).join()).toMatch(/not unique/);
  });

  it('flags names and edges of different length', () => {
    const s = sim();
    s.edges.pop();
    expect(run(lineup(), s).join()).toMatch(/differ in length/);
  });

  it('flags edges pointing at artists that are not in the lineup, and malformed edges', () => {
    let s = sim();
    s.edges[0] = [99, 70];
    expect(run(lineup(), s).join()).toMatch(/unknown artist n=99/);
    s = sim();
    s.edges[0] = [1, 70, 2];
    expect(run(lineup(), s).join()).toMatch(/flat list/);
    s = sim();
    s.edges[0] = [1, 0];
    expect(run(lineup(), s).join()).toMatch(/outside 1..100/);
  });

  it('flags similar entries that point nowhere, at self, or are malformed', () => {
    let l = lineup();
    l.artists[0].similar = [[9, 0.5, 'direct']];
    expect(run(l, sim()).join()).toMatch(/unknown artist n=9/);
    l = lineup();
    l.artists[0].similar = [[1, 0.5, 'direct']];
    expect(run(l, sim()).join()).toMatch(/itself/);
    l = lineup();
    l.artists[0].similar = [[2, 0.5, 'magic']];
    expect(run(l, sim()).join()).toMatch(/malformed similar entry/);
    l = lineup();
    l.artists[0].similar = Array.from({ length: 13 }, () => [2, 0.5, 'direct']);
    expect(run(l, sim()).join()).toMatch(/more than 12/);
  });

  it('flags links that are not https on the allow-list', () => {
    for (const [platform, url] of [['bandcamp', 'http://a.bandcamp.com/'], ['bandcamp', 'https://evil.example/'], ['youtube', 'javascript:alert(1)'], ['myspace', 'https://myspace.com/a']]) {
      const l = lineup();
      l.artists[0].links = { [platform]: url };
      expect(run(l, sim()).join(), `${platform} ${url}`).toMatch(/links\.|unknown link platform/);
    }
  });

  it('flags duplicate or missing artist fields', () => {
    const l = lineup();
    l.artists[1].n = 1;
    expect(run(l, sim()).join()).toMatch(/not unique/);
    const m = lineup();
    delete m.artists[0].tags;
    expect(run(m, sim()).join()).toMatch(/"tags" must be an array/);
  });

  it('enforces the gzip budgets', () => {
    // Random-looking content that does not compress.
    let x = 12345;
    const noise = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x.toString(36); };
    const l = lineup();
    l.artists[0].tags = Array.from({ length: 20000 }, noise);
    expect(run(l, sim()).join()).toMatch(new RegExp(`over the ${BUDGET_LINEUP_GZIP} byte budget`));
    const s = sim();
    s.names = Array.from({ length: 60000 }, (_, i) => `${i.toString(36)}${noise()}`);
    s.edges = s.names.map(() => [1, 50]);
    expect(run(lineup(), s).join()).toMatch(new RegExp(`over the ${BUDGET_SIMILARITY_GZIP} byte budget`));
  });

  it('dataSizes reports raw and gzip sizes and tolerates missing files', () => {
    const t = JSON.stringify(lineup());
    const r = dataSizes(t, null);
    expect(r.lineup.raw).toBe(t.length);
    expect(r.lineup.gzip).toBeGreaterThan(0);
    expect(r.similarity).toBeNull();
  });
});
