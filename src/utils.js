// Shared helpers. Keep this module free of imports (no circular dependency on main.js).

/**
 * Escape text for safe use in HTML text and in quoted attribute values
 * @param {unknown} text - Value to escape (null/undefined become '')
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return the URL only if it is an https://open.spotify.com/ link, else null.
 * Lineup data is static but untrusted input for the DOM; never render other schemes or hosts.
 * @param {unknown} url
 * @returns {string|null}
 */
export function safeSpotifyUrl(url) {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('https://open.spotify.com/')) return null;
  // Reject characters that could break out of an attribute or the URL itself
  if (/["'<>\s\\]/.test(url)) return null;
  return url;
}

/**
 * Compare the OAuth `state` stored before the redirect with the one returned in the callback.
 * Both must be non-empty strings and equal.
 * @param {string|null|undefined} stored
 * @param {string|null|undefined} returned
 * @returns {boolean}
 */
export function statesMatch(stored, returned) {
  return typeof stored === 'string' && stored.length > 0 && stored === returned;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Render a YYYY-MM-DD string as that calendar date ("November 13, 2026"), independent of the
 * viewer's timezone (no Date parsing, which would treat it as UTC midnight).
 * Malformed input is returned unchanged (as a string; null/undefined become '').
 * @param {string} isoDate
 * @returns {string}
 */
export function formatDate(isoDate) {
  const text = String(isoDate ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return text;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Reject impossible dates such as 2026-02-30 or 2026-13-01
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return text;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
