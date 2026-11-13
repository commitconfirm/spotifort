/**
 * Pure helpers for the lineup scrape and HTTP politeness (no network, no file I/O).
 * Imported by scripts/lineup-source.js, scripts/lib/http.js and the tests.
 */

/**
 * Text content of an HTML fragment. Removing tags in one pass can splice a new tag together
 * (`<scr<b>ipt>` becomes `<script>`), so tags are removed until nothing changes and any angle bracket
 * still left is dropped: no `<` or `>` survives. Entities are untouched: `&lt;` still decodes to a literal `<` afterwards.
 * @param {string} fragment
 * @returns {string}
 */
export function stripTags(fragment) {
  let text = String(fragment);
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text.replace(/[<>]/g, '');
}

/**
 * Decode HTML entities (common named ones plus numeric) without a dependency
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1].toLowerCase() === 'x';
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      try {
        return String.fromCodePoint(num);
      } catch {
        return match;
      }
    }
    return named[code.toLowerCase()] ?? match;
  });
}

/**
 * Extract artist cards from the lineup page HTML.
 * Each artist card contains <h3 class="lineup-artist-name">Name</h3> and sits in an element carrying data-slug="...".
 * A card with no slug of its own gets none (the slug is taken only from between the previous name and this one).
 * @param {string} html
 * @returns {{name: string, slug: string|null}[]} Unique names (case-insensitive) in page order
 */
export function parseLineupCards(html) {
  const tokens = /<h3\b[^>]*\bclass="[^"]*\blineup-artist-name\b[^"]*"[^>]*>([\s\S]*?)<\/h3>|\bdata-slug="([^"]*)"/gi;
  const seen = new Set();
  const cards = [];
  let slug = null;
  let match;
  while ((match = tokens.exec(html)) !== null) {
    if (match[2] !== undefined) {
      slug = decodeEntities(match[2]).trim() || null;
      continue;
    }
    const name = decodeEntities(stripTags(match[1])).replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    const cardSlug = slug;
    slug = null;
    if (name && !seen.has(key)) {
      seen.add(key);
      cards.push({ name, slug: cardSlug });
    }
  }
  return cards;
}

/**
 * Extract artist names from the lineup page HTML.
 * @param {string} html
 * @returns {string[]} Unique names (case-insensitive) in page order
 */
export const parseLineupHtml = (html) => parseLineupCards(html).map((c) => c.name);

/**
 * Parse a Retry-After header value (seconds or HTTP date) into seconds
 * @param {string|null|undefined} value
 * @param {number} [now] - epoch ms, for tests
 * @returns {number|null} Seconds to wait, or null if absent/invalid
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - now) / 1000);
  return null;
}
