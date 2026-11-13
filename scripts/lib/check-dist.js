// Pure checks for the built site (dist/). Used by scripts/check-dist.js and tests.
// Guards what a strict CSP (script-src 'self'; style-src 'self') and the build rely on.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const TAG_RE = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function parseAttrs(src) {
  const attrs = [];
  for (const m of src.matchAll(ATTR_RE)) {
    const value = m[2] === undefined ? '' : m[2].replace(/^["']|["']$/g, '');
    attrs.push([m[1].toLowerCase(), value]);
  }
  return attrs;
}

function isSameOrigin(url) {
  const u = url.trim();
  if (u.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u);
}

/** Returns an array of violation strings for one HTML document. */
export function checkHtml(name, html) {
  const out = [];
  const bad = (msg) => out.push(`${name}: ${msg}`);
  const text = html.replace(/<!--[\s\S]*?-->/g, '');

  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const get = (n) => attrs.find(([k]) => k === n)?.[1];

    if (tag === 'style') bad('<style> block (inline styles break the CSP)');
    if (tag === 'script') {
      const src = get('src');
      if (src === undefined || src === '') bad('<script> without a src (inline script)');
      else if (!isSameOrigin(src)) bad(`<script src="${src}"> is not same-origin`);
    }
    if (tag === 'link' && (get('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const href = get('href') ?? '';
      if (!isSameOrigin(href)) bad(`<link rel="stylesheet" href="${href}"> is not same-origin`);
    }
    for (const [k] of attrs) {
      if (/^on[a-z]/.test(k)) bad(`inline event handler attribute "${k}" on <${tag}>`);
      if (k === 'style') bad(`style attribute on <${tag}>`);
    }
  }

  for (const t of new Set(html.match(/%FESTIVAL_[A-Z_]*%/g) ?? [])) {
    bad(`leftover template token ${t}`);
  }
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (html.includes(host)) bad(`references ${host}`);
  }
  return out;
}

export function checkHeaders(content) {
  if (content === null) return ['_headers: missing from dist/'];
  return /^\s*Content-Security-Policy\s*:/im.test(content)
    ? []
    : ['_headers: no Content-Security-Policy line'];
}

export function checkLineup(year, raw) {
  const name = `lineups/${year}.json`;
  if (raw === null) return [`${name}: missing from dist/`];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return [`${name}: does not parse (${e.message})`];
  }
  if (!Array.isArray(data?.artists) || data.artists.length === 0) {
    return [`${name}: "artists" is missing or empty`];
  }
  const out = [];
  data.artists.forEach((a, i) => {
    const url = a?.spotifyUrl;
    if (url && !String(url).startsWith('https://open.spotify.com/')) {
      out.push(`${name}: artist "${a.name ?? i}" has spotifyUrl outside https://open.spotify.com/ (${url})`);
    }
  });
  return out;
}

const CLIENT_ID_RE = /client[_-]?id["']?\s*[:=]\s*["'][0-9a-f]{32}["']/i;
const SECRET_RE = /[A-Z_]*(?:SECRET|API_KEY|TOKEN)=\S+/;

/** Scan one file's text for hard-coded credentials. */
export function checkSecrets(name, text) {
  const out = [];
  if (CLIENT_ID_RE.test(text)) out.push(`${name}: looks like a hard-coded Spotify client id`);
  const m = text.match(SECRET_RE);
  if (m) out.push(`${name}: looks like an env-style secret (${m[0].split('=')[0]}=...)`);
  return out;
}

const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.map', '.svg', '.xml', '']);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** Run every check against a dist directory. Returns violation strings. */
export function checkDist(distDir, year) {
  if (!existsSync(distDir)) return [`${distDir}: not found (run npm run build first)`];
  const out = [];
  const files = walk(distDir);
  for (const f of files) {
    const rel = f.slice(distDir.length + 1);
    if (!rel.includes('/') && rel.endsWith('.html')) out.push(...checkHtml(rel, readFileSync(f, 'utf8')));
    if (TEXT_EXT.has(extname(f))) out.push(...checkSecrets(rel, readFileSync(f, 'utf8')));
  }
  out.push(...checkHeaders(readOrNull(join(distDir, '_headers'))));
  out.push(...checkLineup(year, readOrNull(join(distDir, 'lineups', `${year}.json`))));
  return out;
}
