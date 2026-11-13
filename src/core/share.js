// Share links: `s=<year>.<base64url bitset over n>`, picks only. Because `n` is stable, links survive lineup
// updates. Bit (n - 1) of the set is bit ((n - 1) & 7) of byte ((n - 1) >> 3); trailing zero bytes are not written.
// Pure, no DOM, no Buffer/atob (runs in Node and browsers).
//
// Decoding is defensive and never throws: a wrong year, a malformed payload or an oversized fragment gives null;
// numbers the lineup does not know are silently dropped.

export const MAX_SHARE_N = 24000;
export const MAX_FRAGMENT_LENGTH = 4096;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2] + ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += ALPHABET[b2 & 63];
  }
  return out;
}

/** @returns {Uint8Array|null} null on any invalid character or impossible length */
function fromBase64Url(text) {
  if (text.length % 4 === 1) return null;
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of text) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Encode picks as a share fragment (without the leading '#'). Invalid picks (not integers 1..MAX_SHARE_N) are ignored.
 * @param {{ year: number, picks: number[] }} share
 * @returns {string} e.g. "s=2027.AAECAw"
 */
export function encodeShare({ year, picks }) {
  const valid = [...new Set((Array.isArray(picks) ? picks : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SHARE_N))];
  const bytes = new Uint8Array(valid.length ? (Math.max(...valid) + 7) >> 3 : 0);
  for (const n of valid) bytes[(n - 1) >> 3] |= 1 << ((n - 1) & 7);
  return `s=${Number(year)}.${toBase64Url(bytes)}`;
}

/**
 * Decode a share fragment against the lineup. Accepts it with or without a leading '#'.
 * @param {unknown} fragment e.g. location.hash
 * @param {{ year?: number, byN?: (n: number) => unknown, artists?: { n: number }[] }} lineup a prepared lineup index (or the raw lineup JSON)
 * @returns {{ year: number, picks: number[] }|null} picks ascending, unknown numbers dropped; null if not a valid share for this lineup's year
 */
export function decodeShare(fragment, lineup) {
  if (typeof fragment !== 'string' || fragment.length > MAX_FRAGMENT_LENGTH + 1) return null;
  const m = /^#?s=(\d{4})\.([A-Za-z0-9_-]*)$/.exec(fragment);
  if (!m) return null;
  const year = Number(m[1]);
  if (lineup && lineup.year !== undefined && lineup.year !== year) return null;
  const bytes = fromBase64Url(m[2]);
  if (!bytes || bytes.length * 8 > MAX_SHARE_N + 7) return null;

  let known;
  if (typeof lineup?.byN === 'function') known = (n) => lineup.byN(n) !== undefined;
  else if (Array.isArray(lineup?.artists)) {
    const set = new Set(lineup.artists.map((a) => a?.n));
    known = (n) => set.has(n);
  } else return null;

  const picks = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (bytes[i] & (1 << bit)) {
        const n = i * 8 + bit + 1;
        if (known(n)) picks.push(n);
      }
    }
  }
  return { year, picks };
}
