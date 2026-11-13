// Pure checks for the built site (dist/). Used by scripts/check-dist.js and tests.
// Guards what a strict CSP (script-src 'self'; style-src 'self') and the build rely on.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { PLATFORMS, cleanPlatformUrl } from '../../src/core/links.js';
import { normalizeName } from '../../src/core/normalize.js';
import { gzipSize } from './size.js';
import { BUDGET_LINEUP_GZIP, BUDGET_SIMILARITY_GZIP, GZIP_GUARD_HEADROOM, NEIGHBOURS_PER_ARTIST } from './constants.js';

const LINEUP_GZIP_LIMIT = Math.floor(BUDGET_LINEUP_GZIP * GZIP_GUARD_HEADROOM);
const SIMILARITY_GZIP_LIMIT = Math.floor(BUDGET_SIMILARITY_GZIP * GZIP_GUARD_HEADROOM);

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

/**
 * The app page must also be served for /callback (Cloudflare Pages maps /callback to callback.html), and the
 * build generates it from index.html; the Phase 1 lineup file must be gone.
 * @param {string|null} indexHtml
 * @param {string|null} callbackHtml
 * @param {boolean} legacyLineupsExists whether dist/lineups/ exists
 */
export function checkAppPages(indexHtml, callbackHtml, legacyLineupsExists) {
  const out = [];
  if (indexHtml === null) out.push('index.html: missing from dist/');
  if (callbackHtml === null) out.push('callback.html: missing from dist/ (the build should copy it from index.html)');
  else if (indexHtml !== null && callbackHtml !== indexHtml) out.push('callback.html: differs from index.html (it must be the same app page)');
  if (legacyLineupsExists) out.push('lineups/: the Phase 1 lineup files should no longer ship');
  return out;
}

/**
 * Every example artist chip must exist in the similarity index or on the lineup (by normalised name), otherwise
 * the app silently drops it.
 * @param {string[]} examples festival.config.js exampleArtists
 * @param {string|null} lineupRaw
 * @param {string|null} similarityRaw
 */
export function checkExamples(examples, lineupRaw, similarityRaw) {
  if (!Array.isArray(examples) || !examples.length) return [];
  let keys;
  try {
    const lineup = JSON.parse(lineupRaw ?? 'null');
    const sim = JSON.parse(similarityRaw ?? 'null');
    keys = new Set([...(lineup?.artists ?? []).map((a) => normalizeName(a?.name)), ...(sim?.names ?? []).map(normalizeName)]);
  } catch {
    return []; // unparseable data is reported by checkData
  }
  return examples
    .filter((name) => !keys.has(normalizeName(name)))
    .map((name) => `festival.config.js: example artist "${name}" is neither on the lineup nor in the similarity index`);
}

const SIGNALS = new Set(['direct', 'neighbours', 'tags']);
const isInt = (v) => Number.isInteger(v);

function parseOrViolation(name, raw, out) {
  if (raw === null) {
    out.push(`${name}: missing from dist/`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    out.push(`${name}: does not parse (${e.message})`);
    return null;
  }
}

/**
 * Structure and budget checks for data/<year>/lineup.json and similarity.json (see docs/ARCHITECTURE.md).
 * Cheap on purpose: shape, cross references, URL allow-list, gzip size. Not a semantic review.
 * @param {number} year
 * @param {string|null} lineupRaw file text, null if missing
 * @param {string|null} similarityRaw file text, null if missing
 * @returns {string[]} violations
 */
export function checkData(year, lineupRaw, similarityRaw) {
  const out = [];
  const lname = `data/${year}/lineup.json`;
  const sname = `data/${year}/similarity.json`;
  const lineup = parseOrViolation(lname, lineupRaw, out);
  const sim = parseOrViolation(sname, similarityRaw, out);
  const ns = new Set();

  if (lineup) {
    const bad = (m) => out.push(`${lname}: ${m}`);
    if (lineup.year !== year) bad(`"year" is ${lineup.year}, expected ${year}`);
    if (!Array.isArray(lineup.artists) || lineup.artists.length === 0) {
      bad('"artists" is missing or empty');
    } else {
      for (const a of lineup.artists) if (isInt(a?.n)) ns.add(a.n);
      lineup.artists.forEach((a, i) => {
        const who = `artist ${a?.name ?? i}`;
        if (!isInt(a?.n) || a.n < 1) return bad(`${who}: "n" must be a positive integer`);
        if (typeof a.id !== 'string' || !a.id) bad(`${who}: "id" must be a non-empty string`);
        if (typeof a.name !== 'string' || !a.name) bad(`${who}: "name" must be a non-empty string`);
        if (!Array.isArray(a.spotifyIds) || !a.spotifyIds.every((x) => typeof x === 'string')) bad(`${who}: "spotifyIds" must be an array of strings`);
        if (a.ids === null || typeof a.ids !== 'object' || Array.isArray(a.ids)) bad(`${who}: "ids" must be an object`);
        if (!Array.isArray(a.tags) || !a.tags.every((x) => typeof x === 'string')) bad(`${who}: "tags" must be an array of strings`);
        if (a.links === null || typeof a.links !== 'object' || Array.isArray(a.links)) {
          bad(`${who}: "links" must be an object`);
        } else {
          for (const [platform, url] of Object.entries(a.links)) {
            if (!PLATFORMS.includes(platform)) bad(`${who}: unknown link platform "${platform}"`);
            else if (cleanPlatformUrl(platform, url) === null) bad(`${who}: links.${platform} is not an https URL on the allow-list (${url})`);
          }
        }
        if (!Array.isArray(a.similar)) return bad(`${who}: "similar" must be an array`);
        if (a.similar.length > NEIGHBOURS_PER_ARTIST) bad(`${who}: more than ${NEIGHBOURS_PER_ARTIST} similar entries`);
        for (const e of a.similar) {
          const okShape = Array.isArray(e) && e.length === 3 && isInt(e[0]) && typeof e[1] === 'number' && e[1] >= 0 && e[1] <= 1 && SIGNALS.has(e[2]);
          if (!okShape) bad(`${who}: malformed similar entry ${JSON.stringify(e)}`);
          else if (!ns.has(e[0])) bad(`${who}: similar entry points at unknown artist n=${e[0]}`);
          else if (e[0] === a.n) bad(`${who}: similar entry points at itself`);
        }
      });
      if (ns.size !== lineup.artists.length) bad('artist numbers "n" are not unique');
      if (new Set(lineup.artists.map((a) => a?.id)).size !== lineup.artists.length) bad('artist "id" values are not unique');
    }
  }

  if (sim) {
    const bad = (m) => out.push(`${sname}: ${m}`);
    const { names, edges, minMatch } = sim;
    if (typeof minMatch !== 'number' || !(minMatch > 0 && minMatch <= 1)) bad('"minMatch" must be a number in (0, 1]');
    if (![names, edges].every(Array.isArray)) {
      bad('"names" and "edges" must both be arrays');
    } else if (names.length !== edges.length) {
      bad(`"names" (${names.length}) and "edges" (${edges.length}) differ in length`);
    } else {
      if (!names.every((x) => typeof x === 'string')) bad('"names" must hold strings');
      else {
        // The client derives the lookup keys with normalizeName: they must be unique and in sorted order.
        const keys = names.map(normalizeName);
        const unsorted = keys.filter((k, i) => i > 0 && k < keys[i - 1]).length;
        if (unsorted) bad(`"names" is not sorted by normalised key (${unsorted} out of order)`);
        const distinct = new Set(keys).size;
        if (distinct !== names.length) bad(`normalised keys are not unique (${names.length - distinct} repeated)`);
      }
      let reported = 0;
      edges.forEach((e, i) => {
        if (reported >= 5) return;
        const okShape = Array.isArray(e) && e.length > 0 && e.length % 2 === 0 && e.every(isInt);
        let problem = okShape ? null : 'is not a flat list of integer [n, score] pairs';
        if (!problem) {
          for (let j = 0; j < e.length; j += 2) {
            if (ns.size && !ns.has(e[j])) problem = `points at unknown artist n=${e[j]}`;
            else if (e[j + 1] < 1 || e[j + 1] > 100) problem = `has score ${e[j + 1]} outside 1..100`;
            if (problem) break;
          }
        }
        if (problem) {
          bad(`edges[${i}] (${names[i]}) ${problem}`);
          reported++;
        }
      });
    }
  }

  // A guard on what visitors download, not a build input: the limit is the budget plus headroom for zlib differences.
  if (lineupRaw !== null && gzipSize(lineupRaw) > LINEUP_GZIP_LIMIT) {
    out.push(`${lname}: ${gzipSize(lineupRaw)} bytes gzipped, over the ${BUDGET_LINEUP_GZIP} byte budget (guard limit ${LINEUP_GZIP_LIMIT})`);
  }
  if (similarityRaw !== null && gzipSize(similarityRaw) > SIMILARITY_GZIP_LIMIT) {
    out.push(`${sname}: ${gzipSize(similarityRaw)} bytes gzipped, over the ${BUDGET_SIMILARITY_GZIP} byte budget (guard limit ${SIMILARITY_GZIP_LIMIT})`);
  }
  return out;
}

/** Raw and gzip sizes of the two data files, for reporting. Missing files give null. */
export function dataSizes(lineupRaw, similarityRaw) {
  const size = (raw, budget) => (raw === null ? null : { raw: Buffer.byteLength(raw), gzip: gzipSize(raw), budget });
  return { lineup: size(lineupRaw, BUDGET_LINEUP_GZIP), similarity: size(similarityRaw, BUDGET_SIMILARITY_GZIP) };
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

/**
 * Run every check against a dist directory. Returns violation strings.
 * @param {string} distDir
 * @param {number} year
 * @param {{ exampleArtists?: string[] }} [festival]
 */
export function checkDist(distDir, year, festival = {}) {
  if (!existsSync(distDir)) return [`${distDir}: not found (run npm run build first)`];
  const out = [];
  const files = walk(distDir);
  for (const f of files) {
    const rel = f.slice(distDir.length + 1);
    if (!rel.includes('/') && rel.endsWith('.html')) out.push(...checkHtml(rel, readFileSync(f, 'utf8')));
    if (TEXT_EXT.has(extname(f))) out.push(...checkSecrets(rel, readFileSync(f, 'utf8')));
  }
  out.push(...checkHeaders(readOrNull(join(distDir, '_headers'))));
  out.push(...checkAppPages(readOrNull(join(distDir, 'index.html')), readOrNull(join(distDir, 'callback.html')), existsSync(join(distDir, 'lineups'))));
  const lineupRaw = readOrNull(join(distDir, 'data', String(year), 'lineup.json'));
  const similarityRaw = readOrNull(join(distDir, 'data', String(year), 'similarity.json'));
  out.push(...checkData(year, lineupRaw, similarityRaw));
  out.push(...checkExamples(festival.exampleArtists, lineupRaw, similarityRaw));
  return out;
}
