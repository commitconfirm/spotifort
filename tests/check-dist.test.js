import { describe, it, expect } from 'vitest';
import { checkHtml, checkHeaders, checkLineup, checkSecrets } from '../scripts/lib/check-dist.js';

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

describe('checkLineup', () => {
  const ok = JSON.stringify({ artists: [{ name: 'A', spotifyUrl: 'https://open.spotify.com/artist/1' }, { name: 'B', spotifyUrl: null }] });
  it('passes valid data', () => expect(checkLineup(2027, ok)).toEqual([]));
  it('flags missing, bad JSON, empty, and foreign URLs', () => {
    expect(checkLineup(2027, null)).toHaveLength(1);
    expect(checkLineup(2027, '{')).toHaveLength(1);
    expect(checkLineup(2027, '{"artists":[]}')).toHaveLength(1);
    expect(checkLineup(2027, JSON.stringify({ artists: [{ name: 'A', spotifyUrl: 'https://evil.example/x' }] }))).toHaveLength(1);
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
